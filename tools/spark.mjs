#!/usr/bin/env node
// spark: Spark Console's actions from your terminal, for you and for agents like Claude Code.
// It talks to the same agent door (MCP) as Claude Code's connection, with an agent key from
// Spark Console → Sharing & access → Agents. Whatever actions the console offers show up here automatically.
//
//   spark setup                         save the console's agent address and your key (asked for, not typed on the line)
//   spark                               list the actions and what each takes
//   spark fleet_status                  run one; arguments as --name value, or in order: spark where_it_fits gpt-oss-20b
//   spark find_recipes --query "qwen coder" --limit 3
//   spark ask "what's running, and is anything idle?"        talk with Sparkie; it waits for the answer
//   spark ask --conversation sc_… "start the best coding model that fits"
//   spark ask --conversation sc_… --choice <id>              take a choice Sparkie offered
//   add --json for one line of JSON (agents), otherwise it's indented
//
// Needs Node.js 18 or newer and Tailscale connected on this machine, signed in as the console's owner.
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const DIR = `${homedir()}/.config/spark-console`, FILE = `${DIR}/agent.json`;
const DEFAULT_URL = 'https://akspark1.tailab9aa9.ts.net:8443/console/api/mcp';
const die = (msg, code = 2) => { process.stderr.write(`${msg}\n`); process.exit(code); };
// The key only ever goes to an https address that ends in /mcp (plain http only to this machine, for testing).
const goodUrl = u => /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/\S*mcp$/.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\S*mcp$/.test(u);

function settings() {
  let saved = {};
  try { saved = JSON.parse(readFileSync(FILE, 'utf8')); } catch {}
  const url = process.env.SPARK_CONSOLE_URL || saved.url || DEFAULT_URL, key = process.env.SPARK_CONSOLE_KEY || saved.key;
  if (!key) die('No agent key yet. In Spark Console open Sharing & access → Agents → Connect an agent, then run: spark setup');
  if (!goodUrl(url)) die(`${url} isn’t an agent address (https, ending in /mcp). Run spark setup again.`);
  return { url, key };
}

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

async function setup() {
  const url = (await ask(`Agent address [${DEFAULT_URL}]: `)) || DEFAULT_URL;
  if (!goodUrl(url)) die('That doesn’t look like the agent address (https, ending in /mcp).');
  const key = await ask('Agent key (it won’t show as you paste): ', { hidden: true });
  if (!/^sck_[A-Za-z0-9_-]{43}$/.test(key)) die('That isn’t an agent key. Copy it from the dialog in Spark Console (it starts with sck_).');
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(FILE, JSON.stringify({ url, key }, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
  const tools = await rpc({ url, key }, 'tools/list');
  console.log(`Saved to ${FILE}. ${tools.tools.length} actions available; run spark to see them.`);
}

let nextId = 1;
async function rpc({ url, key }, method, params) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) }),
      signal: AbortSignal.timeout(180000),
      redirect: 'error',
    });
  } catch (e) {
    die(`Couldn’t reach Spark Console at ${url}: ${e.cause?.code || e.message}. Is Tailscale connected?`);
  }
  const body = await res.json().catch(() => null);
  if (!body) die(`Spark Console answered ${res.status} without a message.`);
  // JSON-RPC errors carry a message; the console's own refusals (identity, the Sparks themselves) are plain text.
  if (body.error) die((typeof body.error === 'string' ? body.error : body.error.message) || `Spark Console answered ${res.status}.`);
  return body.result;
}

function usage(tools) {
  const lines = ['Spark Console actions (spark <action> --arg value):', ''];
  for (const t of tools) {
    const props = t.inputSchema?.properties || {}, req = new Set(t.inputSchema?.required || []);
    const args = Object.keys(props).map(k => (req.has(k) ? `--${k} <${props[k].type}>` : `[--${k} <${props[k].type}>]`)).join(' ');
    lines.push(`  ${t.name}${args ? ` ${args}` : ''}`, `      ${t.description}`);
  }
  lines.push('', 'Add --json for compact output. spark setup saves the address and key.');
  return lines.join('\n');
}

