// Native authenticated dashboard; effects are dashboard_fixture.py stand-ins.
// Only observation delivery is delayed. No fleet, model, bot or approval replay.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const base = process.env.SPARKIE_TEST_URL;
const output = process.env.SPARKIE_BROWSER_OUTPUT;
const login = JSON.parse(await readFile(process.env.SPARKIE_TEST_LOGIN, "utf8"));
await mkdir(output, { recursive: true });
const report = { scope: "Native desktop/phone controls with delayed stand-in observations; no physical effects", checks: [] };
const started = performance.now();
const browser = await chromium.launch({ executablePath: process.env.SPARKIE_TEST_CHROME, headless: true });
const settle = () => new Promise(resolve => setTimeout(resolve, 100));
try {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/sparks");
    await page.locator('input[name="username"]').fill(login.username);
    await page.locator('input[name="password"]').fill(login.password);
    await page.locator('form.provider-form button[type="submit"]').click();
    const panel = page.getByRole("region", { name: "Sparks", exact: true });
    await panel.getByRole("heading", { name: "Sparks", exact: true }).waitFor({ timeout: 30000 });
    const metrics = page.getByRole("button", { name: "No thanks", exact: true });
    if (await metrics.isVisible()) await metrics.click();
    await page.clock.install();
    let operation = null;
    let mode = "idle";
    let delayedReads = 0;
    let controlsReads = 0;
    let confirmations = 0;
    let loseReply = false;
    let fleetReads = 0;
    let energyReads = 0;
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/plugins/sparkie-sparks/fleet") fleetReads++;
      if (path === "/api/plugins/sparkie-sparks/energy") energyReads++;
      if (request.method() === "POST" && path.endsWith("/confirm")) confirmations++;
    });
    await page.route(url => url.pathname.endsWith("/confirm"), async route => {
      if (!loseReply) return route.continue();
      loseReply = false;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    });
    await page.route(url => url.pathname === "/api/plugins/sparkie-sparks/controls", async route => {
      controlsReads++;
      if (mode === "error") return route.fulfill({ status: 503, json: { detail: "Fixture observation unavailable" } });
      const response = await route.fetch();
      const current = await response.json();
      const row = current.operations?.find(value => value.id === operation);
      if (row?.state === "succeeded" && (mode === "hold" || mode === "delayed" && delayedReads++ < 2)) {
        row.state = delayedReads > 1 ? "uncertain" : "dispatching";
        row.message = "Fixture: waiting for the recorded result.";
        row.can_confirm = false;
        row.can_cancel = false;
        row.can_check = true;
      }
      await route.fulfill({ json: current });
    });
    const card = () => panel.getByText("Request: " + operation, { exact: true }).locator("..");
    const advanceRead = async () => {
      const response = page.waitForResponse(url => new URL(url.url()).pathname === "/api/plugins/sparkie-sparks/controls");
      await page.clock.fastForward(3000);
      await response;
      await settle();
    };
    const prepareAndConfirm = async (nextMode, lostReply = false) => {
      mode = "idle";
      await panel.getByRole("button", { name: "Wake Spark 2", exact: true }).click();
      await panel.getByText("Waiting for your confirmation. Nothing has run.", { exact: true }).waitFor();
      const state = await (await page.request.get(base + "/api/plugins/sparkie-sparks/controls")).json();
      operation = state.operations.find(row => row.intent.spark === "spark2" && row.state === "pending").id;
      mode = nextMode;
      delayedReads = 0;
      loseReply = lostReply;
      await card().getByRole("button", { name: "Run it", exact: true }).click();
      await card().getByText("Fixture: waiting for the recorded result.", { exact: true }).waitFor();
      await settle();
    };
    const noMoreReads = async () => {
      await settle();
      const count = controlsReads;
      await page.clock.fastForward(15000);
      await settle();
      assert.equal(controlsReads, count, "Controls refresh continued when it should have stopped");
    };

    await noMoreReads();
    await prepareAndConfirm("delayed");
    const otherReads = [fleetReads, energyReads];
    await advanceRead();
    await advanceRead();
    await card().getByText("The requested result was observed.", { exact: true }).waitFor();
    assert.equal(confirmations, 1, "Completion polling resent a confirmation");
    assert.equal(await card().getByRole("button", { name: "Run it", exact: true }).count(), 0);
    assert.deepEqual([fleetReads, energyReads], otherReads, "Completion refresh fetched unrelated views");
    await noMoreReads();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: output + (viewport.width === 390 ? "/phone-completion.png" : "/desktop-completion.png"), fullPage: true });

    await prepareAndConfirm("delayed", true);
    await panel.getByText("The reply could not be loaded. Refresh and check the request before trying again.", { exact: true }).waitFor();
    await advanceRead();
    await advanceRead();
    await card().getByText("The requested result was observed.", { exact: true }).waitFor();
    assert.equal(confirmations, 2, "A lost confirmation reply was resent while checking its status");
    await noMoreReads();

    // A visibility event pauses reads; returning to the panel resumes a read,
    // never the already-confirmed change.
    await prepareAndConfirm("hold");
    await page.evaluate(() => {
      window.__sparkieHidden = true;
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__sparkieHidden ? "hidden" : "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await noMoreReads();
    mode = "idle";
    await page.evaluate(() => { window.__sparkieHidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    await advanceRead();
    await card().getByText("The requested result was observed.", { exact: true }).waitFor();
    assert.equal(confirmations, 3);

    await prepareAndConfirm("hold");
    mode = "error";
    await advanceRead();
    await panel.getByText("The request status could not be loaded. Refresh to check it.", { exact: true }).waitFor();
    await noMoreReads();
    assert.equal(confirmations, 4);
    mode = "idle";
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    await card().getByText("The requested result was observed.", { exact: true }).waitFor();

    await prepareAndConfirm("hold");
    const beforeDeadline = controlsReads;
    await page.clock.fastForward(481000);
    await panel.getByText("Still waiting for a verified result. Refresh to keep checking.", { exact: true }).waitFor();
    assert.equal(controlsReads, beforeDeadline);
    await noMoreReads();
    mode = "idle";
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    await card().getByText("The requested result was observed.", { exact: true }).waitFor();

    await prepareAndConfirm("hold");
    await page.evaluate(() => {
      window.__sparkieSameDocument = true;
      history.pushState({}, "", "/sessions");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    await panel.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.__sparkieSameDocument), true, "Unmount test reloaded the document");
    await noMoreReads();
    assert.equal(confirmations, 6);
    assert.deepEqual(errors, []);
    report.checks.push(`${viewport.width}px: delayed completion and lost-reply result appear automatically; only controls reads; one confirmation per action; idle, hidden, terminal, failed, eight-minute limit and unmounted polling stop`);
    await page.close();
  }
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
