/* ───────── a start wakes both Sparks a model across two needs (R56) ───────── */
// Area: features        Rules: R41, R56        Tests: power-wake-pair.test.mjs, power-wake.test.mjs
// Owns: none
// Timers: none        Wakes: none
// A start that names no Spark and has to wake one (wakeOne, 21-power.mjs; startModel, 17-changes.mjs) wakes the two a
// model across two Sparks needs. How many it needs is read from what the start already knows, never guessed: for a
// model on a disk of a Spark that is on, its own need as plan() reckons it (05-library.mjs: its spark.json's memoryGiB,
// else its size and 15%), against a Spark's memory less the 8 GB kept free (a sleeping Spark's from its record, one
// that is on from the live look); for one to download, the recipe's versions (`sparks`, `needGB`). Its partner is the
// other end of a cable between two compute Sparks that passed its test: never the hub, which is never asleep and never
// holds part of a model. A model that fits on one Spark wakes one, as before.

// The model's own memory need in bytes, as plan() reckons it.
function wakeNeedOf(m) {
  return m?.manifest?.memoryGiB ? m.manifest.memoryGiB * 2 ** 30 : Math.round((m?.sizeBytes || 0) * 1.15);
}
// Whether a model on disk may run across two Sparks at all: from Recipes (placeModel), not a draft, on an engine that
// pairs (pairOptions).
function wakeMayPair(m) {
  return Boolean(m) && m.role !== 'draft' && Boolean(ENGINES[engineOf(m)]?.pairs) && inRecipes(m);
}
// The compute Spark at the other end of this one's tested cable, or null.
function wakePartner(id) {
  const hub = brainSparks(), p = (lastCheck?.pairs || []).find(x => x.fastLink === 'full' && [x.a, x.b].includes(id) && ![x.a, x.b].some(s => hub.includes(s)));
  return p ? (p.a === id ? p.b : p.a) : null;
}
// After a wake, whether the model on disk can only run across two Sparks: no compute Spark that is on holds its need
// alone, by the live look. Only then may a start that still fits nowhere wake once more (its partner, startModel); a
// model that fits on one Spark never does.
function wakeNeedsTwo(m, inv) {
  const on = inv.sparks.filter(s => s.online && computeSparks().includes(s.id) && Number.isFinite(s.memTotal));
  return wakeMayPair(m) && on.length > 0 && on.every(s => s.memTotal - HEADROOM < wakeNeedOf(m));
}
