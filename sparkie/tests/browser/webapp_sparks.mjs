// Use only an isolated Hermes Webapp listener on a compute Spark. Stock REST
// serves recipes; fixture responses keep every power decision off the fleet.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { verifyPowerStates } from "./sparks_power_states.mjs";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const base = new URL(process.env.SPARKIE_TEST_URL);
const output = process.env.SPARKIE_BROWSER_OUTPUT;
if (!output || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Use a loopback candidate listener and a browser output directory.");
}
const api = "/api/plugins/sparkie-sparks";
const receipt = { checks: [], sizes: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.SPARKIE_TEST_CHROME });

function installFleetFixture(page) {
  const writes = [];
  const unexpected = [];
  let operation;
  const bySpark = Object.fromEntries([2, 3, 4].map(n => ["spark" + n, { actions: ["wake", "sleep"] }]));
  const period = ["2026-11", "2026-10"];
  const observed = "2026-11-01T12:00:00Z";
  const sparks = [1, 2, 3, 4].map(n => ({
    id: "spark" + n, name: "Spark " + n, host: n === 1,
    observed_at: observed, observed_state: n === 1 || n === 3 ? "online" : "off", stale: false,
    workloads: n === 1 || n === 3 ? [] : null, network_links: null,
    metrics: n === 1 || n === 3 ? { memory_available_bytes: (n === 1 ? 24 : 116) * 2 ** 30,
      disk_free_bytes: (n === 1 ? 948 : 1213) * 2 ** 30, gpu_utilization_percent: n === 1 ? 7 : 0 } : {},
    wall: { watts: n === 1 ? 39.4 : n === 3 ? 17.6 : 0.8 },
  }));
  const tour = async route => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.slice(url.pathname.indexOf(api) + api.length);
    let result;
    if (req.method() === "GET") {
      if (path === "/fleet") result = { available: true, sparks, message: "Test fleet · example readings" };
      if (path === "/controls") result = { available: true, operations: operation ? [operation] : [], by_spark: bySpark };
      if (path === "/services") result = [];
      if (path === "/energy") {
        const selected = url.searchParams.get("selected") || period[0];
        result = { months: period, periods: period, selected, sparks: [], rate_presets: [0.4],
          recorded_kwh: selected === period[0] ? 4 : 2 };
      }
    } else if (req.method() === "POST") {
      const body = req.postDataJSON();
      writes.push({ path, body });
      if (path === "/operations") {
        assert.equal(body.action, "wake");
        assert.equal(body.spark, "spark2");
        assert.match(body.request_id, /^[a-f0-9]{32}$/);
        operation = { id: "fixture-wake", digest: "d".repeat(64), intent: { action: "wake", spark: "spark2" },
          state: "pending", can_confirm: true, description: "Wake only Spark 2", message: "Waiting for confirmation." };
        result = operation;
      } else if (path === "/operations/fixture-wake/confirm" && operation?.can_confirm) {
        assert.deepEqual(body, { digest: operation.digest });
        operation = { ...operation, can_confirm: false, state: "verified", message: "Fixture observed Spark 2 online." };
        result = operation;
      }
    }
    if (result === undefined) {
      unexpected.push(req.method() + " " + path);
      return route.fulfill({ status: 404, json: { detail: "Unknown fixture request" } });
    }
    return route.fulfill({ json: result });
  };
  return { writes, unexpected, sparks, bySpark, ready: page.route(url => url.origin === base.origin && url.pathname.includes(api + "/"), tour) };
}

