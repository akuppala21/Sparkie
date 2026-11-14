// Passkeys (WebAuthn) for the owner: Touch ID, Face ID, a phone or a security key. Spark Console uses one to confirm
// the few actions that change who has access (people, invites, agent keys and their rights), so neither a program on
// the owner's device nor a compromised internet-facing device can do those with Tailscale's identity alone.
// This file only checks; the service keeps the passkeys and the one-time challenges. Standard WebAuthn, no packages:
// "none" attestation (the browser vouches for nothing extra), ES256, RS256 and Ed25519 keys.
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

export const b64url = buf => Buffer.from(buf).toString('base64url');
export const fromB64url = s => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > 20000) throw new Error('Not base64url.');
  return Buffer.from(s, 'base64url');
};
const sha256 = data => createHash('sha256').update(data).digest();

// The small part of CBOR WebAuthn uses: integers, byte and text strings, arrays and maps (definite lengths).
export function cbor(buf) {
  let i = 0;
  const need = n => { if (i + n > buf.length) throw new Error('CBOR ends early.'); };
  const length = info => {
    if (info < 24) return info;
    const size = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!size) throw new Error('CBOR length not supported.');
    need(size);
    const v = size === 8 ? Number(buf.readBigUInt64BE(i)) : buf.readUIntBE(i, size);
    i += size;
    return v;
  };
  const item = depth => {
    if (depth > 8) throw new Error('CBOR nested too deep.');
    need(1);
    const head = buf[i++], type = head >> 5, n = length(head & 31);
    if (type === 0) return n;
    if (type === 1) return -1 - n;
    if (type === 2 || type === 3) { need(n); const v = buf.subarray(i, i + n); i += n; return type === 2 ? Buffer.from(v) : v.toString('utf8'); }
    if (type === 4) { if (n > 1000) throw new Error('CBOR array too long.'); return Array.from({ length: n }, () => item(depth + 1)); }
    if (type === 5) {
      if (n > 1000) throw new Error('CBOR map too long.');
      const m = new Map();
      for (let k = 0; k < n; k++) { const key = item(depth + 1); m.set(key, item(depth + 1)); }
      return m;
    }
    if (type === 7 && [20, 21, 22].includes(head & 31)) return { 20: false, 21: true, 22: null }[head & 31];
    throw new Error('CBOR type not supported.');
  };
  const value = item(0);
  return { value, end: i };
}

// A COSE public key (from a passkey's registration) as a key Node can verify with.
export function coseToKey(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = cose.get(-2), y = cose.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('Bad P-256 key.');
    return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) } };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1), e = cose.get(-2);
    // 2048 to 4096 bits, exponent 65537.
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || n.length > 513 || b64url(e) !== 'AQAB') throw new Error('Bad RSA key.');
    return { alg, jwk: { kty: 'RSA', n: b64url(n), e: b64url(e) } };
  }
  if (kty === 1 && alg === -8 && cose.get(-1) === 6) {
    const x = cose.get(-2);
    if (!Buffer.isBuffer(x) || x.length !== 32) throw new Error('Bad Ed25519 key.');
    return { alg, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64url(x) } };
  }
  throw new Error('This passkey uses a kind of key Spark Console doesn’t accept (ES256, RS256 or Ed25519).');
}

function parseAuthData(data, withCredential) {
  if (data.length < 37) throw new Error('Authenticator data too short.');
  const out = { rpIdHash: data.subarray(0, 32), flags: data[32], signCount: data.readUInt32BE(33) };
  out.userPresent = Boolean(out.flags & 0x01);
  out.userVerified = Boolean(out.flags & 0x04);
  // "Backed up" without "can be backed up" is a malformed answer.
  if ((out.flags & 0x10) && !(out.flags & 0x08)) throw new Error('Bad authenticator flags.');
  if (withCredential) {
    if (!(out.flags & 0x40) || data.length < 55) throw new Error('No credential in the registration.');
    const idLen = data.readUInt16BE(53);
    if (idLen < 16 || idLen > 1023 || 55 + idLen > data.length) throw new Error('Bad credential id.');
    out.credentialId = data.subarray(55, 55 + idLen);
    const { value } = cbor(data.subarray(55 + idLen));
    if (!(value instanceof Map)) throw new Error('Bad credential key.');
    out.key = coseToKey(value);
  }
  return out;
}

