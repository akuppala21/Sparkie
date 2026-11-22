// Real Chromium navigation and opaque-origin behavior through the reviewed proxy.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const origin = "https://localhost:10000";
const artifact = origin + "/services/artifact-browser/";
const models = origin + "/services/glm-flash/v1/models";
const completions = origin + "/services/glm-flash/v1/chat/completions";
const output = process.env.SPARKIE_BROWSER_OUTPUT;
const cookieValues = JSON.parse(await readFile(process.env.SPARKIE_ARTIFACT_SESSION, "utf8"));
const report = { scope: "Chromium, production Caddy routes, and native auth with private read-only files and an inert model endpoint", checks: {} };
const browser = await chromium.launch({ executablePath: process.env.SPARKIE_TEST_CHROME, headless: true });
const started = performance.now();

try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const anonymous = await context.request.get(artifact, { maxRedirects: 0, headers: { Accept: "application/json" } });
  assert.equal(anonymous.status(), 401);
  await context.addCookies(Object.entries(cookieValues).map(([name, value]) => ({ name, value, url: origin,
    httpOnly: true, secure: true, sameSite: "Lax" })));
  const initial = await page.goto(artifact);
  const policy = initial.headers()["content-security-policy"];
  report.checks.authenticated_artifact_opens = initial.status() === 200;
  report.checks.opaque_sandbox_policy = policy?.includes("sandbox allow-scripts allow-forms allow-downloads")
    && !policy.includes("allow-same-origin") && policy.includes("worker-src 'none'");

  async function follow(name) {
    const response = page.waitForEvent("response", { predicate: value => value.request().isNavigationRequest()
      && value.request().frame() === page.mainFrame() });
    await page.getByRole("link", { name, exact: true }).click();
    const result = await response;
    await page.waitForLoadState("domcontentloaded");
    return result.status();
  }

  if (report.checks.authenticated_artifact_opens) {
    report.directory_navigation_status = await follow("folder/");
    report.checks.directory_link_works = report.directory_navigation_status === 200;
    if (!report.checks.directory_link_works) await page.goto(artifact);
    report.file_navigation_status = await follow(report.checks.directory_link_works ? "nested.txt" : "readme.txt");
    report.checks.file_link_works = report.file_navigation_status === 200
      && (await page.locator("body").innerText()).includes("read-only fixture file");
  } else {
    report.checks.directory_link_works = false;
    report.checks.file_link_works = false;
  }

  assert.equal((await context.request.get(models)).status(), 200);
  assert.equal((await context.request.post(completions, { headers: { Origin: origin }, data: { fixture: true } })).status(), 200);
  assert.equal((await context.request.post(artifact, { headers: { Origin: origin }, data: { fixture: true } })).status(), 403);
  assert.equal((await page.goto(artifact + "isolation.html")).status(), 200);
  const probe = page.locator("#isolation-result[data-completed='true']");
  await probe.waitFor();
  report.attack = JSON.parse(await probe.innerText());
  report.checks.opaque_origin = report.attack.origin === "null";
  // Browser CORS failures omit the response event. The fixture separately checks
  // the actual native authorization responses and the model backend request log.
  report.checks.script_cannot_read_model_response = report.attack.requests.length === 2
    && report.attack.requests.every(value => value === "blocked");
  report.cross_site_model_navigation_status = await follow("Open model probe");
  report.checks.cross_site_model_document_denied = report.cross_site_model_navigation_status === 403;
  report.passed = Object.values(report.checks).every(Boolean);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.passed = false;
  report.error = String(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  report.elapsed_seconds = Number(((performance.now() - started) / 1000).toFixed(3));
  await writeFile(output + "/result.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
