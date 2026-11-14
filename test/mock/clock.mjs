// A clock a test can move forward, for the service only: started with NODE_OPTIONS=--import=<this file> (see
// passkey.test.mjs), the service's Date.now() runs ahead by the milliseconds written to $MOCK_DIR/clock-offset (read
// every 100 ms; no file means the real time). Every other process that loads it is left alone.
import { readFileSync } from 'node:fs';

if (/\/service\/server\.mjs$/.test(process.argv[1] || '') && !process.execArgv.includes('-e') && process.env.MOCK_DIR) {
  const file = `${process.env.MOCK_DIR}/clock-offset`, real = Date.now.bind(Date);
  let offset = 0;
  const read = () => { try { offset = Number(readFileSync(file, 'utf8')) || 0; } catch { offset = 0; } };
  read();
  setInterval(read, 100).unref();
  Date.now = () => real() + offset;
}
