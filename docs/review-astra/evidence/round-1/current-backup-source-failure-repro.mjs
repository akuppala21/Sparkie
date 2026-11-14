import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// This snapshot harness must match the selected checkout before it runs.
const reviewRoot = resolve(process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../', import.meta.url)));
const backupSource = readFileSync(join(reviewRoot, 'service/src/25-backup-and-start.mjs'), 'utf8');
const start = backupSource.indexOf('function sendCopy('), end = backupSource.indexOf('async function backupState(');
assert.ok(start >= 0 && end > start, 'Cannot locate sendCopy in the selected source.');
const embeddedSendCopy = sendCopy.toString()
  .replace('const src = rawSpawn(', 'const src = spawn(')
  .replace("{ stdio: ['ignore', 'pipe', 'pipe'] }", "{ stdio: ['ignore', 'pipe', 'ignore'] }")
  .replace("    src.stderr.on('data', d => {tarError += d});\n", '')
  .replace("src.on('close', c => { tarStatus=c; ", "src.on('close', c => { ");
assert.equal(embeddedSendCopy, backupSource.slice(start, end).trim(),
  'sendCopy changed: update and peer-check this snapshot harness before rerunning it.');
const dir = mkdtempSync('/tmp/sc-backup-source-');
const STATE_DIR = join(dir, 'state');
const home = join(dir, 'remote');
const destination = join(home, '.local/share/spark-console/backups');
mkdirSync(STATE_DIR, { recursive: true }); mkdirSync(destination, { recursive: true });
const name = 'state-2026-11-14.tgz';
let tarStatus=null, tarError='';
const rawSpawn = spawn;
const dest = join(destination, name);
const hash = () => createHash('sha256').update(readFileSync(dest)).digest('hex');
function spawnOn(_target, { command }) { return spawn('bash', ['-c', command], { env: { ...process.env, HOME: home }, stdio: ['pipe','pipe','pipe'] }); }
function sendCopy(target, name) {
  const dir = '"$HOME/.local/share/spark-console/backups"', part = `${dir}/${name}.part`;
  return new Promise(resolve => {
    const src = rawSpawn('tar', ['-C', STATE_DIR, '--exclude=*.sock', '--exclude=./cloud.json', '-czf', '-', '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
    src.stderr.on('data', d => {tarError += d});
    // gzip reads the .part from stdin (GNU gzip refuses a file name ending .part) and answers 2 for a warning only (macOS
    // tar pads its output with zeros); a copy cut short answers 1 and is removed, never moved into place.
    const dst = spawnOn(target, { command: `umask 077 && mkdir -p ${dir} && cat > ${part} && { gzip -t < ${part}; g=$?; [ $g = 0 ] || [ $g = 2 ]; } && mv ${part} ${dir}/${name}; s=$?; rm -f ${part}; [ $s = 0 ] && ls -1t ${dir}/state-*.tgz | tail -n +15 | xargs -r rm -f; exit $s` });
    let tarCode = null, farCode = null, done = false;
    const timer = setTimeout(() => { src.kill('SIGKILL'); dst.kill('SIGKILL'); }, 180000);
    const finish = () => {
      if (done || tarCode === null || farCode === null) return;
      done = true;
      clearTimeout(timer);
      // GNU tar answers 1 when a file changed while it read it (a chat being saved): the copy is still good.
      resolve(farCode === 0 && tarCode <= 1);
    };
    src.on('close', c => { tarStatus=c; tarCode ??= c ?? 2; finish(); });
    src.on('error', () => { tarCode ??= 2; finish(); });
    // (the far side ending first leaves tar nobody to write to: it is stopped, and the copy doesn't count)
    dst.on('close', c => { farCode ??= c ?? 1; src.kill('SIGKILL'); finish(); });
    dst.on('error', () => { farCode ??= 1; src.kill('SIGKILL'); finish(); });
    src.stdout.pipe(dst.stdin);
    dst.stdin.on('error', () => {});
  });
}
try {
  writeFileSync(join(STATE_DIR, 'access.json'), '{"ownerLogin":"owner@test"}');
  writeFileSync(join(STATE_DIR, 'chats.json'), '{"conversations":["irreplaceable chat"]}');
  let good = spawnSync('tar', ['-C', STATE_DIR, '-czf', dest, '.']);
  if (good.status !== 0) throw new Error('initial backup failed');
  const before = hash();
  chmodSync(join(STATE_DIR, 'chats.json'), 0);
  const accepted = await sendCopy({id:'mock'}, name);
  const after = hash();
  const contents = spawnSync('tar', ['-tzf', dest], { encoding:'utf8' });
  const result = { case:'failed-source-tar-replaces-good-backup', sendCopyAccepted:accepted, tarExitStatus:tarStatus, tarStderr:tarError, previousBackupOverwritten:before!==after, archiveIsValid:contents.status===0, archiveEntries:contents.stdout.trim().split('\n'), missingChats:!contents.stdout.includes('chats.json') };
  console.log(JSON.stringify(result,null,2));
} finally { chmodSync(join(STATE_DIR,'chats.json'),0o600); rmSync(dir,{recursive:true,force:true}); }
