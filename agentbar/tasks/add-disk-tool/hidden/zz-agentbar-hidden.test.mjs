// The agent bar's check for add-disk-tool (not shown to the agent): a key that only looks can call disk_free through
// the agent door, and gets each online stand-in Spark with its free disk in GB (the stand-ins' df says 3.3 TB, so
// anything from 2,500 to 3,500 counts: GB or GiB, rounded either way).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFleet, createKey, call } from './lib.mjs';

let key;
useFleet({ watchMs: 60000, statusMs: 20000 }, async () => { key = (await createKey('agentbar')).token; });

test('agent bar: disk_free lists each online Spark with its free disk in GB', { timeout: 180000 }, async () => {
  const r = await call(key, 'disk_free', {});
  assert.equal(r.isError, false, r.text);
  const v = r.value;
  const rows = Array.isArray(v) ? v : Object.values(v || {}).find(Array.isArray);
  assert.ok(Array.isArray(rows) && rows.length >= 2, `expected a list of Sparks: ${JSON.stringify(v).slice(0, 600)}`);
  for (const x of rows) {
    const id = x.spark ?? x.id ?? x.name;
    assert.match(String(id), /^spark\d$/, JSON.stringify(x));
    const gb = Number(Object.entries(x).find(([k, val]) => /free|gb|disk/i.test(k) && Number.isFinite(Number(val)))?.[1]);
    assert.ok(gb > 2500 && gb < 3500, `free disk in GB for ${id}: ${JSON.stringify(x)}`);
  }
});
