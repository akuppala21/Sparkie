// Diagnostic evidence only (R47): full masked replies and tool results never join an eval's kept grade.
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, fchmodSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { gradeRun } from './eval-grade.mjs';

export const DIAGNOSTICS_KIND = 'spark-console-eval-evidence';
const MAX_ATTEMPT_BYTES = 2 * 1024 * 1024;
// Lift only the production masking definitions. No service startup, secretsRead, environment or home lookup runs.
// Read only this run's own fixture file. A link out of that fixture is a capture failure, never a home read.
export function fixtureSecretSnapshot(fleet) {
  if (resolve(fleet.secretsFile) !== resolve(fleet.dir, 'secrets', 'secrets.json')) throw new Error('Not a fixture secret file');
  const file = join(realpathSync(fleet.dir), 'secrets', 'secrets.json');
  try {
    if (realpathSync(file) !== file) throw new Error('Linked fixture secret file');
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
export function diagnosticMask(snapshot, answerSecret = [], readSource = url => readFileSync(url, 'utf8')) {
  if (answerSecret.some(value => typeof value !== 'string' || value.length < 8)) throw new Error('Case token cannot use production masking');
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('No fixture secret snapshot');
  const secrets = readSource(new URL('../service/src/03-secrets.mjs', import.meta.url));
  const mcp = readSource(new URL('../service/src/20-mcp.mjs', import.meta.url));
  const keptAt = secrets.indexOf('const keptSeen = '), maskAt = mcp.indexOf('const SECRET_PATTERNS = ');
  if (keptAt < 0 || maskAt < 0 || !secrets.includes('function keptHidden(') || !mcp.includes('function maskDeep(')) throw new Error('No production masking definitions');
  // Additional made-up case tokens use the same exact-value, percent and base64 forms as real kept keys.
  const values = [...Object.values(snapshot.keys || {}), ...answerSecret.map(value => ({ value }))];
  const fixture = { ...snapshot, keys: Object.fromEntries(values.map((value, i) => [String(i), value])) };
  return runInNewContext(`${secrets.slice(keptAt)}\n${mcp.slice(maskAt)}\n` +
    // maskDeep hides values; a secret can also be printed as an object's key.
    `const names = v => Array.isArray(v) ? v.map(names) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [maskSecrets(k), names(x)])) : v;
     value => names(maskDeep(value));`, {
      Buffer, SECRETS_FILE: '/fixture-secrets-only', statSync: () => ({ mtimeMs: 1 }), secretsRead: () => fixture,
    }, { timeout: 1000 });
}
export function diagnosticAttempt(identity, raw, options = {}) {
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > MAX_ATTEMPT_BYTES) return { ...identity, truncated: true, captureError: 'Evidence exceeded 2 MiB for this attempt; its text was omitted.' };
    const masked = diagnosticMask(options.snapshot, options.answerSecret, options.readSource)(raw);
    // Reuse the grader's exact seeded-token check too: spaced letters and 12-sign fragments are leaks there.
    // Production masking handles exact/encoded secrets; anything left that would fail that check is omitted whole.
    const strings = v => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : [];
    if (gradeRun({ expect: 'answer', answerSecret: options.answerSecret || [] }, { msg: { content: strings(masked).join(' ') } }).kept.answerSecret) {
      return { ...identity, captureError: 'Evidence still held part of a made-up case secret after masking; its text was omitted.' };
    }
    const text = JSON.stringify(masked);
    if (Buffer.byteLength(text) > MAX_ATTEMPT_BYTES) return { ...identity, truncated: true, captureError: 'Evidence exceeded 2 MiB for this attempt; its text was omitted.' };
    return { ...identity, ...JSON.parse(text) };
  } catch {
    // Never attach the exception: it can itself contain unmasked fixture replies or keys.
    return { ...identity, captureError: 'Diagnostic evidence could not be read or masked; its text was omitted.' };
  }
}
// Every attempt, including a no-result try before its retry, stays separate. Only safe grade flags join evidence.
export function retainAttempt(attempts, identity, captured, result) {
  attempts.push({ ...(captured || { ...identity, captureError: 'The practice fleet did not provide diagnostic evidence.' }), notResult: result?.notResult === true, passed: result?.pass === true });
}
// Diagnostics share the case's wait budget and get at most 30 seconds; they never restart that budget.
export function diagnosticWaitMs(waitMs, began, now = Date.now()) {
  if (!Number.isFinite(waitMs) || waitMs < 0 || !Number.isFinite(began) || !Number.isFinite(now)) throw new TypeError('Diagnostic wait needs a finite nonnegative bound and clock');
  return Math.min(30000, Math.max(0, waitMs - Math.max(0, now - began)));
}
// A reply may hand back an operation while it is still loading. Wait only for those case-linked operations, after
// grading, so teardown does not erase their terminal outcome. Missing or still-running operations stay explicit.
export async function terminalOperations(readJobs, ids, { waitMs, now = Date.now, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (!Number.isFinite(waitMs) || waitMs < 0) throw new TypeError('Operation wait needs a finite nonnegative bound');
  const wanted = [...new Set(ids)], until = now() + waitMs;
  for (;;) {
    const snapshot = await readJobs();
    if (!Array.isArray(snapshot?.jobs)) throw new Error('No operation snapshot');
    const open = wanted.filter(id => !snapshot.jobs.some(j => j.id === id && ['completed', 'failed', 'cancelled'].includes(j.status)));
    if (!open.length || now() >= until) return { jobs: snapshot.jobs, open };
    await pause(Math.min(250, Math.max(0, until - now())));
  }
}
export function writeDiagnostics(file, attempts, metadata = {}) {
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify({ ...metadata, kind: DIAGNOSTICS_KIND, qualification: false, attempts }, null, 2)}\n`);
    fchmodSync(fd, 0o600); fsyncSync(fd); closeSync(fd); fd = undefined;
    // Replaces an old file or a symlink itself, never writes through it; existing broad permissions are discarded.
    renameSync(tmp, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tmp); } catch {}
  }
}
