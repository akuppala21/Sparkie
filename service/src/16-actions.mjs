/* ───────── actions: what the console can do, as one list for people, Sparkie and agents ───────── */
// Area: core
// Rules: R7, R9, R11, R12, R18, R21, R23, R25, R32, R35, R36, R37, R38, R46
// Tests: change.test.mjs, door.test.mjs, api.test.mjs, abilities.test.mjs, intent.test.mjs
// Owns: none
// Timers: none        Wakes: none
// Every workflow is a named action with typed inputs, so a model can pick up whichever it needs the same way each
// time, without opening the page. The agent door (MCP, below) offers them to your own agents; Sparkie's tools and the
// page's buttons move onto the same list, with the same checks. Each action says:
//   kind   'read' runs straight away. 'change' (next) runs after the checks: dry-run plan, rails, re-check, verify,
//          put back on failure. 'confirm' (deleting data, credentials) waits for the owner. Lock-out risks are never actions.
//   scope  which agent keys may use it: 'fleet:read' today; 'fleet:act', 'commands', 'memory:…' later.
//   who    'owner' or 'member'; since E10d only the owner signs in, so both mean the owner.
// Every result says when it was observed (observedAt). Text that comes from programs, containers or web pages is marked
// as data. Descriptions start with when to use the action, since models pick tools by them.
const ACTIONS = new Map();
function action(a) { ACTIONS.set(a.name, a); }
const gbOfGiB = gib => (Number.isFinite(gib) ? Math.round((gib * 2 ** 30) / 1e8) / 10 : null);

// Sparks are named the way people say them: spark3, "Spark 3" or 3 all mean spark3.
function sparkIdOf(v) {
  const key = x => String(x).toLowerCase().replace(/[\s_-]+/g, '');
  const k = key(v);
  return NODES.find(n => key(n.id) === k || key(sparkName(n)) === k || (/^\d+$/.test(k) && key(n.id) === `spark${k}`))?.id || null;
}
const sparkList = () => NODES.map(n => `${n.id}${statusCache && statusCache.value.nodes.find(x => x.id === n.id)?.state !== 'online' ? ' (offline)' : ''}`).join(', ');
function sparkOf(viewer, id) {
  const real = sparkIdOf(id);
  if (!real) throw new HttpError(404, `No Spark called ${String(id).slice(0, 40)}. Spark ids: ${sparkList()}.`);
  return sparkFor(viewer, real);
}
const sparkArg = { type: 'string', spark: true, maxLength: 40, description: 'A Spark id, like spark3 ("Spark 3" works too).' };
const sparksArg = { type: 'array', items: sparkArg, minItems: 2, maxItems: 2, description: 'Two linked Sparks, like ["spark3","spark4"] (or "spark3+spark4"); the first answers requests.' };
const modelArg = { type: 'string', maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9._/:-]{0,199}$', description: 'The model: a library name (gpt-oss-120b), a Hugging Face repo (openai/gpt-oss-120b) or a recipe id.' };

