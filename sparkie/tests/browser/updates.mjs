// Native authenticated Home with a private stand-in for the privileged steward.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const base = process.env.SPARKIE_TEST_URL;
const output = process.env.SPARKIE_BROWSER_OUTPUT;
const login = JSON.parse(await readFile(process.env.SPARKIE_TEST_LOGIN, "utf8"));
const browser = await chromium.launch({ executablePath: process.env.SPARKIE_TEST_CHROME, headless: true });
const report = { scope: "Native Home update review, installation decision and recovery with a stand-in steward", views: [] };
const start = performance.now();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(base + "/sparks");
  await page.locator('input[name="username"]').fill(login.username);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator("form.provider-form button[type=submit]").click();
  const home = page.getByRole("region", { name: "Sparks", exact: true });
  const metrics = page.getByRole("button", { name: "No thanks", exact: true });
  if (await metrics.isVisible()) await metrics.click();
  await home.getByText("Update Sparkie", { exact: true }).click();
  await home.getByLabel("Proposal SHA-256").fill("c".repeat(64));
  const pending = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/updates"));
  await home.getByRole("button", { name: "Review update" }).click();
  const row = await (await pending).json();
  assert.equal(row.state, "pending");
  const card = home.getByText("Request: " + row.id, { exact: true }).locator("..");
  const install = card.getByRole("button", { name: "Install this version" });
  await install.waitFor();
  await page.reload();
  const reopen = card.getByRole("button", { name: "Review update details" });
  await reopen.waitFor();
  assert.equal(await install.count(), 0);
  await reopen.click();
  await install.waitFor();
  if (await metrics.isVisible()) await metrics.click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    const text = await card.innerText();
    for (const value of [row.intent.proposal, ...Object.values(row.intent.review)]) assert.ok(text.includes(value), value);
    await install.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find(item => item.textContent === "Install this version");
      if (!button || !button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      for (let node = button; node; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) < 0.99) return false;
      }
      return true;
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await card.screenshot({ path: output + "/" + width + "-review.png", animations: "disabled" });
    report.views.push(width);
  }
  const confirmedPath = "/operations/" + row.id + "/confirm";
  let sends = 0;
  await page.route(url => url.pathname.endsWith(confirmedPath), async route => {
    sends++;
    assert.equal((await route.fetch()).status(), 200);
    await route.abort("failed");
  });
  await install.click();
  const keep = card.getByRole("button", { name: "Keep this version" });
  await keep.waitFor();
  assert.equal(sends, 1);
  assert.equal(await install.count(), 0);
  await keep.click();
  await card.getByText("You accepted the installed version after checking it.", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Restore previous version" }).click();
  await card.getByText(/The previous release was restored\./).waitFor();
  const result = await (await page.request.get(base + "/api/plugins/sparkie-sparks/operations/" + row.id)).json();
  assert.equal(result.update.state, "rolled_back");
  assert.equal(await card.getByRole("button", { name: "Keep this version" }).count(), 0);
  report.result = result.update.state;
  report.installRequests = sends;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error.message).replaceAll(login.password, "[redacted]");
  process.exitCode = 1;
} finally {
  await browser.close();
  report.elapsed_seconds = (performance.now() - start) / 1000;
  await writeFile(output + "/result.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