// A passkey used from inside another page (a frame) never counts.
function checkClientData(clientDataJSON, type, challenge, origins) {
  let c;
  try { c = JSON.parse(clientDataJSON.toString('utf8')); } catch { throw new Error('Bad client data.'); }
  if (c.type !== type) throw new Error('Wrong kind of passkey request.');
  if (c.challenge !== challenge) throw new Error('This passkey answer is for another request.');
  if (!origins.includes(c.origin)) throw new Error(`Passkeys are only used on Spark Console’s own addresses (not ${String(c.origin).slice(0, 80)}).`);
  if (c.crossOrigin === true) throw new Error('Passkeys can’t be used from inside another site.');
  return c;
}
// Which relying-party id (domain) the authenticator signed for, out of the ones allowed.
const rpIdOf = (rpIdHash, rpIds) => rpIds.find(id => sha256(id).equals(rpIdHash)) || null;

// A new passkey: returns what to keep (id, public key, the domain it's for, its counter).
export function verifyRegistration({ clientDataJSON, attestationObject }, { challenge, origins, rpIds }) {
  const cd = fromB64url(clientDataJSON), ao = fromB64url(attestationObject);
  checkClientData(cd, 'webauthn.create', challenge, origins);
  const { value } = cbor(ao);
  if (!(value instanceof Map) || !Buffer.isBuffer(value.get('authData'))) throw new Error('Bad attestation.');
  const auth = parseAuthData(value.get('authData'), true);
  const rpId = rpIdOf(auth.rpIdHash, rpIds);
  if (!rpId) throw new Error('The passkey was made for another site.');
  if (!auth.userPresent || !auth.userVerified) throw new Error('The passkey has to check it’s you (fingerprint, face or PIN).');
  const pub = createPublicKey({ key: auth.key.jwk, format: 'jwk' });
  // Leading zero bytes can pad a short RSA modulus to a "long" one: check the real size.
  if (pub.asymmetricKeyType === 'rsa' && !(pub.asymmetricKeyDetails?.modulusLength >= 2048)) throw new Error('Bad RSA key.');
  return { id: b64url(auth.credentialId), alg: auth.key.alg, jwk: auth.key.jwk, rpId, signCount: auth.signCount };
}

// A passkey confirming one request: the signature over exactly that challenge, by a passkey we keep.
export function verifyAssertion({ id, clientDataJSON, authenticatorData, signature }, { challenge, origins, stored }) {
  const key = stored.find(k => k.id === id);
  if (!key) throw new Error('That passkey isn’t one of Spark Console’s.');
  const cd = fromB64url(clientDataJSON), ad = fromB64url(authenticatorData), sig = fromB64url(signature);
  checkClientData(cd, 'webauthn.get', challenge, origins);
  const auth = parseAuthData(ad, false);
  if (!sha256(key.rpId).equals(auth.rpIdHash)) throw new Error('The passkey answered for another site.');
  if (!auth.userPresent || !auth.userVerified) throw new Error('The passkey has to check it’s you (fingerprint, face or PIN).');
  const signed = Buffer.concat([ad, sha256(cd)]);
  const publicKey = createPublicKey({ key: key.jwk, format: 'jwk' });
  const ok = key.alg === -7 ? verifySignature('sha256', signed, { key: publicKey, dsaEncoding: 'der' }, sig)
    : key.alg === -257 ? verifySignature('sha256', signed, publicKey, sig)
      : verifySignature(null, signed, publicKey, sig);
  if (!ok) throw new Error('The passkey’s signature doesn’t match.');
  // Passkeys that count should count up; going backwards (or back to 0) can mean a copy. Most passkeys stay at 0.
  // It's reported, not refused, so the owner's only passkey can never lock them out.
  const counterWentBack = (key.signCount || 0) > 0 && auth.signCount <= key.signCount;
  return { id: key.id, signCount: auth.signCount, counterWentBack };
}
