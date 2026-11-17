// A full disk under the journal only, for journal.test.mjs: started with NODE_OPTIONS=--import=<this file> (like
// clock.mjs), it acts only in the service. While $MOCK_DIR/disk-full is there, every write to a file in the journal's
// folder ($SPARK_CONSOLE_JOURNAL_DIR) fails as a full disk does (ENOSPC), after the file opened fine. While
// $MOCK_DIR/fsync-fail is there, the writes work and syncing a journal file fails (EIO), as a failing disk can. The same
// for the secrets file's folder ($SPARK_CONSOLE_SECRETS_FILE's) with $MOCK_DIR/secrets-full and $MOCK_DIR/secrets-fsync-fail
// (putback.test.mjs). Everything else the service writes (its state folder, chats) is left alone, but for one thing:
// while $MOCK_DIR/stop-between is there, naming two files (say "secrets.json agents.json"), the service is killed
// (SIGKILL, as a power cut) the moment it opens the second of the two to write it (its temporary file counts),
// whichever comes first: a stop between two writes, either way round (putback.test.mjs). While $MOCK_DIR/journal-short
// is there, the first write to each journal file it opens takes only half of what it was given and says so, as a
// nearly full disk does (with disk-full there too, the next write then fails).
import fs, { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

if (/\/service\/server\.mjs$/.test(process.argv[1] || '') && !process.execArgv.includes('-e') && process.env.MOCK_DIR && process.env.SPARK_CONSOLE_JOURNAL_DIR) {
  const dir = process.env.SPARK_CONSOLE_JOURNAL_DIR, flag = `${process.env.MOCK_DIR}/disk-full`, syncFlag = `${process.env.MOCK_DIR}/fsync-fail`, fds = new Set();
  const sdir = process.env.SPARK_CONSOLE_SECRETS_FILE ? process.env.SPARK_CONSOLE_SECRETS_FILE.replace(/\/[^/]*$/, '/') : null, sfds = new Set();
  const sflag = `${process.env.MOCK_DIR}/secrets-full`, ssyncFlag = `${process.env.MOCK_DIR}/secrets-fsync-fail`;
  const stopFlag = `${process.env.MOCK_DIR}/stop-between`, written = new Set();
  const shortFlag = `${process.env.MOCK_DIR}/journal-short`, wroteOn = new Set();
  const { openSync, closeSync, writeSync, fsyncSync, readFileSync } = fs;
  fs.openSync = function (path, ...rest) {
    const fd = openSync.call(this, path, ...rest);
    if (String(path).startsWith(dir)) fds.add(fd);
    if (sdir && String(path).startsWith(sdir)) sfds.add(fd);
    if (/[wa+]/.test(String(rest[0] ?? 'r')) && existsSync(stopFlag)) {
      const base = String(path).split('/').pop(), hit = readFileSync(stopFlag, 'utf8').split(/\s+/).find(n => n && (base === n || base.startsWith(`${n}.`)));
      if (hit) { written.add(hit); if (written.size >= 2) process.kill(process.pid, 'SIGKILL'); }
    }
    return fd;
  };
  fs.closeSync = function (fd) { fds.delete(fd); sfds.delete(fd); wroteOn.delete(fd); return closeSync.call(this, fd); };
  fs.writeSync = function (fd, ...rest) {
    if (fds.has(fd) && !wroteOn.has(fd) && existsSync(shortFlag)) {
      wroteOn.add(fd);
      let [b, off, len] = rest;
      if (typeof b === 'string') { b = Buffer.from(b); off = 0; len = b.length; } else { off ??= 0; len ??= b.length - off; }
      return writeSync.call(this, fd, b, off, Math.max(1, Math.floor(len / 2)));
    }
    if (fds.has(fd)) wroteOn.add(fd);
    if ((fds.has(fd) && existsSync(flag)) || (sfds.has(fd) && existsSync(sflag))) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', errno: -28, syscall: 'write' });
    return writeSync.call(this, fd, ...rest);
  };
  fs.fsyncSync = function (fd) {
    if ((fds.has(fd) && existsSync(syncFlag)) || (sfds.has(fd) && existsSync(ssyncFlag))) throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO', errno: -5, syscall: 'fsync' });
    return fsyncSync.call(this, fd);
  };
  // The service imports these by name: its bindings now see the stand-ins.
  syncBuiltinESMExports();
}
