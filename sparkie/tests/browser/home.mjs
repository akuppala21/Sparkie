// Native dashboard routing and theme on a compute Spark, using a fresh fixture home.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium, request } = createRequire(import.meta.url)("playwright-core");
const base = process.env.SPARKIE_TEST_URL;
const output = process.env.SPARKIE_BROWSER_OUTPUT;
const login = JSON.parse(await readFile(process.env.SPARKIE_TEST_LOGIN, "utf8"));
await mkdir(output, { recursive: true });
const report = { scope: "Isolated native Home, sidebar, recipe authentication and editable theme; no real fleet or model calls", checks: [] };
const started = performance.now();
const browser = await chromium.launch({ executablePath: process.env.SPARKIE_TEST_CHROME, headless: true });
try {
  const anonymous = await request.newContext();
  assert.ok([401, 403].includes((await anonymous.get(base + "/api/plugins/sparkie-recipes/catalog")).status()));
  await anonymous.dispose();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/");
  await page.locator('input[name="username"]').fill(login.username);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('form.provider-form button[type="submit"]').click();
  const panel = page.getByRole("region", { name: "Sparks", exact: true });
  await panel.waitFor({ timeout: 30000 });
  const metrics = page.getByRole("button", { name: "No thanks", exact: true });
  if (await metrics.isVisible()) await metrics.click();
  assert.equal(new URL(page.url()).pathname, "/sparks", "Root sign-in must land on the native Home tab");
  await page.locator("header").getByRole("heading", { name: "Home", exact: true }).waitFor();
  assert.equal((await page.request.get(base + "/api/plugins/sparkie-recipes/catalog")).status(), 200);
  assert.ok([404, 405].includes((await page.request.post(base + "/api/plugins/sparkie-recipes/catalog", { data: {} })).status()),
    "The read-only catalog must have no POST action");
  report.checks.push("Root sign-in opens Home; recipe reads require sign-in and have no mutation route");
  const themes = await (await page.request.get(base + "/api/dashboard/themes")).json();
  assert.ok(JSON.stringify(themes).includes('"sparkie"'), "The native theme loader must discover Sparkie");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const selected = await background();
  assert.equal((await page.request.put(base + "/api/dashboard/theme", { data: { name: "default" } })).status(), 200);
  await page.reload();
  await panel.waitFor();
  const ordinary = await background();
  assert.equal((await page.request.put(base + "/api/dashboard/theme", { data: { name: "sparkie" } })).status(), 200);
  await page.reload();
  await panel.waitFor();
  assert.equal(await background(), selected, "The native theme choice must persist across reloads");
  assert.notEqual(selected, ordinary, "Native theme changes must change the shared palette");
  const refresh = panel.getByRole("button", { name: "Refresh", exact: true });
  await refresh.waitFor();
  const primary = await refresh.evaluate(button => {
    const style = getComputedStyle(button);
    return [style.backgroundColor, style.borderTopLeftRadius];
  });
  assert.deepEqual(primary, ["rgb(118, 185, 0)", "12px"], "The Sparkie theme must reach the native primary button");
  report.checks.push("Sparkie is a native selectable theme; changing and restoring it persists across reloads");
  await page.screenshot({ path: output + "/desktop-home.png", fullPage: true });
  const saved = await context.storageState();
  for (const [width, cached] of [[390, false], [1440, false], [1440, true]]) {
    const isolated = await browser.newContext({ viewport: { width, height: 900 }, storageState: saved });
    const entry = await isolated.newPage();
    if (cached) await entry.addInitScript(() => {
      if (location.pathname === "/") sessionStorage.setItem("hermes:plugin-manifests:default", "[]");
    });
    await entry.route(url => url.pathname === "/api/dashboard/plugins", async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.continue();
    });
    const fleetReads = [];
    entry.on("request", req => {
      if (new URL(req.url()).pathname === "/api/plugins/sparkie-sparks/fleet")
        fleetReads.push(new URL(req.frame().url()).pathname);
    });
    await entry.goto(base + "/?profile=default");
    await entry.getByRole("region", { name: "Sparks", exact: true }).waitFor({ timeout: 15000 });
    assert.equal(new URL(entry.url()).pathname, "/sparks", "Root must resolve to Home with an empty or stale manifest cache");
    assert.equal(new URL(entry.url()).searchParams.get("profile"), "default");
    await entry.locator("header").getByRole("heading", { name: "Home", exact: true }).waitFor();
    await entry.getByRole("button", { name: "Refresh", exact: true }).waitFor();
    assert.ok(fleetReads.includes("/sparks") && !fleetReads.includes("/"), "Only the canonical Home may start fleet reads");
    assert.ok(await entry.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await entry.screenshot({ path: output + `/${width}-${cached ? "warm" : "cold"}-home.png`, fullPage: true });
    await isolated.close();
  }
  const ordinaryHome = await browser.newContext({ storageState: saved });
  const nativePage = await ordinaryHome.newPage();
  const cachedManifests = await (await page.request.get(base + "/api/dashboard/plugins?profile=default")).json();
  assert.ok(cachedManifests.some(manifest => manifest.tab?.override === "/"));
  await nativePage.addInitScript(manifests => {
    if (location.pathname === "/") sessionStorage.setItem("hermes:plugin-manifests:default", JSON.stringify(manifests));
  }, cachedManifests);
  await nativePage.route(url => url.pathname === "/api/dashboard/plugins", async route => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const response = await route.fetch();
    const manifests = await response.json();
    assert.ok(manifests.some(manifest => manifest.tab?.override === "/"));
    await route.fulfill({ json: manifests.filter(manifest => manifest.tab?.override !== "/") });
  });
  await nativePage.goto(base + "/?profile=default");
  await nativePage.waitForURL(url => url.pathname === "/sessions");
  await nativePage.locator("header").getByRole("heading", { name: "Sessions", exact: true }).waitFor();
  await ordinaryHome.close();
  await page.goto(base + "/sessions");
  await page.locator("header").getByRole("heading", { name: "Sessions", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/sessions");
  report.checks.push("Direct Sessions remains accessible; removing a cached Home override restores the native root fallback");
  assert.deepEqual(errors, []);
  report.checks.push("Fresh desktop and phone contexts and a pre-upgrade cached tab retain Home while plugin discovery is delayed; no horizontal overflow");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error.message).replaceAll(login.password, "[redacted]");
  process.exitCode = 1;
} finally {
  await browser.close();
  report.elapsed_seconds = Number(((performance.now() - started) / 1000).toFixed(3));
  await writeFile(output + "/result.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