// Checks an action's inputs against its schema (the small part of JSON Schema the actions use), and tidies them:
// Spark names become ids, "a+b" becomes a list.
function checkValue(k, p, v) {
  if (p.spark) {
    // (run's and write_file's on may also be "box", 21-box.mjs)
    if (p.box && v === 'box') return v;
    if (typeof v !== 'string') throw new HttpError(400, `${k} should be text: one Spark id, like spark3. Spark ids: ${sparkList()}.`);
    const id = sparkIdOf(v);
    if (!id) throw new HttpError(400, `${k}: no Spark called ${v.slice(0, 40)}. Spark ids: ${sparkList()}.`);
    return id;
  }
  if (p.type === 'array') {
    // "spark3+spark4", "Spark 3, Spark 4" or "3 4": split on + or commas when there are any, else on spaces.
    const list = typeof v === 'string' ? (/[+,]/.test(v) ? v.split(/[+,]/) : v.split(/\s+/)).map(x => x.trim()).filter(Boolean) : v;
    const min = p.minItems ?? 0, max = p.maxItems ?? 50;
    if (!Array.isArray(list) || list.length < min || list.length > max) throw new HttpError(400, `${k} should be a list of ${min === max ? min : `${min} to ${max}`} items.`);
    const out = list.map((x, i) => checkValue(`${k}[${i}]`, p.items, x));
    if (p.items?.spark && new Set(out).size !== out.length) throw new HttpError(400, `${k} needs different Sparks.`);
    return out;
  }
  const range = p.minimum !== undefined ? ` from ${p.minimum} to ${p.maximum}` : '';
  if (p.type === 'string') {
    if (typeof v !== 'string' || v.length > (p.maxLength || 200)) throw new HttpError(400, `${k} should be text${p.maxLength ? ` of at most ${p.maxLength} characters` : ''}.`);
    if (p.pattern && !new RegExp(p.pattern).test(v)) throw new HttpError(400, `${k} isn’t in the right form. ${p.description || ''}`.trim());
  }
  if (p.type === 'integer' && (!Number.isInteger(v) || (p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum))) throw new HttpError(400, `${k} should be a whole number${range}.`);
  if (p.type === 'boolean' && typeof v !== 'boolean') throw new HttpError(400, `${k} should be true or false.`);
  if (p.enum && !p.enum.includes(v)) throw new HttpError(400, `${k} should be one of: ${p.enum.join(', ')}.`);
  return v;
}
function checkInput(schema, args, name = null) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new HttpError(400, 'Arguments must be an object.');
  const props = schema.properties || {}, out = {};
  for (const k of Object.keys(args)) {
    if (!Object.hasOwn(props, k)) throw new HttpError(400, `Unknown argument: ${String(k).slice(0, 40)}. ${name || 'It'} takes ${Object.keys(props).join(', ') || 'no arguments'}.`);
  }
  for (const k of schema.required || []) if (args[k] === undefined) throw new HttpError(400, `Missing argument: ${k}.`);
  for (const [k, p] of Object.entries(props)) if (args[k] !== undefined) out[k] = checkValue(k, p, args[k]);
  return out;
}
// The schema agents are shown: Spark arguments list the real Spark ids.
function liveSchema(schema) {
  const fix = p => {
    if (p.spark) { const { spark, box, ...rest } = p; return { ...rest, enum: [...NODES.map(n => n.id), ...(box ? ['box'] : [])] }; }
    return p.type === 'array' && p.items ? { ...p, items: fix(p.items) } : p;
  };
  return { ...schema, properties: Object.fromEntries(Object.entries(schema.properties || {}).map(([k, p]) => [k, fix(p)])) };
}
// For Sparkie: a change has to be asked for, in a sentence that isn't a question ("what's running?" never starts
// anything), and be about what the owner named: every word of the model, a word of the container, and only Sparks they
// named. "Don't stop …" rules that kind of change out for the message. Text Sparkie read in a log or a web page can't
// point it anywhere else.
const normQuotes = t => String(t || '').replace(/[‘’ʼ`´]/g, "'");
const GENERIC = new Set(['sc', 'the', 'a', 'an', 'model', 'models', 'on', 'it', 'and', 'to', 'of']);
// "spark 3", "Spark3", "sparks 3 and 4", "spark 3 and 4" all name Sparks by id; so does a bare number after "on",
// "across", "from", "to" ("start gemma on 3", "across 3 and 4", "3+4") when it's a real Spark and isn't a count ("on 2
// GPUs", "to 4 bits"). (2026-11-11: "start gemma on 3" ran wherever there was room.)
const BARE_SPARKS = /\b(on|across|onto|over|between|from|to)\s+(\d)((?:\s*(?:,|and|&|\+|or)\s*\d)*)\b(?!\s*(?:sparks?|gpus?|nodes?|machines?|boxes|x\b|mins?|minutes?|hours?|days?|secs?|seconds?|%|gb\b|tb\b|k\b|bits?|b\b|parts?|times?|of\b|\.\d))/g;
const sparkNames = text => String(text).toLowerCase().replace(/sparks?[\s_-]*(\d+)((?:\s*(?:,|and|&|\+|or)\s*\d+)*)/g,
  (m, first, rest) => ` ${[first, ...(rest.match(/\d+/g) || [])].map(d => `spark${d}`).join(' ')} `)
  .replace(BARE_SPARKS, (m, prep, first, rest) => {
    const ids = [first, ...(rest.match(/\d/g) || [])];
    return ids.every(d => NODES.some(n => n.id === `spark${d}`)) ? ` ${prep} ${ids.map(d => `spark${d}`).join(' ')} ` : m;
  });
const tokensOf = text => new Set(sparkNames(normQuotes(text)).split(/[^a-z0-9.]+/).flatMap(t => [t, t.replace(/\./g, '')]).filter(t => t.length >= 2 && !GENERIC.has(t)));
// "Can you start gemma?" is a request; "can gemma run on Spark 3?", "should I stop it?" and "if it crashes, restart it"
// aren't.
const POLITE = /^\s*(?:(?:hey|hi|ok|okay)[\s,]+(?:\w+[\s,]+)?)?(?:please\s+)?(?:can|could|would|will)\s+(?:you|u|ya)\s+(?:please\s+)?(?:go\s+(?:and\s+)?)?/i;
// "Do not …" and "didn't …" are statements, not questions.
const QUESTION_START = /^\s*(why|what|what's|whats|how|is|are|which|when|where|did(?!\s+not\b)|does(?!\s+not\b)|do(?!\s+not\b)|has|have|was|were|who|whose|can|could|would|will|should|shall|may|might|if|whether|unless|in case)\b/i;
// Turning a Spark itself off or on: the phrase names the Spark(s) it switches, and powerSparksSaid reads them from it.
// (a Spark followed by 's is whose, not what is switched: "turn off Spark 3's model" names no Spark to power off)
const SPARKS_NAMED = String.raw`(?:the\s+|both\s+|all\s+)?(?:(?:idle|other)\s+)?sparks?(?:\s*(?:\d+\b(?![’']s\b)|and\b|or\b|&|\+|,))*`;
const POWER_OFF_WORDS = new RegExp(String.raw`\b(?:shut|turn|power|switch)\s+(?:down|off)\s+${SPARKS_NAMED}|\b(?:shut|turn|power|switch)\s+(?:the\s+|both\s+)?sparks?(?:\s*(?:\d+\b(?![’']s\b)|and\b|or\b|&|\+|,))*\s+(?:down|off)\b`, 'gi');
const POWER_ON_WORDS = new RegExp(String.raw`\b(?:turn|power|switch|boot)\s+(?:on|up)\s+${SPARKS_NAMED}|\b(?:turn|power|switch|boot)\s+(?:the\s+|both\s+)?sparks?(?:\s*(?:\d+\b(?![’']s\b)|and\b|or\b|&|\+|,))*\s+(?:on|up)\b|\bwake\s+(?:up\s+)?${SPARKS_NAMED}`, 'gi');
// What asks for a change (base forms: "start gemma", "bring it up") …
// A file's name, by its ending: one list for the gate's file words and the reading group's (R46).
const FILE_ENDINGS = 'md|txt|json|csv|tsv|ya?ml|toml|ini|log|py|sh|js|html|css';
// (The rows stay in this order: each sentence is matched against them first to last, and the kinds come back so.)
const CHANGE_WORDS = [
  ['start', /\b(start|launch|relaunch|deploy|redeploy|serve|run|rerun|load|spin(?:\s+\w+)?\s+up|fire(?:\s+\w+)?\s+up|boot(?:\s+\w+)?\s+up|get(?:\s+[\w.:/-]+){1,4}\s+(?:going|running|up)|put(?:\s+[\w.:/-]+){1,4}\s+on|bring(?:\s+(?!back\b)[\w.:/-]+){0,4}\s+up\b(?!\s+again)|switch(?:\s+[\w.:/-]+){0,4}\s+(?:to|over\s+to)|swap|replace|set(?:\s+[\w.:/-]+){0,3}\s+up|install)\b/gi],
  // "use qwen coder on spark 3" as an instruction (at the start, or after "please" / "let's" / "I want to").
  ['start', /(?:^\s*|\b(?:please|let's|lets|i\s+want\s+to|i'd\s+like\s+to|go\s+ahead\s+and)\s+)(use)\b/gi],
  ['stop', /\b(stop|kill|shut(?:\s+\w+)?\s+(?:down|off)|unload|take(?:\s+\w+)?\s+down|turn(?:\s+\w+)?\s+off|free(?:\s+\w+)?\s+up|clear(?:\s+out)?)\b/gi],
  ['restart', /\b(restart|reboot|bring(?:\s+\w+){0,2}\s+back(?:\s+up)?|bring(?:\s+\w+){0,2}\s+up\s+again)\b/gi],
  // An app kept running (keep_running): "keep Open WebUI on Spark 3 running".
  ['keep', /\bkeep\b[^.?!;\n]{0,80}?\b(running|up|alive|going)\b/gi],
  ['cancel', /\b(cancel|abort)\b/gi],
  ['undo', /\b(undo|revert|roll\s*back|put\s+(?:it|that|things|everything)\s+back)\b/gi],
  // Research changes nothing on the Sparks: "find setups for X" counts even said as a question.
  ['find', /\b(find|look\s+up|research|dig\s+up|search\s+for|refresh)\b[^.?!;\n]{0,60}?\b(setups?|recipes?|configs?|configurations?|benchmarks?|speeds?)\b/gi],
  ['save', /\b(save|make|turn|create|add|remember)\b[^.?!;\n]{0,80}?\bworkflows?\b/gi],
  // Comparing models on a saved workload (21-compare.mjs): "compare X against Y", "whatever is best", "keep the winner".
  ['compare', /\b(compare\w*|whatever\s+is\s+best|keep\s+the\s+(?:winner|best(?:\s+one)?)|(?:try|run)\b[^.?!;\n]{0,60}?\b(?:against|versus|vs\.?))(?=\W|$)/gi],
  ['forget', /\b(forget|delete|remove|drop)\b[^.?!;\n]{0,60}?\bworkflows?\b/gi],
  ['test', /\b(test|validate|check)\s+(?:the\s+|my\s+)?(?:changes|update|workflows|build)\b/gi],
  // Installing Spark Console's newest tested build (21-updates.mjs): "install the new build", "update spark console".
  // A change to Spark Console's own code (21-selfchange.mjs): "change your code", "fix yourself", "add X to Spark Console".
  ['code', /\b(?:change|edit|fix|improve|patch|modify|rewrite)\s+(?:your|sparkie'?s|spark\s*console'?s)\s+(?:own\s+)?(?:code|source(?:\s+code)?)\b|\bfix\s+yourself\b|\badd\b[^.?!;\n]{0,80}?\bto\s+spark\s*console(?:'s\s+code)?\b|\b(?:propose|send)\s+(?:a\s+|the\s+|that\s+|your\s+)?(?:code\s+)?(?:change|pull\s+request)\b/gi],
  ['install', /\b(?:install|upgrade\s+to|update\s+to)\b[^.?!;\n]{0,40}?\b(?:builds?|updates?|versions?|spark\s*console)\b|\b(?:update|upgrade)\s+(?:the\s+)?(?:spark\s*)?console\b/gi],
  // The self-test (21-selftest.mjs): "run the self-test", "test the Sparks", "test Spark 3", "test the fleet".
  ['selftest', /\b(self[\s-]?tests?|test\s+(?:the\s+|my\s+|all\s+(?:the\s+|my\s+)?|every\s+)?(?:sparks?|fleet|hardware))\b/gi],
  // A file in a Spark's shared folder (save_file): "save this as notes.md", "write it to a file on spark 3".
  ['file', new RegExp(String.raw`\b(save|write)\b[^.?!;\n]{0,120}?\b(?:files?|[\w-]+\.(?:${FILE_ENDINGS}))\b`, 'gi')],
  // Powering a Spark itself off or on (21-power.mjs): only with a Spark as what is switched, by name ("shut down Spark
  // 4", "turn Sparks 3 and 4 off", "turn on Spark 3", "boot Spark 3 up"). "Stop gemma on Spark 4 and shut it down" is a
  // stop, never a power-off: "it" or "them" could be the model.
  ['poweroff', POWER_OFF_WORDS],
  ['poweron', POWER_ON_WORDS],
  // The idle power-off's time: "set the idle shutdown to 45 minutes", "change auto power off to an hour".
  ['powerset', /\b(?:set|change|make|switch|lower|raise)\b[^.?!;\n]{0,60}?\b(?:idle|auto(?:matic)?(?:ally)?|shut\s*down|shutdown|power[\s-]*off)\b/gi],
  // Sparkie's memory (20-memory.mjs): "remember…", "from now on…", "keep in mind…", "no, I meant…", "forget that…".
  ['remember', /\b(remember|from\s+now\s+on|going\s+forward|next\s+time|keep\s+in\s+mind|make\s+a\s+note|note\s+that|don't\s+forget|no,?\s+i\s+meant|forget\s+(?:that|this|what\s+i\s+said|the\s+note))\b/gi],
  // Work on a Spark itself, a command run as a change (run, 21-ladder.mjs hostClear; design A 2.5).
  ['work', /\b(fix|install|set\s+up|change|edit|build|clean\s*up|update|try)\b/gi],
];
// … and, after a "not", the other forms rule it out too ("without stopping anything", "not restarting it").
const CHANGE_FORMS = [
  ['start', /\b(start(?:s|ed|ing)|launch(?:es|ed|ing)|deploy(?:s|ed|ing)|running|ran|loading|loaded)\b/gi],
  ['stop', /\b(stop(?:s|ped|ping)|kill(?:s|ed|ing)|shut(?:s|ting)?(?:\s+\w+)?\s+(?:down|off)|unload(?:s|ed|ing)|tak(?:es|ing)(?:\s+\w+)?\s+down|turn(?:s|ed|ing)(?:\s+\w+)?\s+off)\b/gi],
  ['restart', /\b(restart(?:s|ed|ing)|reboot(?:s|ed|ing))\b/gi],
  ['cancel', /\b(cancel(?:s|led|ed|ling|ing)|abort(?:s|ed|ing))\b/gi],
  ['undo', /\b(undo(?:es|ing|ne)|revert(?:s|ed|ing))\b/gi],
];
// The brain's tool groups (R46): each action outside the core has one (its `group`). A round offers the core and the
// groups this request opened (21-guide.mjs); these words in the owner's request open them, in the order they come.
// [group, what it holds (guide's description lists it), its words]
// (The rows stay in this order: guide's description, its list of groups and the brain's catalog name them so.)
const GROUP_WORDS = [
  ['find', 'which model to run: recipes, Hugging Face, models on disk, where one fits, its setups', /\b(?:which|what|best|good|recommend\w*|suggest\w*|new(?:est|er)?|latest|biggest|smallest|fastest|list)\b[^.?!\n]{0,40}\bmodels?\b|\b(?:fits?|recipes?|hugging\s*face|on\s+disk|downloaded|setups?|configs?|where\s+(?:can|could|should|would)\s+(?:i|we|it|you)\s+(?:run|put|start))\b/i],
  ['sparks', 'one Spark in detail, cables and linked Sparks, plans for one Spark or two', /\b(?:cables?|linked|links?\s+between|disk\s+(?:space|usage|is\s+full)|storage|plans?|room\s+(?:for|on)|across|spark\s*\d\s*(?:\+|and)\s*(?:spark\s*)?\d)\b/i],
  ['dig', 'why something failed: operations and their logs, container and service logs, diagnostics', /\b(?:why|fail\w*|crash\w*|errors?|broke\w*|logs?|died|dead|stuck|hung|went\s+wrong|not\s+(?:working|answering|starting)|debug\w*|diagnos\w*|(?:went|gone|is)\s+dark|offline|unreachable)\b/i],
  ['past', 'what happened: the fleet’s events, and the journal of what was said, called and run here', /\b(?:what\s+happened|happen(?:ed|s)\s+(?:to|on|with|last)|what\s+changed|while\s+i\s+was\s+(?:away|out|gone|asleep)|history|events?|yesterday|last\s+(?:night|week|time)|earlier\s+today|(?:have|did)\s+(?:we|you)\s+(?:ever\s+)?(?:try|tried|run|done)|before\s+the\s+restart|recall)\b/i],
  ['reading', 'web pages and files: read a page, list or read the shared folder’s files, save a file, write a file on a Spark', new RegExp(String.raw`https?:\/\/|\bwww\.|\b(?:look\s+(?:it|that|this|them)\s+up|search\s+(?:the\s+web|online)|google|web\s*pages?|pages?|articles?|docs|documentation|release\s+notes|files?|folders?|[\w-]+\.(?:${FILE_ENDINGS}|org|com|io|ai|dev|net))\b`, 'i')],
  ['routines', 'saved workflows: list, save, run and forget them, compare models on one', /\b(?:workflows?|routines?|pipelines?|workloads?|compar\w*|whatever\s+is\s+best|keep\s+the\s+winner)\b/i],
  // (both undos are here, so a request is offered both or neither: one alone could be the wrong one, R46)
  ['control', 'operations under way: follow one, cancel it; undo the last change, or Spark Console’s last update; the list of what should be running', /\b(?:should\s+be\s+running|cancel\w*|abort\w*|undo|revert\w*|roll\s*back|put\s+(?:it|that|things|everything)\s+back|go\s+back\s+a\s+build|previous\s+(?:version|build)|wait\s+for|operations?|progress|(?:stop|kill|halt)\b[^.?!\n]{0,30}\b(?:download\w*|start|copy))\b/i],
  ['memory', 'what Sparkie remembers: show it, forget a line', /\b(?:(?:your|sparkie'?s)\s+memor(?:y|ies)|remember(?:ed|s)?\s+about|do\s+you\s+(?:still\s+)?remember|forget\w*|what\s+do\s+you\s+(?:know|remember))\b/i],
  ['checks', 'tests: the self-test of the Sparks, testing the changes', /\b(?:self[\s-]?tests?|tests?|testing|validat\w*)\b/i],
  // (power: a Spark itself switched by name, never a model: "turn off Spark 3’s model" opens it but power_off refuses it)
  ['power', 'turning a Spark off or on, and the idle power-off', /\b(?:power(?:ed|ing|s)?[\s-]*(?:on|off|up|down)|power(?:ed|ing|s)?\s+(?:it|them|(?:the\s+)?sparks?\b[\s\d,+&]*(?:and\s+\d\s*)?)\s*(?:on|off|up|down)|wake|wakes|waking|woke|sleep\w*|asleep|plugs?|watts?|idle|shutdown|shut\s*down\s+(?:the\s+)?sparks?|shut(?:s|ting)?\s+(?:the\s+)?sparks?\b[^.?!\n]{0,20}?\bdown|turn(?:s|ed|ing)?\s+(?:on|off)\s+(?:the\s+)?sparks?|turn(?:s|ed|ing)?\s+(?:the\s+|all\s+)?sparks?\b[^.?!\n]{0,20}?\b(?:on|off)|boot(?:s|ed|ing)?\s+(?:up\s+)?(?:the\s+)?sparks?)\b/i],
  // (Spark Console's own updates: undo_update stays in control, beside the other undo)
  ['updates', 'Spark Console’s own updates: is a newer tested build out, what it changes, and installing it; a change to its own code', /\b(?:your|sparkie'?s|spark\s*console'?s)\s+(?:own\s+)?(?:code|source(?:\s+code)?)\b|\bfix\s+yourself\b|\b(?:your|the|sparkie'?s)\s+(?:code\s+)?(?:proposal|pull\s+request)\b|\binstall\b[^.?!;\n]{0,40}?\b(?:builds?|updates?|versions?)\b|\bupdate\s+(?:spark\s*console|sparkie|yourself|the\s+console)\b|\b(?:newer|newest|latest)\s+(?:tested\s+)?builds?\b|\btested\s+builds?\b|\b(?:check\s+for|any)\s+(?:new\s+)?updates?\b|\bupdates?\s+(?:for|to|of)\s+(?:spark\s*console|sparkie|you(?:rself)?|the\s+console)\b|\bspark\s*console\s+updates?\b|\bupgrade\s+(?:spark\s*console|sparkie|yourself|the\s+console)\b/i],
];
const NEGATOR = /\b(don't|dont|do not|didn't|did not|doesn't|never|no need to|without|not|avoid|stop yourself from)\b[\s,]+(?:[\w']+[\s,]+){0,4}$/i;
// After "could you", these ask for information ("could you tell me whether to stop it"), not for a change.
const INFO_START = /^\s*(tell|show|explain|describe|check|see|find(?:\s+out)?|look|let\s+me\s+know|say|think|advise|guess|figure|remind|help\s+me\s+(?:understand|decide|figure))\b/i;
// "whether to stop", "if I should restart", "can it run": a change word that's being asked about, not asked for.
const HYPOTHETICAL = /\b(whether|if|should|would|could|can|might|may)\b[^,]*$/i;
// "Keep gemma running", "leave Spark 3 alone": nothing stops.
const KEEP = /\b(keep|leave)\b[^.;!?\n]{0,60}?\b(running|alone|up|on|going|as\s+(?:it\s+)?is)\b/i;
// "Stop gemma, actually don't": the change in that sentence is called off.
const CALLED_OFF = /(?:^|[\s,;–—-])(?:actually\s+)?(?:don't|do\s+not|no\s+wait|never\s*mind|nevermind|scratch\s+that|not\s+yet|hold\s+(?:on|off))[\s.!]*$/i;
// The owner's own sentences of a message (C-1): what they pasted or quoted is not their asking. Taken out, each as a line
// break (in a line, a space): a fenced code block (``` or ~~~), an indented line (4 spaces or a tab), a quoted line
// ("> …"), text in quotes or backticks of more than three words (a short name or path stays: rename "old.txt" to
// "new.txt"), a line that reads as a log, a diff or a program's output (OWN_PASTED: a time or level word first, a stack
// frame, a prompt, JSON, a diff's header) and the plain lines between two of those, and the lines after one ending in
// ":" up to a blank line (a pasted log, as taskBudget and saidToKeep read it). Linear: no lookbehind, no nested repeat.
// For every reader of the owner's words as an ask (changeIntent; netAsks, 21-net.mjs, can call it first).
const OWN_QUOTE_WORDS = 3;
const OWN_PASTED = /^\s*(?:\[?\d{4}-\d\d-\d\d[T ]\d\d:\d\d|\[?\d\d:\d\d:\d\d|[A-Z][a-z]{2} +\d{1,2} \d\d:\d\d|\[?(?:ERROR|ERR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL|PANIC|NOTICE)\b|Traceback \(|File "[^"\n]*", line \d|at [\w.$<>]+ \(|[\w.]*(?:Error|Exception):|\$ \S|[{}]|\[[\s{"\d[]|\]\s*,?\s*$|@@ |diff --git |\+\+\+ |--- a\/|index [0-9a-f]{6,}\.\.)/;
function ownSentences(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/(?:```|~~~)[\s\S]*?(?:```|~~~|$)/g, '\n').split('\n');
  const pasted = lines.map(l => OWN_PASTED.test(l)), ahead = lines.map(() => false);
  // (ahead: a line that reads as output comes later in the same block, with no blank line between)
  for (let i = lines.length - 2; i >= 0; i--) ahead[i] = Boolean(lines[i + 1].trim()) && (pasted[i + 1] || ahead[i + 1]);
  let after = false, inLog = false, inDiff = false;
  const kept = lines.map((line, i) => {
    if (after) { if (!line.trim()) after = false; return ''; }
    if (/:\s*$/.test(line)) after = true;
    if (!line.trim()) { inLog = false; inDiff = false; return line; }
    if (pasted[i]) { inLog = true; inDiff ||= /^(?:@@ |diff --git |\+\+\+ |--- a\/)/.test(line); return ''; }
    // (a plain line between two that read as output is output too, and a diff's lines to its end)
    if ((inLog && ahead[i]) || (inDiff && /^[-+ ]/.test(line))) return '';
    return /^\s*>/.test(line) || /^(?: {4}|\t)/.test(line) ? '' : line;
  });
  return kept.join('\n').replace(/"([^"\n]*)"|“([^”\n]*)”|`([^`\n]*)`/g, (m, a, b, c) => ((a ?? b ?? c).trim().split(/\s+/).length > OWN_QUOTE_WORDS ? ' ' : m));
}
// A work word (fix, install, change, build, update …) asks for work only as an order (S-3), never as a noun: not after
// "the", "a", "any", "last", "my", "Spark 3's", "since" and the like ("summarize the build log", "the last update broke
// it", "any change since yesterday?"), nor with "is", "failed", "log" … after it ("build failed on Spark 3").
const WORK_NOT_AFTER = /\b(?:the|a|an|any|some|no|this|that|these|those|my|your|its|our|their|his|her|last|latest|recent|previous|next|new|old|same|each|every|another|whose|which|what|of|for|from|since|after|before|during|about|by|into|in|at|\w+'s)\s+$/i;
const WORK_NOUN = /^\s+(?:is|are|was|were|has|have|had|seems?|looks?|keeps?|broke|failed|did|didn't|does|doesn't|isn't|wasn't|log|logs|folder|script|scripts|output|step|time)\b/i;
const workOrder = (sentence, m) => !WORK_NOT_AFTER.test(sentence.slice(Math.max(0, m.index - 40), m.index))
  && !WORK_NOUN.test(sentence.slice(m.index + m[0].length, m.index + m[0].length + 30));
// A sentence that ends in a call-off ("stop gemma - no wait, leave it") calls off what it asks; one that is only a
// call-off ("Actually don't.", "Never mind.", "Wait.", "Cancel that.", "Not yet.") calls off every kind asked before
// it in the message (C-6). Read piece by piece from the end of the sentence's last 160 characters, so it stays short.
const OFF_WORD = String.raw`(?:no\s+wait|wait|actually\s*,?\s*no|don't(?:\s+do\s+(?:it|that|anything))?|do\s+not(?:\s+do\s+(?:it|that|anything))?|never\s*mind|nevermind|scratch\s+that|not\s+(?:yet|now)|hold\s+(?:on|off)|cancel\s+(?:that|it)|forget\s+(?:it|that|about\s+it)|leave\s+(?:it|that|them)(?:\s+(?:alone|be|as\s+(?:it|they)\s+(?:is|are)))?|keep\s+(?:it|that|them)\s+as\s+(?:it|they)\s+(?:is|are)|on\s+second\s+thoughts?)`;
const OFF_FILL = String.raw`(?:oh|ok|okay|no|nope|sorry|hmm+|um+|uh+|actually|please)`;
const OFF_PIECE = new RegExp(String.raw`(^|[\s,;:!–—-]+)(${OFF_WORD}|${OFF_FILL})[\s.!,;:–—-]*$`, 'i'), OFF_WORD_ALONE = new RegExp(`^${OFF_WORD}$`, 'i');
// 'only' for a sentence that is a call-off and nothing more, 'tail' for one that ends in one after a comma or a dash.
function calledOff(sentence) {
  let rest = sentence.slice(-160), word = false, sep = '';
  // ("stop it now - don't wait" asks for it at once)
  if (/\b(?:don't|do\s+not|no\s+need\s+to)\s+wait\b/i.test(rest)) return null;
  for (let m; rest && (m = OFF_PIECE.exec(rest));) { word ||= OFF_WORD_ALONE.test(m[2]); sep = m[1]; rest = rest.slice(0, m.index); }
  if (!word) return null;
  if (!rest.trim()) return sentence.length <= 160 ? 'only' : null;
  return /[,;:–—-]/.test(sep) ? 'tail' : null;
}
function changeIntent(text) {
  // (worded: ruled out in so many words, "don't stop" or "without stopping"; not only by "keep X running")
  const asked = new Set(), negated = new Set(), worded = new Set();
  for (const raw of normQuotes(ownSentences(text)).split(/(?<=[?!\n;])|\.(?=\s|$)/)) {
    const polite = POLITE.test(raw), sentence = raw.replace(POLITE, '').replace(/[?!;\n]+\s*$/, '');
    if (!sentence.trim()) continue;
    const callOff = calledOff(sentence);
    if (asked.size && callOff === 'only') { for (const k of asked) { negated.add(k); worded.add(k); } continue; }
    if (KEEP.test(sentence)) negated.add('stop');
    const question = (!polite && QUESTION_START.test(sentence)) || INFO_START.test(sentence), off = CALLED_OFF.test(sentence) || callOff === 'tail';
    const here = new Set();
    for (const [kind, re] of CHANGE_FORMS) for (const m of sentence.matchAll(re)) if (NEGATOR.test(sentence.slice(Math.max(0, m.index - 50), m.index))) { negated.add(kind); worded.add(kind); }
    for (const [kind, re] of CHANGE_WORDS) {
      for (const m of sentence.matchAll(re)) {
        const pre = sentence.slice(Math.max(0, m.index - 50), m.index);
        if (kind === 'work' && !NEGATOR.test(pre) && !workOrder(sentence, m)) continue;
        if (NEGATOR.test(pre) || off) { negated.add(kind); worded.add(kind); }
        else if ((!question || kind === 'find') && !HYPOTHETICAL.test(pre)) here.add(kind);
      }
    }
    for (const k of here) asked.add(k);
  }
  // Asked for and ruled out in the same message ("stop qwen but don't stop gemma"): a button, never straight away.
  const mixed = [...asked].filter(k => negated.has(k));
  for (const k of negated) asked.delete(k);
  return { asked: [...asked], negated: [...negated], mixed, keepOnly: negated.has('stop') && !worded.has('stop') };
}
// Never run from a channel (Telegram, R32): going back a build, Sparkie's memory and saved workflows outlive a stolen
// phone, so they wait as an owner-only button pressed in Spark Console with the passkey. Memory's one exception is the
// owner's own words in the paired chat (tgOwnMemory, 20-memory-tg.mjs; R25). The saved-workflow two aren't even offered
// to Sparkie there. Every later action that changes Sparkie's own code, skills, settings, secrets or connectors, or
// installs, joins this list.
// (One a line: PAGE_ONLY in this order, the one abilities says them in; PAGE_ONLY_TOOLS in name order.)
const PAGE_ONLY = new Set([
  'undo_update',
  'keep_eval_result',
  'keep_trial_result',
  'remember',
  'forget_memory',
  'save_workflow',
  'forget_workflow',
  'propose_update',
]);
const PAGE_ONLY_TOOLS = new Set([
  'forget_workflow',
  'save_workflow',
]);
const pageOnlyLabel = (name, input) => (name === 'save_workflow' ? `Save the workflow “${String(input.title || '').slice(0, 80)}”: ${input.from ? 'what your request before it changed in this chat' : stepWords(input.steps)}${findSaved(String(input.title || '')) ? ' (replaces the one saved now)' : ''}${input.from ? '' : savedImagesLabel(input.steps)}`
  : name === 'forget_workflow' ? `Forget the saved workflow “${String(input.name || '').slice(0, 80)}”` : changeLabel(name, input));
// The kinds of request (CHANGE_WORDS) each change answers to (sparkieCheck): one a line, in name order.
const ACTION_KIND = {
  cancel_operation: ['cancel'],
  compare_models: ['compare'],
  find_setups: ['find'],
  forget_memory: ['remember'],
  forget_workflow: ['forget'],
  install_update: ['install'],
  keep_running: ['keep', 'start', 'restart', 'stop'],
  power_off: ['poweroff'],
  power_on: ['poweron'],
  power_settings: ['poweroff', 'stop', 'powerset'],
  propose_update: ['code', 'cancel'],
  remember: ['remember'],
  restart_model: ['restart', 'start'],
  run: ['work'],
  run_workflow: ['start'],
  save_file: ['file'],
  save_workflow: ['save'],
  self_test: ['selftest'],
  start_model: ['start'],
  stop_model: ['stop'],
  test_changes: ['test'],
  undo_last_change: ['undo'],
  undo_update: ['undo'],
};
// A typed answer to Sparkie's one offered change: a message that's only "yes" (or "ok", "go ahead", …) presses its
// button; anything more ("ok no", "yes but on Spark 4") goes to Sparkie. "No" puts the buttons away.
const AFFIRM = /^\s*(?:y|yes|yeah|yep|yup|ok|okay|sure|go ahead|do it|please do|go for it|sounds good|that one|yes please|yes do it|ok do it|okay do it)\s*[.!]*\s*(?:please|thanks|thank you)?\s*[.!]*\s*$/i;
const REFUSE = /^\s*(no|nope|nah|don't|dont|do not|cancel|never ?mind|wait|leave it|keep it|not now)\b/i;
// Which of Spark Console's models on that Spark the words point to: the one with the most of its name's words, and no
// tie ("stop qwen coder" picks sc-qwen3-coder over sc-qwen-vl; plain "stop qwen" picks neither, so it's a button).
function pickContainer(name, spark, text) {
  const said = [...tokensOf(text)].filter(t => !/^spark\d+$/.test(t));
  const near = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  // Every container Spark Console started there (what the watcher last saw can lag a start or restart by a minute; a
  // stop of one that isn't running changes nothing): the best match, and on a tie the one running.
  const scored = Object.values(knowledge.workloads).filter(w => w.byConsole && w.spark === spark && w.state !== 'removed')
    .map(w => ({ name: w.name, running: Boolean(w.running), score: [...tokensOf(String(w.name).replace(/^sc-/, ''))].filter(t => !/^part\d$/.test(t) && said.some(x => near(x, t))).length }))
    .filter(x => x.score > 0).sort((x, y) => y.score - x.score || y.running - x.running);
  const [a, b] = scored;
  return a && (!b || a.score > b.score || (name === 'stop_model' && a.running && !b.running)) ? a.name : null;
}
// Whether a change is exactly what the words named: every word of the model, the one container they point to (or
// "everything on Spark N", said in this message), and only Sparks they named.
function tracesToRequest(name, input, saidText, request = saidText) {
  const said = tokensOf(saidText), flat = squash(sparkNames(normQuotes(saidText))), has = t => said.has(t) || flat.includes(t.replace(/\./g, ''));
  const namedSparks = [...said].filter(t => /^spark\d+$/.test(t));
  if (input.model && ![...tokensOf(input.model)].every(has)) return false;
  if (input.container) {
    const allOn = [...normQuotes(request).toLowerCase().matchAll(/\b(?:everything|all(?:\s+(?:of\s+)?(?:the\s+)?(?:models?|containers?))?)\s+(?:that's\s+|that\s+is\s+)?(?:running\s+)?on\s+spark[\s_-]*(\d+)\b|\b(?:free\s+up|clear(?:\s+out)?)\s+spark[\s_-]*(\d+)\b/g)].map(m => `spark${m[1] || m[2]}`);
    if (!allOn.includes(input.spark) && pickContainer(name, input.spark, saidText) !== input.container) return false;
  }
  for (const id of [input.spark, ...(input.sparks || [])].filter(Boolean)) {
    if (name === 'start_model' ? !said.has(id) : namedSparks.length && !namedSparks.includes(id)) return false;
  }
  return true;
}
// A change's plan (docs/contract.md 7.3): its workflow and version, and each input with where it came from: the words
// of the request ("said"), the live system ("live", a container or Spark that exists), or Spark Console's own choice
// when the request left it open ("chosen", like the Spark with room). Shown as "how this was checked" (7.9).
// The inputs a plan leaves out (PLAN_SKIP): one a line, in name order.
const PLAN_SKIP = new Set([
  '__validate',
  'allowBusy',
  'allowStop',
  'choice',
  'confirmOutside',
  'confirmRouted',
  'confirmStops',
]);
function planOf(wf, st, rawInput, ctx) {
  const input = rawInput.choice ? pendingChoices.get(rawInput.choice)?.args || {} : rawInput;
  const saidText = String(ctx.said || ctx.request || ''), said = tokensOf(saidText), flat = squash(sparkNames(normQuotes(saidText)));
  const fromWords = v => { const t = [...tokensOf(String(v))]; return t.length > 0 && t.some(x => said.has(x) || (x.length >= 5 && flat.includes(x.replace(/\./g, '')))); };
  const who = ctx.via === 'page' ? 'owner' : ctx.via === 'agent' ? 'agent' : ctx.via === 'gateway' ? 'call' : null;
  const inputs = Object.entries(input).filter(([k]) => !PLAN_SKIP.has(k)).map(([k, v]) => ({ name: k, value: Array.isArray(v) ? v.join(' + ') : String(v),
    source: who || (fromWords(Array.isArray(v) ? v.join(' ') : v) ? 'said' : 'live') }));
  if (wf.id === 'start_model' && !input.spark && !input.sparks) inputs.push({ name: 'spark', value: 'the Spark with room (never Spark 2)', source: 'chosen' });
  return { workflow: wf.id, title: wf.title, version: st.version, inputs,
    checks: [ctx.via === 'sparkie' ? 'the target is the one your words name' : 'the inputs passed the workflow’s checks',
      st.state === 'active' ? 'this workflow has been tried and works on your Sparks' : 'this is its first run on your Sparks',
      'it only stops what it’s allowed to, and leaves Spark 2 alone'] };
}
// The models a request could mean: every recipe, and every model on disk that isn't one of them, with the words that
// name each and its exact names (id, title, repo).
async function modelCandidates() {
  const inv = await recentInventory(), cat = recipeCatalog().models;
  const base = repo => String(repo || '').split('/').pop();
  const list = cat.map(r => ({ key: `recipe:${r.id}`, words: [r.id, r.title, r.family, ...r.variants.map(v => v.repo)].filter(Boolean).join(' '),
    names: [r.id, r.title, ...r.variants.map(v => base(v.repo))] }));
  for (const m of inv.library.filter(x => x.role !== 'draft')) {
    if (!cat.some(r => r.variants.some(v => onDiskAs(m, v.repo)))) list.push({ key: `disk:${m.name}`, words: [m.name, m.repo, m.manifest?.title].filter(Boolean).join(' '), names: [m.name, base(m.repo), m.manifest?.title] });
  }
  return { list, inv, cat };
}
// Whether Sparkie's start is of the model the owner's words name: of all the models they could mean, it has to be the
// one their words match best, and on its own (a tie, like two qwen recipes for "the qwen one", is a question). A model's
// exact name in the words ("gemma-3-12b-it") counts most, then each of its words. A Hugging Face repo that isn't a
// recipe has to be named in full.
async function namesModel(input, saidText) {
  const flat = squash(sparkNames(normQuotes(saidText))), plain = t => t.replace(/\./g, '');
  // The owner's words, once each (a dotted name counts once), without Spark names.
  const owner = [...new Set([...tokensOf(saidText)].map(plain))].filter(t => !/^spark\d+$/.test(t));
  const covers = (t, w) => t === w || (!/\d/.test(t) && !/\d/.test(w) && t.length >= 4 && w.length >= 4 && (t.startsWith(w) || w.startsWith(t)));
  const score = c => {
    const words = [...new Set([...tokensOf(c.words)].map(plain))];
    return owner.filter(w => words.some(t => covers(t, w))).length
      + (c.names.some(n => squash(String(n || '')).length >= 5 && flat.includes(squash(String(n)))) ? 10 : 0);
  };
  const { list, inv, cat } = await modelCandidates();
  let found;
  // A name nothing matches is refused by the start itself, with its reason; a name that could be several asks which.
  try { found = await resolveModelName(input.model, inv); } catch { return true; }
  if (found.choices) return true;
  const recipe = found.lib ? cat.find(r => r.variants.some(v => onDiskAs(found.lib, v.repo))) : found.recipe?.id ? found.recipe : null;
  if (!recipe && !found.lib) return [...tokensOf(String(found.repo).split('/').pop())].map(plain).every(t => owner.includes(t) || flat.includes(t));
  const key = recipe ? `recipe:${recipe.id}` : `disk:${found.lib.name}`;
  const scored = list.map(c => ({ key: c.key, n: score(c) })).filter(c => c.n > 0).sort((a, b) => b.n - a.n);
  const top = scored.filter(c => c.n === scored[0]?.n);
  return top.length === 1 && top[0].key === key;
}
// What Sparkie may do straight away (contract 7.2, 8.1): the message asks for this kind of change and doesn't rule it
// out, and the target is what the words name. Where a start runs: only Sparks the owner named; otherwise Spark Console
// picks one with room.
async function sparkieCheck(name, input, ctx) {
  const intent = ctx.intent || { asked: [], negated: [], mixed: [] }, kinds = ACTION_KIND[name] || [];
  const asked = kinds.some(k => intent.asked.includes(k)) && !kinds.some(k => intent.negated.includes(k) || intent.mixed.includes(k));
  const saidText = ctx.said || ctx.request || '', said = tokensOf(saidText), out = { ...input };
  if (name === 'start_model') {
    if (out.spark && !said.has(out.spark)) delete out.spark;
    if (out.sparks && !out.sparks.every(id => said.has(id))) delete out.sparks;
    return { clear: asked && await namesModel(out, saidText), input: out };
  }
  // Memory: the owner's own statement is enough (20-memory.mjs memoryClear).
  if (name === 'remember' || name === 'forget_memory') return { clear: memoryClear(name, out, ctx, asked), input: out };
  // A saved workflow runs at once only when every word of its name is in the owner's words, and never when they said
  // rehearse, dry run, preview, simulate or what if (that's `workflows {name}`); otherwise it's a button.
  // Its input values must be in the words too, nothing may be ruled out ("… but don't stop GLM"), and a longer saved name
  // the words also fit wins over a shorter one inside it. A name that isn't saved is an error, not a button.
  // A compare runs at once when the owner's words say compare and name the workflow and every candidate (or the one to
  // keep); else it's a button (21-compare.mjs).
  if (name === 'compare_models') {
    const w = findSaved(String(out.workflow || '')), words = t => [...tokensOf(String(t))].every(x => said.has(x));
    return { clear: asked && Boolean(w) && words(w.title) && [...(out.candidates || []), ...(out.keep ? [out.keep] : [])].every(words) && !ctx.noStops, input: out };
  }
  if (name === 'run_workflow') {
    const w = findSaved(String(out.name || ''));
    if (!w) throw new HttpError(404, `No saved workflow called “${String(out.name || '').slice(0, 80)}”. Saved: ${savedWorkflows().map(x => x.title).join(', ') || 'none yet'}.`);
    const missingInputs = Object.keys(w.inputs || {}).filter(k => !(k in (out.inputs || {})) && !(k === 'model' && w.best?.model));
    if (missingInputs.length) throw new HttpError(400, `“${w.title}” needs ${missingInputs.map(k => `${k} (${w.inputs[k]})`).join(', ')}.`);
    // (every word counts here, one-letter ones and bare Spark numbers too: "run coding mo" isn't "coding mode", and
    // a value "4" must be said as 4 or Spark 4)
    const plain = t => new Set(sparkNames(normQuotes(String(t))).split(/[^a-z0-9.]+/).flatMap(x => [x, x.replace(/\./g, '')]).filter(Boolean));
    const saidPlain = plain(saidText), fits = set => set.size > 0 && [...set].every(x => saidPlain.has(x));
    const title = plain(w.title);
    const practice = /\b(?:rehears\w*|dry[\s-]?runs?|test[\s-]?runs?|preview\w*|simulat\w*|what\s+if|practi[cs]\w*)\b/i.test(normQuotes(saidText));
    const valuesSaid = Object.values(out.inputs || {}).every(v => fits(plain(sparkIdOf(String(v)) || String(v))));
    const longer = savedWorkflows().some(x => x.id !== w.id && plain(x.title).size > title.size && fits(plain(x.title)));
    // "Don't stop anything", said here or earlier in the chat (ctx.noStops), makes it a button too.
    return { clear: asked && !practice && fits(title) && valuesSaid && !longer && !intent.negated.length && !intent.mixed.length && !ctx.noStops, input: out };
  }
  // A file is saved at once only when the owner's words name the Spark and the whole path, as one word (this message, or
  // the one before for "there"); anything else is a button that shows the name, the Spark and the size.
  // An app (keep_running): the words ask for what `do` does (keep or start, restart, stop), and name it (appNamed).
  if (name === 'keep_running') {
    const want = { keep: ['keep', 'start'], restart: ['restart'], stop: ['stop'] }[out.do || 'keep'];
    const wanted = want.some(k => intent.asked.includes(k)) && !want.some(k => intent.negated.includes(k) || intent.mixed.includes(k));
    return { clear: wanted && appNamed(out, saidText), input: out };
  }
  // The self-test: what it runs is fixed by code, so the owner's words asking for it are enough (R25). A Spark stays
  // only when the owner named it; otherwise the test picks a free one.
  if (name === 'self_test') {
    if (out.spark && !said.has(out.spark)) delete out.spark;
    return { clear: asked, input: out };
  }
  if (name === 'save_file') {
    // Whole names, not pieces of words: the path is one of the owner's words as written (quotes and a closing . , ! ?
    // aside) and ends like a file name (notes.md), so "a file" names nothing. The Spark is this message's; the message
    // before counts only when this one names none ("there").
    const wordsOf = t => new Set(normQuotes(t).toLowerCase().split(/[\s"'“”]+/).map(w => w.replace(/^\(+|[.,;:!?)]+$/g, '')).filter(Boolean));
    const now = [...tokensOf(ctx.request || '')].filter(t => /^spark\d+$/.test(t));
    const path = String(out.path || '').toLowerCase().replace(/\/$/, '');
    return { clear: asked && (now.length ? now.includes(out.spark) : said.has(out.spark)) && /\.[a-z0-9]+$/.test(path) && wordsOf(saidText).has(path), input: out };
  }
  // Powering Sparks off or on (21-power.mjs): every Spark it would switch is one the owner's words name (never one
  // Sparkie picked), and the words ask for that very switch ("turn on Spark 3" never powers anything off). The idle
  // time: the words are about the idle power-off and give that time, or say to turn it off for 0.
  if (name === 'power_off' || name === 'power_on') {
    // (the Sparks named in the very phrase that switches them: "shut down Spark 3 and stop gemma on Spark 4" powers off
    // Spark 3 only)
    const ids = [out.spark, ...(out.sparks || [])].filter(Boolean), inPhrase = powerSparksSaid(name === 'power_off' ? POWER_OFF_WORDS : POWER_ON_WORDS, saidText);
    return { clear: asked && ids.length > 0 && ids.every(id => inPhrase.has(id)), input: out };
  }
  if (name === 'power_settings') return { clear: asked && powerSettingsClear(out, saidText), input: out };
  // A proposal of Spark Console's own code: the owner's words ask for a change to its code (code); a drop also on a
  // cancel. Everything else about it is code's (21-selfchange.mjs).
  if (name === 'propose_update') {
    const want = out.do === 'drop' ? ['code', 'cancel'] : ['code'];
    // (a send in a request that read outside text is a button, as a saved workflow is)
    return { clear: want.some(k => intent.asked.includes(k)) && !want.some(k => intent.negated.includes(k) || intent.mixed.includes(k)) && !(out.do === 'send' && ctx.readOutside), input: out };
  }
  // A workflow's steps are Sparkie's own writing. They are saved at once only when this turn read nothing from outside,
  // the name is new, and the owner's words name every step's model, container and Sparks; otherwise it's a button whose
  // label lists the steps (pageOnlyLabel, F20).
  if (name === 'save_workflow') {
    // ("save that as …": the request's own steps, so the check and the button see them, D6e)
    const o = out.from !== undefined ? fromRequest(out, null, ctx) : out, { leftOut, ...plain } = o;
    const steps = Array.isArray(o.steps) ? o.steps : [];
    const clear = asked && !ctx.readOutside && !findSaved(String(out.title || '')) && steps.every(st => tracesToRequest(String(st?.action), stepArgs(st), saidText, ctx.request));
    return { clear, input: clear ? o : plain };
  }
  return { clear: asked && tracesToRequest(name, out, saidText, ctx.request), input: out };
}
// The Spark ids named inside the phrases a power word matched.
function powerSparksSaid(re, text) {
  const ids = new Set();
  for (const m of normQuotes(text).matchAll(new RegExp(re.source, 'gi'))) for (const t of tokensOf(m[0])) if (/^spark\d+$/.test(t)) ids.add(t);
  return ids;
}
// ctx says who's asking (via: 'sparkie' | 'agent' | …, actor: a name, request: their words, canChange).
// Agents (Sparkie, outside agents, auto-restart) pause themselves after many changes in an hour or three failed
// operations in a row; the owner looks at Activity and resumes them. The owner's own failed work (POST /actions, their
// own chat with Sparkie) never counts toward the three failures.
const AGENT_CHANGES_PER_HOUR = Number(process.env.SPARK_CONSOLE_AGENT_CHANGES_PER_HOUR || 12);
const agentChanges = [];
function tripBreaker(why) {
  agentFailuresInARow = [];
  if (agentSettings().halted) return;
  // Marked as automatic, so resuming it needs no passkey (nothing about the pause can lock the owner out).
  setAgentSettings({ halted: true, autoPaused: true });
  fleetEvent({ type: 'notice', text: `Agents’ changes were paused automatically: ${why}. Look at Activity, then resume them in your account menu → Agents and Telegram.` });
  audit({ via: 'console', actor: 'Safety pause', action: 'pause-agents', args: { why }, ok: true });
}
// A button runs exactly what it names: a model said loosely ("RadixArk Qwen 3.8 27B") is matched to the model it means
// before the button is offered, so pressing it can't fail on the name (seen 2026-11-09). One that matches nothing is an
// error now; several are left for the start to ask about.
async function firmModel(name, input) {
  if (name !== 'start_model' || !input.model || input.choice) return input;
  const found = await resolveModelName(input.model, await inventory(null));
  const exact = found.lib?.name || found.recipe?.id || found.repo || null;
  return exact ? { ...input, model: exact } : input;
}
// Whose changes count toward the hour's 12 (R9): not the owner's own clicks, POST /actions, a saved workflow's steps,
// nor self-healing.
const hourCounts = ctx => Boolean(ctx.via) && !['page', 'gateway', 'workflow', 'watcher', 'api'].includes(ctx.via);
// A change that ran through run or write_file (reads to runAction: the ladder decides) counts as runAction's own do,
// for whoever caused it (S-11): one that ran, or a long one started as an operation. A look, a button, the box and a
// refusal don't. The twelfth in the hour pauses agents' changes, and the runner refuses the next while paused.
function hourCounted(ctx, out) {
  if (!(out?.change === true && (out.ran === true || out.outcome === 'started')) || !hourCounts(ctx)) return out;
  const hourAgo = Date.now() - 3600000;
  while (agentChanges.length && agentChanges[0] < hourAgo) agentChanges.shift();
  agentChanges.push(Date.now());
  if (agentChanges.length >= AGENT_CHANGES_PER_HOUR) tripBreaker(`${AGENT_CHANGES_PER_HOUR} changes in the last hour`);
  return out;
}
// The asker's words on an audit line: masked before the cut, so a key across it is hidden whole.
const requestLine = r => (r ? maskSecrets(String(r).slice(0, 400)).slice(0, 200) : null);
async function runAction(name, viewer, args, ctx = {}) {
  // (a brain eval result waiting for the owner's yes: only its own button's press, 21-brain-rail.mjs)
  if (name === EVAL_YES) return evalYes(args, viewer, ctx);
  // (a coding trial result waiting for the owner's yes, the same way: 21-brain-trial.mjs)
  if (name === TRIAL_YES) return trialYes(args, viewer, ctx);
  const a = ACTIONS.get(name);
  if (!a) throw new HttpError(404, `No action called ${String(name).slice(0, 60)}.`);
  // (a change to Spark Console's own code: dark until the trial has a pass and it is turned on; then only the owner's
  // own chat, 21-selfchange.mjs, R69)
  if (name === 'propose_update') selfGate(viewer, ctx);
  if (a.who === 'owner' && viewer.role !== 'owner') throw new HttpError(403, 'Only the owner can do that.');
  // A button's arguments were kept here when it was offered (and checked then, or built here): they run as kept.
  let input = ctx.trusted ? args : checkInput(a.input, args, name);
  if (a.kind === 'read' && journalLooks(ctx)) return hourCounted(ctx, await journalLook(name, input, args, ctx, () => a.run(input, viewer, ctx)));
  if (a.kind === 'read') return hourCounted(ctx, await a.run(input, viewer, ctx));
  if (!ctx.canChange) {
    throw new HttpError(403, ctx.via === 'sparkie' ? 'This agent may look but not change things. The owner can allow it in your account menu → Agents and Telegram.' : 'This agent can look but not change things. The owner can allow it in your account menu → Agents and Telegram.');
  }
  // An agent's key as it is now, not as it was when its reply began (A-1, 2026-11-14: an agent removed while Sparkie was
  // answering it still stopped a model). agentKeys() throws when agents.json can't be read, so this fails closed.
  if (ctx.agentId) {
    const key = agentKeys().find(k => k.id === ctx.agentId);
    if (!key || !(key.scopes || []).includes('fleet:act')) throw new HttpError(403, 'This agent was removed (or may only look now), so nothing was changed.');
    if (putBackHeld()) throw new HttpError(403, PUTBACK_AGENTS);
  }
  // The pause is for agents (Sparkie, outside agents, auto-restart); the owner's own clicks always go through.
  // (Self-healing goes on through the automatic pause for a looping agent; only the owner's own pause stops it.)
  // (and the owner's own typed word, /undo, answered by code on the page and on Telegram: 20-words.mjs)
  if (ctx.via !== 'page' && !ctx.ownerWord && agentSettings().halted && !(ctx.via === 'watcher' && agentSettings().autoPaused)) throw new HttpError(403, 'Agents’ changes are paused (your account menu → Agents and Telegram).');
  // From Telegram these wait for the owner in Spark Console (undo_update asks its own question, naming the build).
  if (ctx.channel && PAGE_ONLY.has(name) && name !== 'undo_update' && !ctx.ownerConfirmed && !tgOwnMemory(name, input, ctx)) {
    const label = pageOnlyLabel(name, input);
    const out = question(viewer, ctx, `${label}? That one waits for you in Spark Console: press it there, with your passkey.`,
      [{ label, call: { action: name, args: input } }, { label: 'No, leave it', call: null }], 'question', { ownerOnly: true });
    audit({ via: ctx.via || null, actor: ctx.actor || null, channel: ctx.channel, ...(ctx.from ? { from: ctx.from } : {}), ...(ctx.chat ? { chat: ctx.chat } : {}), request: requestLine(ctx.request), action: name, args, ok: true, outcome: 'question' });
    return out;
  }
  // Sparkie runs a change straight away when the owner's message asks for that kind of change (not a question about it,
  // not ruled out) and the target is what their words name (sparkieCheck). Anything less clear comes back as a question
  // with a button. "Don't stop …" rules stopping out for the whole request.
  // (an action that asks the owner itself, as a dangerous ask, gets no plain question first: its own ask is the stronger
  // one, R54)
  // (and a proposal's install, which asks as install_update does: 21-selfchange.mjs, C8d)
  if (ctx.via === 'sparkie' && a.asks !== 'danger' && !(name === 'propose_update' && input.do === 'install')) {
    if (input.choice) throw new HttpError(403, 'Choices are buttons for whoever asked; don’t pass choice ids.');
    const check = await sparkieCheck(name, input, ctx);
    input = check.input;
    const was = workflowFor(name, input), wst = was && workflowStatus(was.id);
    // A workflow that's off isn't offered as a button either.
    if (wst?.state === 'untested') throw new HttpError(409, offMessage(wst));
    // (and a clear one runs at once only while Sparkie's brain is checked: the rail, 21-brain-rail.mjs, R52)
    if (!check.clear || !(await brainRail({ wait: RAIL_LOOK_WAIT_MS })).checked) {
      // Not clear: a question. For a workflow not yet validated, the yes is also its validation run (the owner's, or an
      // agent's that may change things, v3.1).
      const validating = wst?.state === 'needs-validation' && viewer.role === 'owner';
      const firm = await firmModel(name, input);
      return propose(viewer, ctx, name, validating ? { ...firm, __validate: was.id } : firm);
    }
    ctx = { ...ctx, auto: true };
  }
  // Every change is a workflow, and runs only as an active one (tested and validated), or as its validation run.
  const kept = input.choice ? pendingChoices.get(input.choice)?.args : null;
  const wf = workflowFor(name, kept || input);
  if (wf) {
    const st = workflowStatus(wf.id);
    if (st.state === 'untested') throw new HttpError(409, offMessage(st));
    if (st.state === 'needs-validation') {
      // A validation run is taken on purpose (v3.1, contract 6.3): a button or choice that offered it (kept with its
      // arguments when it was offered), or "Test the changes". No passkey: the owner and the owner's agents that may
      // change things both run one.
      // … or the owner's own clear request to Sparkie (2026-11-11: no extra buttons): it runs, and if it works, that
      // run validates it.
      const validationRun = viewer.role === 'owner' && ((ctx.trusted ? args : kept)?.__validate === wf.id || (ctx.via === 'sparkie' && ctx.auto === true) || ctx.via === 'workflow' || ctx.via === 'api');
      if (validationRun) ctx = { ...ctx, validating: wf.id };
      if (!validationRun) {
        // One question, and the yes (a button, or the choice's id) is the validation run: in the owner's chat, on the
        // page, or to an agent of the owner's that may change things.
        if (viewer.role === 'owner' && (ctx.via === 'sparkie' || (ctx.via === 'page' && ctx.conv) || (ctx.via === 'agent' && ctx.canChange))) {
          input = await firmModel(name, input);
          return question(viewer, ctx, `“${st.title}” (version ${st.version}) hasn’t been validated on your Sparks yet. Run it now as its validation run? If it works, Sparkie can use it from then on.`, [
            { label: `Yes, run it as its validation: ${changeLabel(name, input)}`, call: { action: name, args: { ...input, __validate: wf.id } } },
            { label: 'No, not now', call: null }]);
        }
        throw new HttpError(409, unvalidatedMessage(st));
      }
    }
    ctx = { ...ctx, workflow: wf.id, workflowVersion: st.version, plan: planOf(wf, st, input, ctx) };
  }
  // Many changes in an hour (ones that started an operation) pause agents, so a confused loop can't keep starting and
  // stopping models.
  // (the owner's own saved workflows and self-healing aren't an agent looping)
  const byAgent = hourCounts(ctx);
  if (byAgent) {
    const hourAgo = Date.now() - 3600000;
    while (agentChanges.length && agentChanges[0] < hourAgo) agentChanges.shift();
    if (agentChanges.length >= AGENT_CHANGES_PER_HOUR) { tripBreaker(`${AGENT_CHANGES_PER_HOUR} changes in the last hour`); throw new HttpError(403, 'Agents’ changes are paused: too many in the last hour. The owner can resume them in Access → Agents.'); }
  }
  // Sparkie working on the owner's own words (their page chat or Telegram, a carry-on turn too; never an agent's
  // ask_sparkie): a failed operation of the owner's isn't a looping agent (runJob, R9).
  const ownersOwn = ctx.via === 'sparkie' && !ctx.agent;
  const started = Date.now();
  const jid = journalFirst(name, input, args, ctx);
  try {
    const out = await a.run(input, viewer, ctx);
    if (byAgent && out?.operation && out.outcome !== 'already-starting') agentChanges.push(Date.now());
    if (ctx.conv && out?.outcome === 'started' && out?.operation && jobs.has(out.operation)) jobs.get(out.operation).conv ||= ctx.conv;
    // (and the request it was made for, so its task's report counts it: E7, 14-tasks.mjs)
    if (ctx.task && out?.outcome === 'started' && out?.operation && jobs.has(out.operation)) jobs.get(out.operation).task ||= ctx.task;
    if (ownersOwn && out?.outcome === 'started' && out?.operation && jobs.has(out.operation)) jobs.get(out.operation).ownersOwn = true;
    // Work started from Telegram reports there when it ends (20-tell.mjs).
    if (ctx.channel && ctx.conv && out?.outcome === 'started' && out?.operation && jobs.has(out.operation) && !jobs.get(out.operation).channel) {
      jobs.get(out.operation).channel = ctx.channel;
      tellAwait(jobs.get(out.operation));
    }
    if (ctx.undo && out?.outcome === 'started' && out?.operation && jobs.has(out.operation)) jobs.get(out.operation).undo = true;
    if (ctx.workflow && out?.outcome === 'started' && out.operation && jobs.has(out.operation) && !jobs.get(out.operation).workflow) {
      Object.assign(jobs.get(out.operation), { workflow: out.workflow || ctx.workflow, workflowVersion: out.workflowVersion || ctx.workflowVersion });
    }
    // A start Spark Console placed across two Sparks ran that workflow: the plan names it, and the two Sparks.
    const plan = ctx.plan && out?.workflow && out.workflow !== ctx.plan.workflow && workflowById(out.workflow)
      ? { ...ctx.plan, workflow: out.workflow, title: workflowById(out.workflow).title, version: out.workflowVersion || ctx.plan.version,
        inputs: ctx.plan.inputs.map(i => (i.source === 'chosen' && i.name === 'spark' && Array.isArray(out.sparks) ? { name: 'sparks', value: out.sparks.join(' + '), source: 'chosen' } : i)) }
      : ctx.plan;
    audit({ via: ctx.via || null, actor: ctx.actor || null, ...(ctx.channel ? { channel: ctx.channel } : {}), ...(ctx.from ? { from: ctx.from } : {}), ...(ctx.chat ? { chat: ctx.chat } : {}), request: requestLine(ctx.request), action: name, args, ok: true, outcome: out?.outcome || null, operation: out?.operation || null, ms: Date.now() - started,
      ...(plan ? { plan } : {}) });
    journalCalled(jid, name, input, args, ctx, { out, ms: Date.now() - started });
    if (plan && out && typeof out === 'object' && !Array.isArray(out)) return { ...out, plan };
    return out;
  } catch (e) {
    audit({ via: ctx.via || null, actor: ctx.actor || null, ...(ctx.channel ? { channel: ctx.channel } : {}), ...(ctx.from ? { from: ctx.from } : {}), ...(ctx.chat ? { chat: ctx.chat } : {}), request: requestLine(ctx.request), action: name, args, ok: false, error: maskSecrets(String(e.message).slice(0, 400)).slice(0, 200) });
    journalCalled(jid, name, input, args, ctx, { err: e, ms: Date.now() - started });
    throw e;
  }
}

// Results are shared between agents' calls for a few seconds. A result's age counts from when it arrived (a slow
// Spark doesn't make it stale on arrival), and two calls at once share one look.
const agentCache = new Map();
function recent(key, ttl, load) {
  const hit = agentCache.get(key);
  if (hit && (hit.pending || Date.now() - hit.at < ttl)) return hit.p;
  const entry = { at: Date.now(), pending: true };
  entry.p = load().then(v => { entry.pending = false; entry.at = Date.now(); return v; },
    e => { if (agentCache.get(key) === entry) agentCache.delete(key); throw e; });
  agentCache.set(key, entry);
  return entry.p;
}
// (when each shared look began: what changed on a Spark after that may not be in it; 20-desired.mjs desiredNow)
const lookBegan = new WeakMap();
const recentInventory = () => recent('inventory', 15000, async () => {
  const began = Date.now(), v = { ...(await inventory(null)), observedAt: new Date().toISOString() };
  lookBegan.set(v, began);
  return v;
});
const recentMain = () => recent('main', 5000, () => mainStatus());

// Agents name models the way people do: the library name, a Hugging Face repo, a cache name (Qwen--Qwen3-32B) or a
// recipe id. All of them find the same model on disk.
const onDiskAs = (m, repo) => Boolean(repo) && ((m.repo && sameRepo(m.repo, repo)) || m.name === String(repo).replace('/', '--')
  || squash(m.name) === squash(String(repo).split('/').pop()));
function libraryModel(inv, name) {
  const q = String(name).trim(), lib = inv.library;
  const hit = lib.find(m => m.name === q) || lib.find(m => onDiskAs(m, q));
  if (hit) return hit;
  const r = recipeCatalog().models.find(x => x.id === q);
  return r ? lib.find(m => r.variants.some(v => onDiskAs(m, v.repo))) || null : null;
}
const mainArg = flag => { const a = MAIN?.args || [], i = a.indexOf(flag), n = i >= 0 ? Number(a[i + 1]) : NaN; return Number.isInteger(n) && n > 0 ? n : null; };

const wordStart = w => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

const CREDIBILITY = { high: 0, medium: 1, low: 2 };

/* ───────── files in a Spark's shared folder (R37) ───────── */
// Sparkie and agents reach files only in a Spark's shared folder, only through the worker's workspace-files (sparkFiles,
// 12-status.mjs: its permission check, its cap on file operations at once, the shared scope); Node never builds a path
// on disk. A path is plain words between slashes: no hidden name, no "..", nothing absolute, no backslash.
const filePattern = (more = '') => String.raw`^[^./\\\x00-\x1f${more}][^/\\\x00-\x1f${more}]*(?:/[^./\\\x00-\x1f${more}][^/\\\x00-\x1f${more}]*)*/?$`;
const FILE_PATH = filePattern();
// A name saved from here has nothing that doesn't show or that turns text around (zero-width and direction marks), so
// the button shows the name it writes.
const SAVE_PATH = filePattern(String.raw`\x7f-\x9f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff`);
const FILE_SHOW = 8000, FILE_LIST = 100, FILE_SAVE_BYTES = 65536;
const filePathArg = { type: 'string', maxLength: 300, pattern: FILE_PATH };
const sizeWords = n => (n < 1024 ? `${n} bytes` : `${Math.round(n / 102.4) / 10} KB`);
function filePath(p) { const s = String(p).replace(/\/$/, ''); if (s !== Buffer.from(s).toString()) throw new HttpError(400, 'That name isn’t plain text.'); return s; }
// The worker's own refusals (not found, a name that's taken, not a file) keep their meaning; a Spark that doesn't answer
// stays 502.
// A look at a Spark when two of the owner's file operations are already going (the cap is the page's too) says it was
// busy and to try again.
async function sharedFolder(viewer, node, request) {
  try { return await sparkFiles(viewer, node, { ...request, area: 'shared' }); } catch (e) {
    if (e.status === 429) {
      const what = request.operation === 'write' ? `${request.path} wasn’t saved` : `${request.path || 'The shared folder'} wasn’t ${request.operation === 'list' ? 'listed' : 'read'}`;
      throw new HttpError(429, `Busy: ${what} on ${sparkName(node)}, because two other file operations were going on (at most two run at once). Nothing is wrong with it: try it again.`);
    }
    if (!e.refused) throw e;
    throw new HttpError(e.conflict ? 409 : /not found/i.test(e.message) ? 404 : 400, e.message);
  }
}

