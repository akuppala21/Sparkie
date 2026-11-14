// A software passkey for tests (a P-256 or RSA key from node:crypto) that answers like Touch ID would: "none"
// attestation, user present and verified. The same as passkey.test.mjs's, shared with internet.test.mjs.
import { createHash, generateKeyPairSync, randomBytes, sign as signWith } from 'node:crypto';

const sha256 = d => createHash('sha256').update(d).digest();
export const b64 = buf => Buffer.from(buf).toString('base64url');
const raw = s => Buffer.from(s, 'base64url');
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
// The part of CBOR WebAuthn needs: integers, byte and text strings, arrays, maps.
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) return Buffer.concat([Buffer.from([(major << 5) | 25]), u16(n)]);
    return Buffer.concat([Buffer.from([(major << 5) | 26]), u32(n)]);
  };
  if (Number.isInteger(v)) return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const entries = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}
export const UP = 0x01, UV = 0x04, AT = 0x40;
export class Authenticator {
  constructor(rpId, origin) {
    Object.assign(this, generateKeyPairSync('ec', { namedCurve: 'P-256' }));
    this.credId = randomBytes(32);
    this.rpId = rpId;
    this.origin = origin;
  }
  get id() { return b64(this.credId); }
  cose() {
    const jwk = this.publicKey.export({ format: 'jwk' });
    return new Map([[1, 2], [3, -7], [-1, 1], [-2, raw(jwk.x)], [-3, raw(jwk.y)]]);
  }
  authData({ rpId = this.rpId, flags, signCount = 0, attested = false }) {
    const parts = [sha256(rpId), Buffer.from([flags]), u32(signCount)];
    if (attested) parts.push(Buffer.alloc(16), u16(this.credId.length), this.credId, cbor(this.cose()));
    return Buffer.concat(parts);
  }
  clientData({ type, challenge, origin }) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  // navigator.credentials.create() → the body of POST /auth/passkey/register.
  register(begin, { origin = this.origin, name = 'Test passkey' } = {}) {
    const cd = this.clientData({ type: 'webauthn.create', challenge: begin.challenge, origin });
    const ao = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData({ flags: UP | UV | AT, attested: true })]]));
    return { challengeId: begin.challengeId, name, clientDataJSON: b64(cd), attestationObject: b64(ao) };
  }
  // navigator.credentials.get() → an assertion (the sign-in body, or what X-Spark-Passkey carries).
  sign(begin, { origin = this.origin, signCount = 0 } = {}) {
    const cd = this.clientData({ type: 'webauthn.get', challenge: begin.challenge, origin }), ad = this.authData({ flags: UP | UV, signCount });
    const signature = signWith('sha256', Buffer.concat([ad, sha256(cd)]), this.privateKey);
    return { challengeId: begin.challengeId, id: this.id, clientDataJSON: b64(cd), authenticatorData: b64(ad), signature: b64(signature) };
  }
}
export const passkeyHeader = assertion => b64(JSON.stringify(assertion));