// --name value, --name=value, --flag, and leftover words fill the required arguments in order.
function parseArgs(tool, argv) {
  const props = tool.inputSchema?.properties || {}, required = tool.inputSchema?.required || [], args = {}, loose = [];
  const set = (k, raw) => {
    const name = k.replace(/-/g, '_'), p = props[name];
    if (!p) die(`${tool.name} doesn’t take --${k}. It takes: ${Object.keys(props).map(x => `--${x}`).join(', ') || 'nothing'}.`);
    if (p.type === 'integer') { if (!/^-?\d+$/.test(String(raw))) die(`--${k} needs a whole number.`); args[name] = Number(raw); }
    else if (p.type === 'boolean') args[name] = raw === true || raw === 'true';
    else if (raw === true) die(`--${k} needs a value.`);
    else args[name] = String(raw);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { loose.push(a); continue; }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    if (v !== undefined) set(k, v);
    else if (props[k.replace(/-/g, '_')]?.type === 'boolean') set(k, /^(true|false)$/.test(argv[i + 1] || '') ? argv[++i] : true);
    else if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) set(k, true);
    else set(k, argv[++i]);
  }
  const open = required.filter(k => args[k] === undefined);
  if (loose.length > open.length) die(`Too many values for ${tool.name}: ${loose.slice(open.length).join(' ')}`);
  loose.forEach((v, i) => set(open[i], v));
  return args;
}

const argv = process.argv.slice(2), json = argv.includes('--json'), rest = argv.filter(a => a !== '--json');
if (rest[0] === 'setup') await setup();
else {
  const conn = settings(), { tools } = await rpc(conn, 'tools/list');
  if (!rest[0] || ['help', '-h', '--help'].includes(rest[0])) { console.log(usage(tools)); process.exit(0); }
  const name = rest[0] === 'ask' ? 'ask_sparkie' : rest[0].replace(/-/g, '_');
  const tool = tools.find(t => t.name === name);
  if (!tool) die(`No action called ${rest[0]}. Run spark to see them.`);
  // spark ask "words": the words are the message (no need for --message).
  const args = name === 'ask_sparkie' ? parseAsk(rest.slice(1)) : parseArgs(tool, rest.slice(1));
  const call = async a => {
    const result = await rpc(conn, 'tools/call', { name, arguments: a });
    const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    let value = null;
    try { value = JSON.parse(text); } catch {}
    if (result.isError) die(text, 1);
    return { text, value };
  };
  let { text, value } = await call(args);
  // Sparkie may take longer than one call: keep waiting (each call waits up to 40 s), up to 10 minutes.
  for (let i = 0; name === 'ask_sparkie' && value?.status === 'thinking' && i < 15; i++) {
    if (!json) process.stderr.write('Sparkie is still answering …\n');
    ({ text, value } = await call({ conversation: value.conversation }));
  }
  if (name === 'ask_sparkie' && value && !json) {
    // Text from logs can carry terminal control codes: only plain text, new lines and tabs are printed.
    const plain = t => String(t ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
    console.log(plain(value.reply || value.error || '(no answer)'));
    for (const c of value.choices || []) console.log(`  [${plain(c.id)}] ${plain(c.label)}    spark ask --conversation ${plain(value.conversation)} --choice ${plain(c.id)}`);
    console.log(`\n(conversation ${value.conversation}${value.status === 'thinking' ? ', still answering' : ''})`);
  } else console.log(value === null ? text : JSON.stringify(value, null, json ? 0 : 2));
}

// ask's own arguments: --conversation, --choice, and the rest of the words as the message.
function parseAsk(list) {
  const out = {}, words = [];
  for (let i = 0; i < list.length; i++) {
    const [k, v] = list[i].startsWith('--') ? list[i].slice(2).split(/=(.*)/s) : [null];
    if (k === 'conversation' || k === 'choice' || k === 'message') {
      const value = v !== undefined ? v : list[++i];
      if (value === undefined) die(`--${k} needs a value.`);
      if (k === 'message') words.push(value); else out[k] = value;
    } else if (k) die(`ask takes --conversation, --choice and the message.`);
    else words.push(list[i]);
  }
  if (words.length) out.message = words.join(' ');
  if (!out.message && !out.conversation) die('Say something: spark ask "what’s running?"');
  return out;
}
