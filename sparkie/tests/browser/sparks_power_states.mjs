import assert from "node:assert/strict";

// Exercise the same display contract in both native Hermes shells. Observations
// are fixture data: refreshing them must never prepare or dispatch a power change.
export async function verifyPowerStates(page, panel, sparks, bySpark) {
  const savedSparks = structuredClone(sparks);
  const savedCapabilities = structuredClone(bySpark);
  const writes = [];
  const record = request => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.includes("/api/plugins/sparkie-sparks/")) writes.push(request.url());
  };
  page.on("request", record);
  const refresh = async () => {
    const reads = ["fleet", "controls"].map(path => page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith("/api/plugins/sparkie-sparks/" + path)));
    await panel.getByRole("button", { name: "Refresh", exact: true }).click();
    for (const response of await Promise.all(reads)) assert.ok(response.ok());
    await panel.getByRole("button", { name: "Refresh", exact: true }).waitFor();
  };
  try {
    const cases = [
      [["online", false, ["sleep"]], ["off", false, ["wake"]], ["unreachable", false, ["wake", "sleep"]]],
      [["online", true, ["wake", "sleep"]], ["off", true, ["wake", "sleep"]], ["unknown", false, ["wake", "sleep"]]],
      [["starting", false, ["wake", "sleep"]], ["stopping", false, ["wake", "sleep"]], ["online", undefined, ["wake", "sleep"]]],
      [["off", false, [], []], ["online", false, [], ["wake"]], ["off", false, [], ["sleep"]]],
    ];
    for (const batch of cases) {
      for (const [index, [state, stale, , capabilities = ["wake", "sleep"]]] of batch.entries()) {
        const id = "spark" + (index + 2);
        Object.assign(sparks.find(spark => spark.id === id), { observed_state: state, stale });
        bySpark[id] = { actions: capabilities };
      }
      await refresh();
      assert.equal(await panel.getByRole("button", { name: /^(?:Wake|Shut down) Spark 1$/ }).count(), 0);
      for (const [index, [state, stale, expected]] of batch.entries()) {
        for (const [action, label] of [["wake", "Wake"], ["sleep", "Shut down"]]) {
          const button = panel.getByRole("button", { name: label + " Spark " + (index + 2), exact: true });
          await button.waitFor({ state: expected.includes(action) ? "visible" : "hidden", timeout: 3000 });
          assert.equal(await button.count(), expected.includes(action) ? 1 : 0,
            `${label} on ${state}, stale=${stale} must follow fresh state and configured capability`);
        }
      }
    }
    assert.deepEqual(writes, [], "Status refresh and power-button filtering must not prepare or dispatch changes");
  } finally {
    sparks.splice(0, sparks.length, ...savedSparks);
    for (const key of Object.keys(bySpark)) delete bySpark[key];
    Object.assign(bySpark, savedCapabilities);
    await refresh();
    page.off("request", record);
  }
}
