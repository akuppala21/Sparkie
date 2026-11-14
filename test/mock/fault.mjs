// Faults inside the service, for faults.test.mjs: started with NODE_OPTIONS=--import=<this file> (like clock.mjs), it acts
// only in the service. A request carrying the header x-mock-fault throws once inside its route, at the answer (use it
// only on a route that normally answers 200: a route that refuses would meet the throw inside the handler's own error
// answer and never answer). $MOCK_DIR/fault-reject rejects a promise nobody listens to; $MOCK_DIR/fault-throw throws
// from a timer (an uncaught error). Each file is removed when it is acted on. The messages carry a fake key, so a test can
// check it is hidden wherever the fault is kept.
import http from 'node:http';
import { existsSync, unlinkSync } from 'node:fs';

if (/\/service\/server\.mjs$/.test(process.argv[1] || '') && !process.execArgv.includes('-e') && process.env.MOCK_DIR) {
  const TOKEN = 'hf_abcdefghijklmnopqrstuvwxyz0123', dir = process.env.MOCK_DIR;
  const writeHead = http.ServerResponse.prototype.writeHead;
  http.ServerResponse.prototype.writeHead = function (...args) {
    if (this.req?.headers['x-mock-fault'] && !this.mockFaulted) { this.mockFaulted = true; throw new TypeError(`mock fault in a route ${TOKEN}`); }
    return writeHead.apply(this, args);
  };
  const appeared = name => { if (!existsSync(`${dir}/${name}`)) return false; unlinkSync(`${dir}/${name}`); return true; };
  setInterval(() => {
    if (appeared('fault-reject')) Promise.reject(new Error(`mock rejection ${TOKEN}`));
    if (appeared('fault-throw')) throw new Error(`mock crash ${TOKEN}`);
  }, 100).unref();
}