let activePage;
const pageFaults = [];
try {
  for (const size of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: size });
    activePage = page;
    page.on("pageerror", err => pageFaults.push(err.name + ": " + err.message.slice(0, 240)));
    page.on("console", message => {
      if (message.type() === "error" && message.text().includes("[plugins]")) pageFaults.push(message.text().slice(0, 240));
    });
    const fixture = installFleetFixture(page);
    await fixture.ready;
    if (process.env.HERMES_WEBAPP_SESSION) {
      const basePath = base.pathname.replace(/\/$/, "");
      await page.addInitScript(({ basePath, token }) => {
        sessionStorage.setItem("hermes.webapp.session.v1:" + JSON.stringify([location.origin, basePath]), token);
      }, { basePath, token: process.env.HERMES_WEBAPP_SESSION });
    }
    const initial = await page.goto(base.href);
    if (!initial.ok()) {
      const detail = (await page.locator("body").innerText()).slice(0, 240);
      throw new Error("The isolated root answered HTTP " + initial.status() + ": " + detail);
    }
    if (!(await page.evaluate(() => window.__HERMES_UI_SURFACE__ === "webapp"))) {
      throw new Error("Unexpected isolated root: " + (await page.locator("body").innerText()).slice(0, 240));
    }
    const fleet = page.getByRole("region", { name: "Sparks", exact: true });
    await fleet.getByText("Always-on host").waitFor({ timeout: 30000 });
    assert.equal(new URL(page.url()).hash, "#/sparks");
    assert.equal(await fleet.getByRole("button", { name: /(?:Wake|Shut down) Spark 1/ }).count(), 0);
    await fleet.getByRole("region", { name: "Models and apps" }).waitFor();
    await verifyPowerStates(page, fleet, fixture.sparks, fixture.bySpark);

    const cost = fleet.getByRole("region", { name: "Electricity" });
    await cost.getByLabel("Electricity month", { exact: true }).selectOption("2026-10");
    await cost.getByText("2.000 kWh recorded", { exact: true }).waitFor();
    await cost.getByLabel("Electricity rate", { exact: true }).selectOption("0.4");
    await cost.getByText("$0.80 estimated cost", { exact: true }).waitFor();
    assert.deepEqual(fixture.writes, []);
    await fleet.getByRole("button", { name: "Wake Spark 2", exact: true }).click();
    await fleet.getByText("Wake only Spark 2", { exact: true }).waitFor();
    assert.equal(fixture.writes.length, 1);
    await fleet.getByRole("button", { name: "Run it", exact: true }).click();
    await fleet.getByText("Fixture observed Spark 2 online.", { exact: true }).waitFor();
    assert.equal(fixture.writes.length, 2);
    assert.deepEqual(fixture.unexpected, []);

    const bounds = await fleet.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { width: el.scrollWidth, available: el.clientWidth, left: rect.left, right: rect.right };
    });
    assert.ok(bounds.width <= bounds.available + 1 && bounds.left >= -1 && bounds.right <= size.width + 1,
      "Fleet content must fit the visible workspace: " + JSON.stringify(bounds));
    // Capture the visible landing screen after dismissing native startup notices.
    const notifications = page.getByRole("region", { name: "Notifications" });
    for (const clear of await notifications.getByRole("button", { name: "Clear all", exact: true }).all()) {
      if (await clear.isVisible()) await clear.click();
    }
    for (const dismiss of await notifications.getByRole("button", { name: "Dismiss notification" }).all()) {
      if (await dismiss.isVisible()) await dismiss.click();
    }
    await notifications.getByText(/Software rendering active/).waitFor({ state: "hidden" });
    await fleet.getByRole("heading", { name: "Sparks", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + "/webapp-sparks-" + size.width + ".png" });
    const rootDocument = await page.evaluateHandle(() => document);
    const recipes = fleet.getByRole("link", { name: "Recipes", exact: true });
    const catalog = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/api/plugins/sparkie-recipes/catalog"));
    await recipes.click();
    assert.ok((await catalog).ok(), "The unmocked recipe backend must serve the candidate.");
    const pageRecipes = page.getByRole("region", { name: "Recipes", exact: true });
    await pageRecipes.getByRole("heading", { name: "Selected setup" }).waitFor();
    await pageRecipes.getByRole("heading", { name: "Previously tested setup" }).waitFor();
    await pageRecipes.locator("summary", { hasText: "Setup details" }).first().click();
    await pageRecipes.getByText("Draft model", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, "#/recipes");
    assert.ok(await rootDocument.evaluate(doc => doc === document), "Recipes stays in the same Hermes app shell.");
    await page.screenshot({ path: output + "/webapp-recipes-" + size.width + ".png" });

    if (size.width > 800) {
      const sidebar = page.locator('[data-tour="sessions-sidebar"]');
      await sidebar.getByRole("button", { name: "Sparks", exact: true }).click();
      await fleet.getByText("Always-on host").waitFor();
      await sidebar.getByRole("button", { name: "Recipes", exact: true }).click();
      await pageRecipes.getByRole("heading", { name: "Selected setup" }).waitFor();
      await sidebar.getByRole("button", { name: "Sparks", exact: true }).click();
      await fleet.getByRole("link", { name: "Models", exact: true }).click();
      await page.waitForURL(url => url.hash === "#/settings?tab=config:model");
      await page.goBack();
      await fleet.getByRole("link", { name: "Ask Sparkie", exact: true }).click();
      await page.waitForURL(url => url.hash === "#/");
      receipt.checks.push("Native sidebar navigation, model settings and fresh chat");
    }
    receipt.sizes.push(size.width);
    await page.close();
  }
  receipt.checks.push("Cold root opens the native Sparks workspace", "Both viewport widths fit and show the host",
    "Power buttons follow fresh observations and capabilities, retaining checked recovery for stale or uncertain status without writes",
    "Historical usage prices update on the client", "Owner request and digest confirmation stay separate",
    "Selected and previous recipes read through the actual scoped backend");
  await writeFile(output + "/webapp-sparks-result.json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    const diagnostic = await activePage.evaluate(() => ({
      path: location.pathname, route: location.hash.split("?")[0], title: document.title,
      surface: window.__HERMES_UI_SURFACE__, headings: [...document.querySelectorAll("h1,h2")].map(el => el.innerText),
      nav: [...document.querySelectorAll('[data-tour="sessions-sidebar"] button')].slice(0, 10).map(el => el.innerText),
      status: [...document.querySelectorAll('[role="status"],[role="alert"]')].slice(0, 6).map(el => el.innerText.slice(0, 100)),
    }));
    console.error(JSON.stringify({ diagnostic, pageFaults }));
    await activePage.screenshot({ path: output + "/webapp-failure.png" });
  }
  throw error;
} finally {
  await browser.close();
}
