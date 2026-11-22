// Native signed-in Hermes panel with the explicit dashboard_fixture.py dispatcher.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const base = process.env.SPARKIE_TEST_URL;
const output = process.env.SPARKIE_BROWSER_OUTPUT;
const login = JSON.parse(await readFile(process.env.SPARKIE_TEST_LOGIN, "utf8"));
await mkdir(output, { recursive: true });
const report = { scope: "Native dashboard owner controls with stand-in effects; no real fleet changes", checks: [] };
const started = performance.now();
const browser = await chromium.launch({ executablePath: process.env.SPARKIE_TEST_CHROME, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
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
  assert.equal(await panel.getByRole("button", { name: /(?:Wake|Shut down) Spark 1/ }).count(), 0);
  await panel.getByRole("button", { name: "Wake Spark 2", exact: true }).click();
  await panel.getByText("Wake Spark 2.", { exact: true }).waitFor();
  await panel.getByText("Waiting for your confirmation. Nothing has run.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Spark change requests");
  let state = await (await page.request.get(base + "/api/plugins/sparkie-sparks/controls")).json();
  const operation = state.operations.find(row => row.intent.spark === "spark2" && row.state === "pending");
  assert.ok(operation);
  await panel.getByRole("button", { name: "Run it", exact: true }).click();
  await panel.getByText("The requested result was observed.", { exact: true }).waitFor();
  const replay = await page.request.post(base + "/api/plugins/sparkie-sparks/operations/" + operation.id + "/confirm", { data: { digest: operation.digest } });
  assert.equal(replay.status(), 403);
  assert.equal(await panel.getByRole("button", { name: "Run it", exact: true }).count(), 0);
  const card = panel.getByRole("button", { name: "Wake Spark 2", exact: true });
  const requests = panel.getByRole("region", { name: "Spark change requests", exact: true });
  assert.ok((await card.boundingBox()).y < (await requests.boundingBox()).y,
    "The Spark controls must appear before completed request history");
  report.checks.push("Desktop power request shows exact intention; Run it completes once; replay refused; no host power buttons");
  await page.screenshot({ path: output + "/desktop-controls.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole("button", { name: "Shut down Spark 3", exact: true }).click();
  await panel.getByText("Shut down Spark 3 only if its work is safely idle.", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await panel.getByText("Cancelled before sending. Nothing ran.", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByText("Cancelled before sending. Nothing ran.", { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: output + "/phone-controls.png", fullPage: true });
  state = await (await page.request.get(base + "/api/plugins/sparkie-sparks/controls")).json();
  assert.equal(state.operations.find(row => row.intent.spark === "spark3").state, "cancelled");
  await panel.getByRole("button", { name: "Wake Spark 4", exact: true }).click();
  state = await (await page.request.get(base + "/api/plugins/sparkie-sparks/controls")).json();
  const lost = state.operations.find(row => row.intent.spark === "spark4" && row.state === "pending");
  assert.ok(lost);
  let confirmations = 0;
  await page.route(url => url.pathname.endsWith("/operations/" + lost.id + "/confirm"), async route => {
    confirmations++;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort("failed"); // Commit happened, but the browser never receives its reply.
  });
  await panel.getByRole("button", { name: "Run it", exact: true }).click();
  await panel.getByText("The reply could not be loaded. Refresh and check the request before trying again.", { exact: true }).waitFor();
  state = await (await page.request.get(base + "/api/plugins/sparkie-sparks/controls")).json();
  assert.equal(state.operations.find(row => row.id === lost.id).state, "succeeded");
  assert.equal(confirmations, 1);
  // The error is shown before the automatic readback finishes. Wait for this
  // exact request's verified result before checking that its old button is gone.
  await requests.getByText("Request: " + lost.id, { exact: true }).locator("..")
    .getByText("The requested result was observed.", { exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Run it", exact: true }).count(), 0);
  await panel.getByRole("button", { name: "Wake Spark 3", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: output + "/phone-power.png", fullPage: true });
  assert.deepEqual(errors, []);
  report.checks.push("Phone shutdown can be cancelled before dispatch; results survive refresh; layout fits 390px");
  report.checks.push("A lost confirmation response is reconciled by a read; the browser never sends a duplicate change");
  // Only connected actions belong on each card, even if another Spark supports
  // more. Intercept display data only; the Python cases exercise actual refusal.
  await page.route(url => url.pathname === "/api/plugins/sparkie-sparks/controls", async route => {
    const response = await route.fetch();
    const current = await response.json();
    current.by_spark.spark2 = { actions: [], message: "Power controls are not connected for this Spark." };
    current.by_spark.spark3 = { actions: ["wake"], message: "Shutdown is unavailable until its restart path has been checked." };
    return route.fulfill({ json: current });
  });
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByText("Power controls are not connected for this Spark.", { exact: true }).waitFor();
  assert.equal(await panel.getByText("The reply could not be loaded. Refresh and check the request before trying again.", { exact: true }).count(), 0,
    "A successful manual refresh must clear the older transport error");
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await panel.getByRole("button", { name: "Wake Spark 2", exact: true }).count(), 0);
    assert.equal(await panel.getByRole("button", { name: "Shut down Spark 3", exact: true }).count(), 0);
    assert.equal(await panel.getByRole("button", { name: "Wake Spark 3", exact: true }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: output + (viewport.width === 390 ? "/phone-availability.png" : "/desktop-availability.png"), fullPage: true });
  }
  report.checks.push("Desktop and phone show only each Spark's connected actions with an explanation for unavailable power controls");
  await page.unroute(url => url.pathname === "/api/plugins/sparkie-sparks/controls");
  const eraseForm = requests.locator("details").filter({ hasText: "Erase memory" });
  await eraseForm.locator("summary").click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await eraseForm.getByLabel("Exact text").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  const marker = "sparkieBrowserEraseFixture";
  await eraseForm.getByLabel("Store").selectOption("user");
  await eraseForm.getByLabel("Exact text").fill(marker);
  const prepared = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/memory/erase"));
  await eraseForm.getByRole("button", { name: "Review erase" }).click();
  const pending = await (await prepared).json();
  assert.equal(pending.state, "pending", "Preparing the scope must perform no erasure");
  assert.ok(!JSON.stringify(pending).includes(marker), "The scope must omit the text to erase");
  const erasure = requests.getByText("Request: " + pending.id, { exact: true }).locator("..");
  await erasure.getByText(/Permanently erase the exact text you entered/).waitFor();
  await erasure.getByText(/Telegram history, exports, backups and external records require separate deletion/).waitFor();
  await erasure.getByRole("button", { name: "Erase memory", exact: true }).click();
  await erasure.getByText("The requested result was observed.", { exact: true }).waitFor();
  const retry = await page.request.post(base + "/api/plugins/sparkie-sparks/memory/erase", {
    data: { request_id: "f".repeat(32), target: "user", literal: marker },
  });
  assert.equal(retry.status(), 400, "The verified erase must remove the native memory entry");
  await page.screenshot({ path: output + "/phone-memory-erasure.png", fullPage: true });
  assert.deepEqual(errors, []);
  report.checks.push("The desktop and phone erasure form previews a private scope and requires a separate confirmation");
  if (process.env.SPARKIE_TEST_RECOVERY === "1") {
    const preparedRecovery = await page.request.post(base + "/api/plugins/sparkie-sparks/operations", {
      data: { request_id: "d".repeat(32), action: "stop_workload", spark: "spark2", container: "d".repeat(64) },
    });
    assert.equal(preparedRecovery.status(), 200);
    const recovery = await preparedRecovery.json();
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    const recoveryCard = requests.getByText("Request: " + recovery.id, { exact: true }).locator("..");
    let recoveryDispatches = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname.endsWith("/operations/" + recovery.id + "/confirm")) recoveryDispatches++;
    });
    await recoveryCard.getByRole("button", { name: "Run it", exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await recoveryCard.getByText("The container is running.", { exact: true }).waitFor();
      await recoveryCard.locator('[data-recovery-policy="keep_request"]').waitFor();
      assert.equal(await recoveryCard.getByRole("button", { name: "Run it", exact: true }).count(), 0);
      assert.match(await recoveryCard.locator('[data-recovery-policy="keep_request"]').innerText(), /does not complete this operation/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await recoveryCard.scrollIntoViewIfNeeded();
      await page.screenshot({ path: output + (width === 390 ? "/phone-recovery.png" : "/desktop-recovery.png"), fullPage: true });
    }
    await recoveryCard.getByRole("button", { name: "Check result", exact: true }).click();
    const recoveryUrl = base + "/api/plugins/sparkie-sparks/operations/" + recovery.id;
    const unresolved = await (await page.request.get(recoveryUrl)).json();
    assert.equal(unresolved.state, "uncertain");
    assert.equal(unresolved.recovery.operation_terminal, false);
    assert.equal(unresolved.recovery.retry_policy, "keep_request");
    await recoveryCard.getByRole("button", { name: "Check result", exact: true }).click();
    await recoveryCard.locator('[data-recovery-policy="review_required"]').waitFor();
    const failedRecovery = await (await page.request.get(recoveryUrl)).json();
    assert.equal(failedRecovery.state, "failed");
    assert.equal(failedRecovery.recovery.operation_terminal, true);
    assert.equal(await recoveryCard.getByRole("button", { name: "Check result", exact: true }).count(), 0);
    assert.equal(await recoveryCard.getByRole("button", { name: "Run it", exact: true }).count(), 0);
    assert.equal(recoveryDispatches, 1, "Result checks must not send another change");
    assert.deepEqual(errors, []);
    report.checks.push("Desktop and phone show authoritative same-request recovery despite a separate running-container observation; checks resolve the original request without retry");
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
