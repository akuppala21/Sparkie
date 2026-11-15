/* ───────── what Sparkie's memory lines are about: their names, and an index of them ───────── */
// Area: record        Rules: R45        Tests: memory.test.mjs
// Owns: none        Timers: none        Wakes: none
// Each memory line says what it is about (`about`, G2a): up to five names of things Spark Console itself knows, found by
// code in the line's own words when it is saved: never by a model, and never by reading a file then. A name is a Spark
// ("spark4"), a model (a recipe's id, "glm-5.3-flash"), a container, an app, a setup (one of the brain's, "aphex-x4", or a
// recipe's, by its id), a person (the owner, a member) or an agent, each kept in one form, lower case. The names come
// from a book of what the console lists (memoryNameBook): made at start, and again at most once a minute when memory is
// used, after the call that used it. A name counts only as whole words: "aphexian" names no setup, and a model's name in
// a web address names nothing. A line saved before names were kept gets its names the first time memory is read after
// start (in memory; they are written with it the next time memory.json is saved). An index from each name to the live
// lines about it is kept in memory (memoryIndexNow): made at start, after every save, and again only when memory.json
// changed under it, so while the file is as it was it reads nothing. Sparkie isn't shown the names yet (G2b, the picker).
const ABOUT_MAX = 5, NAME_BOOK_MS = 60000;
// One word alone that is never a name, whatever a container, a setup or an agent is called ("default" is the brain's
// setup when config.json names none).
const NOT_NAMES = new Set(['default', 'main', 'test', 'tests', 'model', 'models', 'app', 'apps', 'web', 'server', 'chat', 'owner', 'agent', 'agents',
  'sparkie', 'spark', 'sparks', 'setup', 'setups', 'container', 'box', 'job', 'jobs', 'home', 'work', 'local', 'none', 'new', 'all']);
// Words, lower case, with web addresses taken out (whatever has :// in it, starts www., or is a host and a path:
// "huggingface.co/zai-org/…"), and Sparks said by number made one word each ("Sparks 3 and 4" is spark3 spark4;
// "akspark2" stays one word, Spark 2's only by its alias).
const ADDRESS = /:\/\/|^\W*www\.|^[^/]*\.[a-z]{2,}\//;
const nameWords = text => String(text || '').toLowerCase().split(/\s+/).filter(w => !ADDRESS.test(w)).join(' ')
  .replace(/\bsparks?[\s_-]*(\d+)((?:\s*(?:,|and|&|\+|or)\s*\d+)*)/g, (m, a, rest) => ` ${[a, ...(rest.match(/\d+/g) || [])].map(d => `spark${d}`).join(' ')} `)
  .split(/[^a-z0-9]+/).filter(Boolean);

