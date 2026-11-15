/* ───────── an operation's energy at the wall (D9 as cut: one number, on its journal end line) ───────── */
// Area: record        Rules: R41, R43        Tests: op-energy.test.mjs
// Owns: none
// Timers: none        Wakes: none
// When an operation ends, its journal end line (journalOp) says how much electricity its Sparks drew at the wall while
// it ran: wh, in watt-hours, the sum over its Sparks from its start (createdAt) to its end (finishedAt). It comes from
// the wall counter the status loop already keeps (sampleEnergy, 12-status.mjs: each plug's watts every 30 s, added up
// between readings), read twice: as the operation begins (newJob) and as it ends. No timer and no plug read of its own.
// Each end is moved to the operation's own moment with the watts read last there. When the readings in hand can't cover
// the operation's time on every one of its Sparks, there is no number: noWh says why, in a few words (no plug, a plug
// not answering or giving no watts, its newest reading older than the operation, no reading counted while it ran, or
// readings that stopped part-way). Nothing is guessed, and a part of the Sparks is never summed as if it were all.
// Nothing reads the number to decide anything yet; recall shows it (operations are readable to agents, R43).

// Readings further apart than this aren't added up by the counter (addEnergy), so they can't anchor an operation's ends.
const OP_WALL_GAP_MS = 120000;
// Each Spark's wall counter as it stands now: watt-hours added so far (kWh), the seconds that had readings, the last
// reading counted ({t, w}, or null when the plug gave none then).
const opWallNow = () => Object.fromEntries(Object.entries(energy?.nodes || {}).map(([id, e]) => [id,
  { kWh: e.wallKWh || 0, s: e.wallCoverageSeconds || 0, last: e.wallLast ? { t: e.wallLast.t, w: e.wallLast.w } : null }]));
// newJob: the counter as the operation begins, kept on the job where neither publicJob nor a saved copy carries it.
function opEnergyStart(job) {
  try { Object.defineProperty(job, 'wallAtStart', { value: opWallNow(), enumerable: false }); } catch {}
}
// journalOp: { wh } or { noWh: why }, for the Sparks the operation ran on (its node and nodes).
function opWh(job) {
  try {
    const ids = [...new Set([job.node, ...(Array.isArray(job.nodes) ? job.nodes : [])])].filter(id => typeof id === 'string' && nodeById(id));
    if (!ids.length) return { noWh: 'it ran on no Spark' };
    const t0 = Date.parse(job.createdAt), t1 = Date.parse(job.finishedAt), at0 = job.wallAtStart || {}, now = opWallNow();
    let wh = 0;
    for (const id of ids) {
      const name = sparkName(nodeById(id)), w = wallFor(id), a = at0[id], b = now[id];
      const why = !w ? `${name} has no plug Spark Console reads`
        : !w.answering ? `${name}’s plug isn’t answering`
        : typeof w.watts !== 'number' ? `${name}’s plug gives no watts`
        : !(Date.parse(w.at) >= t0) ? `${name}’s newest plug reading is older than the operation`
        : !b?.last || b.last.t < t0 ? `no reading of ${name}’s plug was counted while it ran`
        : !a?.last || t0 - a.last.t > OP_WALL_GAP_MS ? `no reading of ${name}’s plug was counted as it began`
        : b.kWh < a.kWh || (b.last.t - a.last.t) / 1000 - (b.s - a.s) > 1 || t1 - b.last.t > OP_WALL_GAP_MS ? `${name}’s plug readings stopped for a while during it`
        : null;
      if (why) return { noWh: why };
      // (what the counter added between the two readings, less the stretch before the start, plus the stretch after the
      // last reading, each at the watts read at its end)
      wh += (b.kWh - a.kWh) * 1000 - (a.last.w * (t0 - a.last.t)) / 3.6e6 + (b.last.w * (t1 - b.last.t)) / 3.6e6;
    }
    return { wh: Math.max(0, Math.round(wh * 100) / 100) };
  } catch { return { noWh: 'it couldn’t be worked out' }; }
}
