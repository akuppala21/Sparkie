// Covers: The Home cards' owner power controls, including the hub's Always on label, pending operations, cancellation
// and server-issued confirmations. The monthly electricity total and month selector stay together and display measured
// wall readings, partial coverage, and months without readings. Runs the page's own functions against stand-in data.
import './file-limit.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function pageFunctions(context, ...names) {
  const source = names.map(name => {
    const found = new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{\\n[\\s\\S]*?^\\}`, 'm').exec(APP);
    assert.ok(found, `${name} is in public/app.js`);
    return found[0];
  }).join('\n');
  return vm.runInNewContext(`${source}\n({ ${names.join(', ')} })`, context);
}

const copy = value => JSON.parse(JSON.stringify(value));
const children = kids => kids.flat(Infinity).filter(kid => kid != null && kid !== false);
const h = (tag, attrs = {}, ...kids) => ({ tag, attrs, kids: children(kids), dataset: {}, value: attrs.value ?? '',
  disabled: Boolean(attrs.disabled), textContent: '', append(...items) { this.kids.push(...items); } });
const set = (el, ...kids) => { el.kids = children(kids); };
const text = el => typeof el === 'string' ? el : el.textContent + el.kids.map(text).join('');
function find(el, match) {
  if (!el || typeof el === 'string') return null;
  return match(el) ? el : el.kids.map(kid => find(kid, match)).find(Boolean);
}
const byClass = (el, cls) => find(el, e => (e.attrs.class || '').split(' ').includes(cls));

function powerPage({ dialogs = [], replies = [], follow, running = [], online = false } = {}) {
  const nodes = [
    { id: 'spark1', name: 'Spark 1' }, { id: 'spark2', name: 'Spark 2', wall: { answering: true } },
    { id: 'spark3', name: 'Spark 3', wall: { answering: true } },
  ];
  const state = { boot: { hubId: 'spark1', computeIds: ['spark2', 'spark3'] },
    status: { power: { switchable: ['spark1', 'spark2', 'spark3'],
      bySpark: { spark1: { state: 'on' }, spark2: { state: 'off' }, spark3: { state: 'on' } } } },
    powerRequests: new Set(), statusError: null };
  const env = { owner: true, stale: false, online };
  const jobs = [], requests = [], modals = [], followed = [], looked = [], errors = [], callbacks = [], navigated = [];
  const node = id => nodes.find(n => n.id === id);
  const runLive = () => { for (const fn of callbacks) fn(); };
  const ui = pageFunctions({
    state, node, owner: () => env.owner, portalHostId: () => state.boot.hubId, isStale: () => env.stale,
    activityJobs: () => jobs, underWay: job => job.status === 'running',
    h, set, runLive, live: fn => { callbacks.push(fn); fn(); }, fast: () => {},
    condition: () => 'asleep', isUp: () => env.online, workloads: () => running,
    hardware: () => 'DGX Spark', condPill: cond => h('span', {}, cond), icon: () => h('svg'), led: () => h('span'),
    conn: () => null, canSparkChat: () => false, menuButton: () => h('button', {}, 'More actions'), openButton: () => null,
    ASSISTANT: 'Sparkie', go: target => navigated.push(target),
    async capi(path, method, body, headers) {
      requests.push(copy({ path, method, body, headers }));
      assert.ok(replies.length, `unexpected action request to ${path}`);
      return replies.shift();
    },
    async dialog(value) { modals.push(copy(value)); assert.ok(dialogs.length, 'unexpected dialog'); return dialogs.shift(); },
    async followServiceJob(job) { followed.push(copy(job)); if (follow) await follow(job); },
    async loadStatus(fresh) { looked.push(fresh); }, async loadJobs() {},
    failToast: err => errors.push(err.message), toast() {},
  }, 'sparkPowerControl', 'sparkPowerButton', 'changeSparkPower', 'sparkCard');
  return { state, env, jobs, node, ui, runLive, requests, modals, followed, looked, errors, navigated };
}

const button = (page, id) => page.ui.sparkPowerButton(page.node(id), page.ui.sparkPowerControl(page.node(id)));
const selectSpark = spark => ({ path: 'actions/power_off', method: 'POST', body: { spark }, headers: { 'X-Spark-Power-Card': '1' } });
const answer = choice => ({ path: 'actions/power_off', method: 'POST', body: { choice }, headers: { 'X-Spark-Power-Card': '1' } });
function powerQuestion(question, label, choice) {
  return { outcome: 'question', question, choices: [
    { label, choice, ...(choice ? { call: { action: 'power_off', args: { choice } } } : {}) },
    { label: 'No, leave it on', choice: null },
  ] };
}

test('the hub says Always on and only the owner can switch available compute Sparks', () => {
  const page = powerPage();
  const hub = button(page, 'spark1'), off = button(page, 'spark3');
  assert.equal(hub.tag, 'span');
  assert.equal(text(hub), 'Always on');
  assert.equal(hub.attrs.onclick, undefined);
  assert.equal(text(off), 'Power off');
  assert.equal(off.attrs['aria-label'], 'Power off Spark 3');
  assert.equal(text(button(page, 'spark2')), 'Power on');

  page.env.owner = false;
  assert.equal(button(page, 'spark2'), null);
  page.env.owner = true;
  page.state.status.power.switchable = ['spark2'];
  assert.equal(button(page, 'spark3'), null);
  page.node('spark2').wall.answering = false;
  assert.equal(text(button(page, 'spark2')), 'Power unavailable');
  assert.equal(button(page, 'spark2').disabled, true);
});

test('the plug controller remains a system service rather than an owner workload', () => {
  const { environmentContainer } = pageFunctions({}, 'environmentContainer');
  const workloadsLine = APP.match(/^const workloads = .+;$/m)?.[0];
  assert.ok(workloadsLine);
  const workloads = vm.runInNewContext(`${workloadsLine}\nworkloads`, { environmentContainer, containerTitle: name => name });
  assert.deepEqual(copy(workloads({ runningContainers: ['spark-console-plugs', 'open-webui', 'sparkie-main'] })), ['open-webui', 'sparkie-main']);
  assert.equal(environmentContainer('spark-console-plugs-copy'), false, 'only the known environment service is classified');
  const { workloadsTab } = pageFunctions({
    mdata: () => ({ workloads: { checkedAt: new Date().toISOString(), containers: [
      { Names: 'spark-console-plugs', State: 'running', Status: 'Up', Ports: '' },
      { Names: 'open-webui', State: 'running', Status: 'Up', Ports: '' },
    ] } }), h, set, put: (box, ...kids) => box.append(...kids), redraw: set,
    isUp: () => true, node: () => ({}), environmentContainer, containerTitle: name => name,
    fmt: { time: () => 'Now' }, icon: () => h('svg'), led: () => h('span'),
    panel: (title, body) => h('section', {}, title, body), empty: (_, title) => h('p', {}, title),
  }, 'workloadsTab');
  const box = h('div');
  workloadsTab(box, { id: 'spark1', name: 'Spark 1' });
  const regular = find(box, e => e.tag === 'section' && e.kids[0] === 'Containers');
  assert.match(text(regular), /open-webui/);
  assert.doesNotMatch(text(regular), /spark-console-plugs/);
  const details = find(box, e => e.tag === 'details');
  assert.match(text(details), /Power and electricity.*spark-console-plugs.*Up/);
});

test('a Spark card disables its footer control while a separate power operation is pending', () => {
  const page = powerPage();
  const card = page.ui.sparkCard('spark2');
  const footer = byClass(card, 'sc-foot');
  assert.equal(card.kids[0].tag, 'a');
  assert.equal(card.kids[1], footer);
  assert.equal(text(byClass(footer, 'sc-power')), 'Power on');
  page.jobs.push({ type: 'power-on', status: 'running', nodes: ['spark3', 'spark2'] });
  page.runLive();
  assert.equal(text(byClass(footer, 'sc-power')), 'Powering on…');
  assert.equal(byClass(footer, 'sc-power').disabled, true);
  page.jobs[0].status = 'completed';
  page.state.status.power.bySpark.spark2.state = 'on';
  page.runLive();
  assert.equal(text(byClass(footer, 'sc-power')), 'Power off');
  assert.equal(byClass(footer, 'sc-power').disabled, false);
});

test('clicking a card with workloads opens their details for the owner', () => {
  const page = powerPage({ running: ['open-webui'] });
  const card = page.ui.sparkCard('spark2');
  assert.equal(card.kids[0].href, '#/spark/spark2', 'offline cards keep the overview');
  page.env.online = true;
  page.runLive();
  assert.equal(card.kids[0].href, '#/spark/spark2/workloads');
  page.env.owner = false;
  page.runLive();
  assert.equal(card.kids[0].href, '#/spark/spark2', 'members keep the overview');
});

test('cancelling power off sends no action and repeated clicks open one confirmation', async () => {
  let decide;
  const pending = new Promise(resolve => { decide = resolve; });
  const page = powerPage({ dialogs: [pending] });
  const off = button(page, 'spark3'), call = off.attrs.onclick();
  assert.equal(button(page, 'spark3').disabled, true);
  await off.attrs.onclick();
  assert.equal(page.modals.length, 1);
  assert.equal(page.requests.length, 0);
  decide(null);
  await call;
  assert.equal(page.requests.length, 0);
  assert.equal(button(page, 'spark3').disabled, false);
});

test('power off sends only the selected choice for each server confirmation and follows its operation', async () => {
  const routed = powerQuestion('Stop the model that answers Sparkie and power off Spark 3?', 'Yes, stop the model', 'abcdef0001');
  const box = powerQuestion('End the open box and power off Spark 3?', 'Yes, end the box', 'abcdef0002');
  const page = powerPage({ dialogs: [true, true, true], replies: [
    routed, box, { outcome: 'started', operation: '123456789abc', sparks: ['spark3'] },
  ] });
  await button(page, 'spark3').attrs.onclick();
  assert.deepEqual(page.requests, [selectSpark('spark3'), answer('abcdef0001'), answer('abcdef0002')]);
  assert.deepEqual(page.modals.slice(1).map(x => [x.description, x.confirm, x.cancel]), [
    [routed.question, routed.choices[0].label, routed.choices[1].label],
    [box.question, box.choices[0].label, box.choices[1].label],
  ]);
  assert.deepEqual(page.followed.map(j => [j.id, j.type, j.node]), [['123456789abc', 'power-off', 'spark3']]);
  assert.deepEqual(page.looked, [true]);
  assert.deepEqual(page.errors, []);
});

test('a declined or unavailable server choice sends no redemption', async () => {
  const question = 'Power off Spark 3 after stopping its model?';
  for (const choice of ['abcdef0001', null]) {
    const page = powerPage({ dialogs: [true, null], replies: [powerQuestion(question, 'Stop it', choice)] });
    await button(page, 'spark3').attrs.onclick();
    assert.deepEqual(page.requests, [selectSpark('spark3')]);
    assert.equal(page.modals[1].description, question);
    assert.deepEqual(page.followed, []);
    assert.deepEqual(page.navigated, []);
  }
});

test('power on uses the normal action once while its operation is pending', async () => {
  let finish;
  const following = new Promise(resolve => { finish = resolve; });
  const page = powerPage({ replies: [{ outcome: 'started', operation: '123456789abc', sparks: ['spark2'] }], follow: () => following });
  const on = button(page, 'spark2'), call = on.attrs.onclick();
  await on.attrs.onclick();
  assert.deepEqual(page.requests, [{ path: 'actions/power_on', method: 'POST', body: { spark: 'spark2' }, headers: { 'X-Spark-Power-Card': '1' } }]);
  assert.deepEqual(page.modals, []);
  assert.deepEqual(page.followed.map(j => j.type), ['power-on']);
  assert.equal(button(page, 'spark2').disabled, true);
  finish();
  await call;
  assert.equal(button(page, 'spark2').disabled, false);
});

test('the page marker and exact choice body survive an owner passkey challenge', async () => {
  const requests = [], confirmations = [];
  const { capi } = pageFunctions({
    CONSOLE_API: '/console/api/', state: { boot: true },
    async fetch(url, options) {
      requests.push(copy({ url, ...options }));
      return requests.length === 1 ? { ok: false, status: 428, json: async () => ({ passkey: 'confirm' }) }
        : { ok: true, status: 200, json: async () => ({ outcome: 'started' }) };
    },
    async confirmWithPasskey(...args) { confirmations.push(args); return 'signed-challenge'; },
    removalNote() {},
  }, 'capi');
  await capi('actions/power_off', 'POST', { choice: 'abcdef0001' }, { 'X-Spark-Power-Card': '1' });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(r => [r.url, r.body, r.headers['X-Spark-Power-Card']]),
    requests.map(() => ['/console/api/actions/power_off', '{"choice":"abcdef0001"}', '1']));
  assert.deepEqual(confirmations, [['POST', 'actions/power_off', '{"choice":"abcdef0001"}']]);
  assert.equal(requests[1].headers['X-Spark-Passkey'], 'signed-challenge');
});

test('the electricity total and month selector show recorded wall use together', () => {
  let update;
  const monthly = { timeZone: 'America/Los_Angeles', currentMonth: '2026-11', months: [
    { month: '2026-10', kWh: 0, partial: false },
    { month: '2026-09', kWh: 2.5, partial: true },
    { month: '2026-11', kWh: 1.234, partial: true },
    { month: '2026-08', kWh: null, partial: true },
  ] };
  const { electricityStat } = pageFunctions({ state: { status: { energy: { kWh: 999, wallMonthly: monthly } } },
    h, set, icon: () => h('svg'), num: Number.isFinite, live: fn => { update = fn; fn(); } }, 'electricityStat');
  const tile = electricityStat(), total = byClass(tile, 'stat-value'), coverage = byClass(tile, 'stat-foot');
  const select = find(tile, e => e.tag === 'select');
  assert.equal(select.attrs['aria-label'], 'Electricity month (Pacific time)');
  assert.deepEqual(select.kids.map(o => [o.value, text(o)]), [
    ['2026-11', 'Nov 2026'], ['2026-10', 'Oct 2026'], ['2026-09', 'Sep 2026'],
  ]);
  assert.equal(select.value, '2026-11');
  assert.equal(text(total), '1.23kWh');
  assert.equal(text(coverage), 'Partial coverage');

  select.value = '2026-10';
  select.attrs.onchange();
  assert.equal(text(total), '0kWh');
  assert.equal(text(coverage), 'Measured at the plugs');
  monthly.currentMonth = '2026-12';
  monthly.months.push({ month: '2026-12', kWh: null, partial: true });
  update();
  assert.equal(select.value, '2026-10');
  assert.equal(text(total), '0kWh');
  select.value = '2026-12';
  select.attrs.onchange();
  assert.equal(text(total), '—');
  assert.equal(text(coverage), 'No plug readings');
  monthly.currentMonth = '2027-01';
  monthly.months.push({ month: '2027-01', kWh: 3, partial: true });
  update();
  assert.equal(select.value, '2027-01');
  assert.equal(text(total), '3kWh');
});
