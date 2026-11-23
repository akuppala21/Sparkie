// Run on a compute Spark against an isolated native Hermes dashboard.
// The login file and browser binary are supplied by the operator, never committed.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium, request } = createRequire(import.meta.url)("playwright-core");
const base = process.env.SPARKIE_TEST_URL;
const output = process.env.SPARKIE_BROWSER_OUTPUT;
if (!base || !output || !process.env.SPARKIE_TEST_LOGIN || !process.env.SPARKIE_TEST_CHROME) throw new Error("Missing isolated browser test configuration");
const login = JSON.parse(await readFile(process.env.SPARKIE_TEST_LOGIN, "utf8"));
await mkdir(output, { recursive: true });
const report = { scope: "Native Hermes login, read-only electricity estimates, and desktop/phone Sparks panel. Electricity uses explicit test readings; no rate writes, fleet mutations or live settings.", checks: [] };
const unauthenticated = await request.newContext({ baseURL: base });
const browser = await chromium.launch({ executablePath: process.env.SPARKIE_TEST_CHROME, headless: true });
try {
  const status = await (await unauthenticated.get("/api/status")).json();
  assert.equal(status.auth_required, true);
  for (const route of ["fleet", "energy"]) {
    const result = await unauthenticated.get("/api/plugins/sparkie-sparks/" + route, { maxRedirects: 0 });
    assert.ok([401, 403].includes(result.status()), "An unauthenticated plugin read must be refused: " + route);
  }
  report.checks.push("Unauthenticated fleet and energy reads refused by native Hermes");
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pageErrors = [];
  const rateWrites = [];
  const energyReads = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/plugins/sparkie-sparks/energy") energyReads.push(request.url());
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plugins/sparkie-sparks/energy/rate") rateWrites.push(request.postDataJSON());
  });
  await page.goto(base + "/sparks");
  await page.locator('input[name="username"]').fill(login.username);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('form.provider-form button[type="submit"]').click();
  const panel = page.getByRole("region", { name: "Sparks", exact: true });
  await panel.getByRole("heading", { name: "Sparks", exact: true }).waitFor({ timeout: 30000 });
  for (const [name, route] of [["Ask Sparkie", "/chat"], ["Models", "/models"], ["Recipes", "/recipes"]]) {
    const href = await panel.getByRole("link", { name, exact: true }).getAttribute("href");
    assert.equal(new URL(href, base).pathname, route);
  }
  const declineMetrics = page.getByRole("button", { name: "No thanks", exact: true });
  if (await declineMetrics.isVisible()) await declineMetrics.click();
  await page.getByLabel("Electricity month").waitFor();
  const energy = await (await page.request.get(base + "/api/plugins/sparkie-sparks/energy")).json();
  const historical = energy.months.find(month => month !== energy.month);
  assert.ok(historical, "Explicit browser fixtures must include a historical month");
  await page.getByLabel("Electricity month").selectOption(historical);
  await page.getByText("0.020 kWh recorded", { exact: true }).waitFor();
  const electricity = page.getByRole("region", { name: "Electricity", exact: true });
  assert.equal(energy.rate_usd_per_kwh, null, "A read without a rate must not invent one");
  assert.ok(!("rates" in energy) && !("current_rate" in energy), "Only usage history is stored");
  assert.equal(await electricity.getByLabel("Electricity rate", { exact: true }).inputValue(), "");
  await electricity.getByText("Choose a rate to estimate cost", { exact: true }).waitFor();
  const presetLabels = await electricity.getByLabel("Electricity rate", { exact: true }).locator("option").allTextContents();
  assert.deepEqual(presetLabels, ["Choose a rate", ...energy.rate_presets.map(value => "$" + value.toFixed(2) + " / kWh"), "Custom…"]);
  for (const period of ["day", "week", "year", "month"]) {
    const response = page.waitForResponse(result => {
      const url = new URL(result.url());
      return url.pathname === "/api/plugins/sparkie-sparks/energy" && url.searchParams.get("period") === period;
    });
    await electricity.getByLabel("Electricity period", { exact: true }).selectOption(period);
    const row = await (await response).json();
    assert.equal(row.period, period);
    const history = electricity.getByLabel("Electricity " + period, { exact: true });
    await history.waitFor();
    assert.equal(await history.inputValue(), row.selected);
    assert.deepEqual(await history.locator("option").evaluateAll(nodes => nodes.map(node => node.value)), row.periods);
    const prior = row.periods.find(value => value !== row.selected);
    if (prior) {
      const selectedResponse = page.waitForResponse(result => new URL(result.url()).pathname === "/api/plugins/sparkie-sparks/energy"
        && new URL(result.url()).searchParams.get("selected") === prior);
      await history.selectOption(prior);
      const selectedRow = await (await selectedResponse).json();
      assert.equal(selectedRow.selected, prior);
      await history.waitFor();
      assert.equal(await history.inputValue(), prior);
    }
  }
  report.checks.push("Day, ISO week, month and year selectors use their own recorded history inside the same card");
  await electricity.getByLabel("Electricity month", { exact: true }).selectOption(historical);
  const readsBeforeRate = energyReads.length;
  await electricity.getByLabel("Electricity rate", { exact: true }).selectOption("0.4");
  await electricity.getByText("$0.008 estimated cost", { exact: true }).waitFor();
  assert.deepEqual(rateWrites, [], "Changing the rate never saves a rate or calls a mutation");
  assert.equal(energyReads.length, readsBeforeRate, "Changing the rate uses local arithmetic without another API read");
  await electricity.getByLabel("Electricity period", { exact: true }).selectOption("day");
  await electricity.getByLabel("Electricity day", { exact: true }).waitFor();
  assert.equal(await electricity.getByLabel("Electricity rate", { exact: true }).inputValue(), "0.4");
  await electricity.getByLabel("Electricity period", { exact: true }).selectOption("month");
  await electricity.getByLabel("Electricity month", { exact: true }).selectOption(historical);
  await electricity.getByText("$0.008 estimated cost", { exact: true }).waitFor();
  assert.deepEqual(rateWrites, [], "The selected comparison rate survives period changes without writes");
  report.checks.push("Historical estimated cost recalculates immediately without API calls or writes and preserves rate across periods");
  assert.equal(await electricity.getByRole("button", { name: "Save rate", exact: true }).count(), 0);
  assert.equal(await electricity.getByText("Rate history", { exact: true }).count(), 0);
  const rated = await (await page.request.get(base + "/api/plugins/sparkie-sparks/energy?month=" + historical + "&rate=0.4")).json();
  assert.equal(rated.rate_usd_per_kwh, 0.4);
  assert.equal(rated.cost_usd, 0.008, "Historical recorded usage is estimated using the requested rate");
  const unrated = await (await page.request.get(base + "/api/plugins/sparkie-sparks/energy?month=" + historical)).json();
  assert.equal(unrated.rate_usd_per_kwh, null);
  assert.equal(unrated.cost_usd, null, "A rate is never retained by a previous estimate");
  await electricity.getByText("Spark 2: 0.020 kWh · $0.008 estimated cost", { exact: true }).waitFor();
  await electricity.getByText("Calendar periods in Pacific time.", { exact: true }).waitFor();
  report.checks.push("Amount-only preset estimates price any recorded period without a Save button, rate history or persisted rate");
  const state = await (await page.request.get(base + "/api/plugins/sparkie-sparks/fleet")).json();
  assert.equal(state.available, true);
  for (const spark of state.sparks) await page.getByText(spark.name, { exact: true }).first().waitFor();
  report.checks.push("Native username/password login reaches the Sparks tab");
  report.checks.push("Authenticated fleet and electricity APIs return observations");
  report.checks.push("Historical month selection changes the measured total inside the electricity card");
  await page.screenshot({ path: output + "/desktop.png", fullPage: true });
  const fixtureFleet = { ...state, sparks: state.sparks.map(spark => spark.id !== "spark4" ? spark : {
    ...spark, network_links: [{ name: "fixture-connectx0", kind: "ethernet", state: "up", speed_mbps: 200000 }], workloads: [
      { id: "a".repeat(64), name: "fixture-job", image: "example/job:1", kind: "workload" },
      { id: "b".repeat(64), name: "fixture-support", image: "example/support:1", kind: "infrastructure" },
    ],
  }) };
  let fixtureReads = 0;
  await page.route(url => url.pathname === "/api/plugins/sparkie-sparks/fleet", route => {
    fixtureReads++;
    return route.fulfill({ json: fixtureFleet });
  });
  const energyRefresh = page.waitForResponse(response => new URL(response.url()).pathname === "/api/plugins/sparkie-sparks/energy");
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  assert.equal((await energyRefresh).status(), 200, "Refresh must update electricity as well as fleet status");
  await panel.getByText("fixture-job", { exact: true }).click();
  assert.ok(fixtureReads > 0, "The workload fixture must match native profile-scoped requests");
  await panel.getByText("Image: example/job:1", { exact: true }).waitFor();
  await panel.getByRole("heading", { name: "Supporting services", exact: true }).waitFor();
  const network = panel.locator("details").filter({ hasText: "fixture-connectx0" });
  await network.locator("summary").click();
  await panel.getByText("fixture-connectx0 · Ethernet · Link up · 200 Gbps", { exact: true }).waitFor();
  await network.getByText("These are observed port readings. Cable peers have not been verified.", { exact: true }).waitFor();
  report.checks.push("Physical network readings show link state/speed without guessing a cable peer");
  report.checks.push("Explicit workload fixture opens details; supporting services have a separate group");
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole("heading", { name: "Sparks", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Phone layout must not overflow horizontally");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).waitFor();
  await page.getByLabel("Electricity month").selectOption(energy.month);
  await page.getByLabel("Electricity month").waitFor();
  await page.getByLabel("Electricity month").selectOption(historical);
  await page.getByText("0.020 kWh recorded", { exact: true }).waitFor();
  await electricity.getByLabel("Electricity rate", { exact: true }).selectOption("custom");
  await electricity.getByLabel("Custom electricity rate", { exact: true }).fill("0.456789");
  await electricity.getByText("$0.009136 estimated cost", { exact: true }).waitFor();
  assert.equal(await electricity.getByLabel("Custom electricity rate", { exact: true }).inputValue(), "0.456789");
  assert.deepEqual(rateWrites, [], "Custom estimates never send writes");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Phone rate controls must not overflow");
  report.checks.push("Phone custom rate recalculates immediately with six-decimal precision and no writes");
  await page.screenshot({ path: output + "/phone.png", fullPage: true });
  const phoneJob = panel.getByText("fixture-job", { exact: true });
  await phoneJob.scrollIntoViewIfNeeded();
  if (!(await phoneJob.evaluate(node => node.parentElement.open))) await phoneJob.click();
  await panel.getByText("Image: example/job:1", { exact: true }).waitFor();
  await panel.getByText("fixture-connectx0 · Ethernet · Link up · 200 Gbps", { exact: true }).waitFor();
  await page.screenshot({ path: output + "/phone-workload.png", fullPage: true });
  await panel.getByRole("link", { name: "Recipes", exact: true }).click();
  const recipes = page.getByRole("region", { name: "Recipes", exact: true });
  await recipes.getByRole("link", { name: "edp1096/Huihui-RadixArk-Qwen3.8-27B-abliterated-NVFP4" }).waitFor();
  await recipes.getByText("Previously tested setup", { exact: true }).waitFor();
  assert.equal(await recipes.getByRole("button", { name: /launch|install|start/i }).count(), 0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Recipe pins must fit the viewport");
  }
  report.checks.push("Home opens the read-only Recipes page with selected and previous trial records at desktop and phone widths");
  assert.deepEqual(pageErrors, [], "Native page must render without JavaScript errors");
  report.checks.push("390px phone layout fits; refresh and month selection remain usable");
  const calendarRequests = energyReads.map(url => new URL(url).searchParams);
  assert.ok(calendarRequests.some(params => params.get("period") === "month" && !params.has("selected")));
  assert.ok(calendarRequests.some(params => params.get("selected") === historical));
  assert.ok(calendarRequests.every(params => params.get("selected") !== ""));
  const emptySelection = await page.request.get(base + "/api/plugins/sparkie-sparks/energy?period=day&selected=");
  assert.equal(emptySelection.status(), 400, "An explicitly empty selection cannot default to the current period");
  report.checks.push("Calendar requests distinguish the default period, recorded history and an invalid empty selection");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error.message).replaceAll(login.password, "[redacted]");
  process.exitCode = 1;
} finally {
  await browser.close();
  await unauthenticated.dispose();
  await writeFile(output + "/result.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
