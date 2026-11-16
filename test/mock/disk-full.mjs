// A full disk under the journal only, for journal.test.mjs: started with NODE_OPTIONS=--import=<this file> (like
// clock.mjs), it acts only in the service. While $MOCK_DIR/disk-full is there, every write to a file in the journal's
// folder ($SPARK_CONSOLE_JOURNAL_DIR) fails as a full disk does (ENOSPC), after the file opened fine. While
// $MOCK_DIR/fsync-fail is there, the writes work and syncing a journal file fails (EIO), as a failing disk can. The same
// for the secrets file's folder ($SPARK_CONSOLE_SECRETS_FILE's) with $MOCK_DIR/secrets-full and $MOCK_DIR/secrets-fsync-fail
// (putback.test.mjs). Everything else the service writes (its state folder, chats) is left alone.
import fs, { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

if (/\/service\/server\.mjs$/.test(process.argv[1] || '') && !process.execArgv.includes('-e') && process.env.MOCK_DIR && process.env.SPARK_CONSOLE_JOURNAL_DIR) {
  const dir = process.env.SPARK_CONSOLE_JOURNAL_DIR, flag = `${process.env.MOCK_DIR}/disk-full`, syncFlag = `${process.env.MOCK_DIR}/fsync-fail`, fds = new Set();
  const sdir = process.env.SPARK_CONSOLE_SECRETS_FILE ? process.env.SPARK_CONSOLE_SECRETS_FILE.replace(/\/[^/]*$/, '/') : null, sfds = new Set();
  const sflag = `${process.env.MOCK_DIR}/secrets-full`, ssyncFlag = `${process.env.MOCK_DIR}/secrets-fsync-fail`;
  const { openSync, closeSync, writeSync, fsyncSync } = fs;
  fs.openSync = function (path, ...rest) {
    const fd = openSync.call(this, path, ...rest);
    if (String(path).startsWith(dir)) fds.add(fd);
    if (sdir && String(path).startsWith(sdir)) sfds.add(fd);
    return fd;
  };
  fs.closeSync = function (fd) { fds.delete(fd); sfds.delete(fd); return closeSync.call(this, fd); };
  fs.writeSync = function (fd, ...rest) {
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