// The book: each way a known thing is written, as its words run together ("glm 5.3 flash", "GLM-5.3-Flash-FP8" and
// "glm-5.3-flash" are one form), to the names it stands for; and every start of a form, so a look-up stops at the first
// word that can't go on to one.
let nameBook = null, nameBookDue = false;
function buildNameBook() {
  const forms = new Map(), starts = new Set();
  // (one name of each kind for a form: the first source wins, so the brain's own model keeps its recipe's name)
  const add = (kind, name, ...said) => {
    const id = String(name || '').trim().toLowerCase();
    if (!id) return;
    for (const s of [id, ...said]) {
      const key = nameWords(s).join(''), at = forms.get(key) || [];
      if (key.length < 3 || NOT_NAMES.has(key) || /^\d+$/.test(key) || at.some(x => x.kind === kind)) continue;
      forms.set(key, [...at, { kind, name: id }]);
      for (let i = 1; i <= key.length; i++) starts.add(key.slice(0, i));
    }
  };
  const each = (what, fill) => { try { fill(); } catch (e) { console.error(`Memory’s names: ${what} couldn’t be read (${e.message}).`); } };
  each('the Sparks', () => { for (const n of NODES) add('spark', n.id, n.name, n.alias); });
  const recipeOf = new Map(), modelName = raw => { const k = modelKey(repoOf(raw)); return recipeOf.get(k) || k; };
  each('the recipes', () => {
    for (const r of recipeCatalog().models) {
      const repos = (r.variants || []).map(v => String(v.repo || '')).filter(Boolean);
      for (const k of [r.id, ...repos.map(modelKey)]) if (!recipeOf.has(String(k).toLowerCase())) recipeOf.set(String(k).toLowerCase(), r.id);
      add('model', r.id, r.title, ...repos.map(modelKey), ...repos.map(x => x.split('/').pop()));
      for (const s of r.setups || []) add('setup', s.id);
    }
  });
  each('the brain’s setups', () => { for (const [id, p] of Object.entries(mainPresets())) { add('setup', id, p.title); if (p.model) add('model', modelName(p.model), p.model, p.served); } });
  each('the containers', () => {
    for (const w of Object.values(knowledge.workloads)) {
      add(w.labels?.['spark.app'] ? 'app' : 'container', w.name);
      for (const m of [...(w.servedModels || []), w.labels?.['spark.model']].filter(Boolean)) add('model', modelName(m), m);
    }
  });
  each('the agents', () => { for (const k of agentKeys()) add('agent', k.name); });
  each('the people', () => { const a = accessList(); add('person', a.userName); for (const m of a.members) add('person', m.login, m.name); });
  return { forms, starts, at: Date.now() };
}
function memoryNameBook() {
  if (!nameBook) nameBook = buildNameBook();
  else if (!nameBookDue && Date.now() - nameBook.at > NAME_BOOK_MS) {
    nameBookDue = true;
    setTimeout(() => { nameBookDue = false; nameBook = buildNameBook(); }, 0);
  }
  return nameBook;
}
// The names in a text, in the order they first come, five at most. A name inside a longer one of its own kind is that
// one ("aphex" in "aphex-x4", a recipe inside a longer recipe's name); a model's name in a container's is both.
function memoryNamesIn(text) {
  const { forms, starts } = memoryNameBook(), w = nameWords(text), found = [];
  for (let i = 0; i < w.length; i++) {
    for (let j = i, s = ''; j < w.length; j++) {
      s += w[j];
      if (!starts.has(s)) break;
      for (const x of forms.get(s) || []) found.push({ ...x, i, j });
    }
  }
  const kept = found.filter(m => !found.some(n => n.kind === m.kind && n.i <= m.i && n.j >= m.j && n.j - n.i > m.j - m.i));
  return [...new Set(kept.map(m => m.name))].slice(0, ABOUT_MAX);
}

// The index: the live lines, each with its names, and each name's lines in the file's order. `sig` is memory.json as the
// index last saw it (its inode, size and times), so a look needs no read while the file is unchanged.
let memIndex = null;
function memorySig() {
  try { const s = statSync(MEMORY_FILE, { bigint: true }); return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; } catch (e) { return e.code === 'ENOENT' ? 'none' : null; }
}
// Lines with their names: their own, saved with them; else those found for that line before (the same words); else found
// now (a line saved before names were kept).
function memoryNamed(lines) {
  const was = new Map((memIndex?.lines || []).map(e => [e.id, e]));
  return lines.map(e => (Array.isArray(e.about) ? e : { ...e, about: (was.get(e.id)?.text === e.text && was.get(e.id).about) || memoryNamesIn(e.text) }));
}
function memoryIndexOf(entries, sig) {
  const lines = memoryNamed(entries), byName = new Map();
  for (const e of lines) for (const n of new Set(e.about)) if (typeof n === 'string') { const at = byName.get(n); if (at) at.push(e); else byName.set(n, [e]); }
  memIndex = { sig, lines, byName };
  return memIndex;
}
// The index as memory.json is now: read again only when the file changed (a read error throws, as memoryEntries does).
function memoryIndexNow() {
  const sig = memorySig();
  if (memIndex && sig && sig === memIndex.sig) return memIndex;
  const entries = memoryEntries(), after = memorySig();
  return memoryIndexOf(entries, after === sig ? after : null);
}
// The live lines about one name ("spark4", "glm-5.3-flash"), oldest first.
const memoryLinesAbout = name => memoryIndexNow().byName.get(String(name).trim().toLowerCase()) || [];
// A line as Sparkie and agents are shown it: as before names were kept (the owner's own call sees `about`).
const withoutAbout = ({ about, ...line }) => line;
// At start, once every part has run: the book, then the index (the first read of memory after start).
setTimeout(() => {
  try { memoryNameBook(); memoryIndexNow(); } catch (e) { console.error(`Memory’s index wasn’t made at start (${e.message}); it is made when memory is next read.`); }
}, 0);
