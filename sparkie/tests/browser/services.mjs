// Native owner dashboard, real service and operation ledgers, inert service effects.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const base = process.env.SPARKIE_TEST_URL;
const output = process.env.SPARKIE_BROWSER_OUTPUT;
const effectsPath = process.env.SPARKIE_TEST_SERVICE_EFFECTS;
const login = JSON.parse(await readFile(process.env.SPARKIE_TEST_LOGIN, "utf8"));
const api = "/api/plugins/sparkie-sparks";
const workloadOrigin = "https://workloads.example.test:10000";
await mkdir(output, { recursive: true });
const report = { scope: "Native service dashboard and owner controls with inert workload effects", checks: [] };
const started = performance.now();
const browser = await chromium.launch({ executablePath: process.env.SPARKIE_TEST_CHROME, headless: true });
const errors = [];

async function effects() {
  return (await readFile(effectsPath, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line));
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", error => errors.push(error.message));
  const get = path => page.request.get(base + api + path, { maxRedirects: 0 });
  const post = (path, data) => page.request.post(base + api + path, { data, maxRedirects: 0 });
  const confirm = (row, digest = row.digest) => post(`/operations/${row.id}/confirm`, { digest });
  const catalogPath = url => url.pathname === api + "/services";
  const appAlias = workloadOrigin + "/services/artifact-browser/";

  assert.ok([401, 403].includes((await get("/services")).status()));
  assert.ok([401, 403].includes((await get("/services/artifact-browser/open")).status()));
  let continueCatalog;
  const loading = new Promise(resolve => { continueCatalog = resolve; });
  await page.route(catalogPath, async route => {
    await loading;
    await route.continue();
  });
  await page.goto(base + "/sparks");
  await page.locator('input[name="username"]').fill(login.username);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('form.provider-form button[type="submit"]').click();
  const home = page.getByRole("region", { name: "Sparks", exact: true });
  const services = home.getByRole("region", { name: "Models and apps" });
  const requests = home.getByRole("region", { name: "Spark change requests" });
  await services.getByText("Loading available setups…", { exact: true }).waitFor({ timeout: 30000 });
  continueCatalog();
  await page.unrouteAll({ behavior: "wait" });
  const metrics = page.getByRole("button", { name: "No thanks", exact: true });
  if (await metrics.isVisible()) await metrics.click();

  const app = services.getByText("Artifacts", { exact: true }).locator("xpath=../..");
  const model = services.getByText("GLM Flash · local model", { exact: true }).locator("xpath=../..");
  await app.getByText("1 CPUs · 0.1 GiB memory", { exact: true }).waitFor();
  await model.getByText("16 CPUs · 100.0 GiB memory · GPU", { exact: true }).waitFor();
  assert.deepEqual(await app.getByLabel("Spark for Artifacts").locator("option").evaluateAll(nodes => nodes.map(node => node.value)),
    ["spark2", "spark3", "spark4"]);
  assert.deepEqual(await model.getByLabel("Spark for GLM Flash · local model").locator("option").evaluateAll(nodes => nodes.map(node => node.value)),
    ["spark4"]);
  const catalog = await (await get("/services")).json();
  assert.equal(catalog.length, 2);
  const appRecipe = catalog.find(row => row.recipe === "artifact-browser");
  assert.equal(appRecipe.url, appAlias);
  assert.equal((await post("/operations", { request_id: randomUUID().replaceAll("-", ""), action: "start_service",
    spark: "spark1", recipe: appRecipe.recipe, revision: appRecipe.revision })).status(), 422);
  report.checks.push("Native sign-in, loading state, two enrolled recipes with resources, and enrolled compute only");

  const rowCard = row => requests.getByText("Request: " + row.id, { exact: true }).locator("..");
  const status = () => get("/controls").then(response => response.json());
  const expired = (await status()).operations.find(row => row.message === "This confirmation expired. Start a new request.");
  assert.ok(expired);
  await rowCard(expired).getByText("This confirmation expired. Start a new request.", { exact: true }).waitFor();
  assert.equal(await rowCard(expired).getByRole("button", { name: "Run it", exact: true }).count(), 0);
  assert.equal((await confirm(expired)).status(), 403);
  assert.deepEqual(await effects(), []);

  async function prepare(card, label, expected) {
    const response = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname === api + "/operations");
    await card.getByRole("button", { name: label, exact: true }).click();
    const prepared = await response;
    assert.equal(prepared.status(), 200);
    const row = await prepared.json();
    assert.deepEqual(row.intent, expected);
    assert.equal(row.state, "pending");
    await rowCard(row).getByText("Waiting for your confirmation. Nothing has run.", { exact: true }).waitFor();
    return row;
  }

  async function runOnce(row) {
    const pending = page.waitForResponse(value => value.request().method() === "POST"
      && new URL(value.url()).pathname === api + `/operations/${row.id}/confirm`);
    await rowCard(row).getByRole("button", { name: "Run it", exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).state, "succeeded");
    await rowCard(row).getByText("The requested result was observed.", { exact: true }).waitFor();
    assert.equal((await confirm(row)).status(), 403);
  }

  const appTarget = { recipe: appRecipe.recipe, revision: appRecipe.revision };
  await app.getByLabel("Spark for Artifacts").selectOption("spark2");
  const start = await prepare(app, "Review start", { action: "start_service", spark: "spark2", ...appTarget });
  await rowCard(start).getByText(`Start artifact-browser revision ${appRecipe.revision} on Spark 2.`, { exact: true }).waitFor();
  assert.deepEqual(await effects(), []);
  assert.equal((await confirm(start, "f".repeat(64))).status(), 403);
  assert.deepEqual(await effects(), []);
  await runOnce(start);
  await app.getByText("Spark 2 · Ready", { exact: true }).waitFor();
  const appStart = { action: "start", recipe: "artifact-browser", spark: "spark2", instance: start.id };
  assert.deepEqual(await effects(), [appStart]);
  await app.getByRole("button", { name: "Runtime log", exact: true }).click();
  const log = app.locator("pre");
  assert.match(await log.textContent(), /artifact-browser on spark2 is ready\./);
  assert.match(await log.textContent(), /<script>never evaluated<\/script>/);
  assert.equal(await log.locator("script").count(), 0);
  const oldOpen = await app.getByRole("link", { name: "Open app", exact: true }).getAttribute("href");
  assert.equal(new URL(oldOpen, base).searchParams.get("instance"), start.id);
  const open = await page.request.get(base + oldOpen, { maxRedirects: 0 });
  assert.equal(open.status(), 303);
  assert.equal(open.headers().location, appAlias);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: output + "/desktop-services.png", fullPage: true });
  report.checks.push("Start prepares the exact revision and target with no effect, rejects wrong and expired confirmation, then confirms once and displays inert runtime logs and the stable app alias");

  await page.setViewportSize({ width: 390, height: 844 });
  const glmRecipe = catalog.find(row => row.recipe === "glm-flash");
  const startModel = await prepare(model, "Review start", { action: "start_service", spark: "spark4",
    recipe: glmRecipe.recipe, revision: glmRecipe.revision });
  assert.deepEqual(await effects(), [appStart]);
  await runOnce(startModel);
  await model.getByText("Spark 4 · Ready", { exact: true }).waitFor();
  const modelAlias = workloadOrigin + "/services/glm-flash/";
  await model.getByText(modelAlias + "v1", { exact: true }).waitFor();
  const modelOpen = await model.getByRole("link", { name: "View endpoint", exact: true }).getAttribute("href");
  const modelRedirect = await page.request.get(base + modelOpen, { maxRedirects: 0 });
  assert.equal(modelRedirect.status(), 303);
  assert.equal(modelRedirect.headers().location, modelAlias + "v1/models");

  const stop = await prepare(app, "Review stop", { action: "stop_service", spark: "spark2", ...appTarget, instance: start.id });
  await rowCard(stop).getByText(`Stop artifact-browser instance ${start.id} on Spark 2. Keep its files.`, { exact: true }).waitFor();
  const modelStart = { action: "start", recipe: "glm-flash", spark: "spark4", instance: startModel.id };
  assert.deepEqual(await effects(), [appStart, modelStart]);
  await runOnce(stop);
  assert.equal((await page.request.get(base + oldOpen, { maxRedirects: 0 })).status(), 409);
  await app.getByLabel("Spark for Artifacts").selectOption("spark3");
  const moved = await prepare(app, "Review start", { action: "start_service", spark: "spark3", ...appTarget });
  const appStop = { ...appStart, action: "stop" };
  assert.deepEqual(await effects(), [appStart, modelStart, appStop]);
  await runOnce(moved);
  await app.getByText("Spark 3 · Ready", { exact: true }).waitFor();
  const movedOpen = await app.getByRole("link", { name: "Open app", exact: true }).getAttribute("href");
  assert.equal(new URL(movedOpen, base).searchParams.get("instance"), moved.id);
  const sameAlias = await page.request.get(base + movedOpen, { maxRedirects: 0 });
  assert.equal(sameAlias.status(), 303);
  assert.equal(sameAlias.headers().location, appAlias);
  assert.deepEqual(await effects(), [appStart, modelStart, appStop, { ...appStart, spark: "spark3", instance: moved.id }]);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await services.screenshot({ path: output + "/phone-service-cards.png" });
  await page.screenshot({ path: output + "/phone-services.png", fullPage: true });
  report.checks.push("Phone confirmation stops only the exact instance, preserves the separate model endpoint, and relocation retains the stable app alias without overflow");

  await page.route(catalogPath, route => route.fulfill({ status: 503, json: { detail: "Fixture catalog unavailable" } }));
  const refresh = home.getByRole("button", { name: "Refresh", exact: true });
  await refresh.click();
  await services.getByText("Model and app controls could not be loaded. Refresh to check them.", { exact: true }).waitFor();
  assert.equal(await services.getByRole("button", { name: "Review stop", exact: true }).count(), 0);
  await page.unroute(catalogPath);
  await refresh.click();
  await app.getByText("Spark 3 · Ready", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  report.checks.push("Unavailable catalog hides service actions and Refresh restores the verified data");
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
