import {createPrivateKey, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {
  commandClaimsOf,
  commandNames,
  defaultLifetimeSeconds,
  isServiceIssuer,
  isTransferTargetKind,
  isUploadTicket,
  isUuid,
  keySetVariable,
  loadSigner,
  maxLifetimeSeconds,
  maxRetiringWindowMs,
  maxSkewSeconds,
  maxTokenLength,
  newJti,
  parseKeySet,
  serviceIssuers,
  signCommand,
  signToken,
  signTicket,
  signingKeyVariable,
  tokenLabel,
  transferLimits,
  transferTargetKinds,
  ticketClaimsOf,
  uploadProblem,
  verifyToken,
  type CommandClaims,
  type ParsedKeySet,
  type Signer,
  type TicketClaims,
  type TokenPayload,
  type VerifyOptions,
} from '@/lib/service-signing';
import {testKeyPair, testKeys, testSigner} from '../support/service-keys';

// The key contract of Story 1.12 (lib/service-signing.ts): how a key set is read, how a private key is checked against it, what a token is, and the
// ten steps of verifying one, in order, with ONE refusal that names no reason. The gateway and the application both verify with this module, so a
// token that is refused for the wrong reason, or accepted for the wrong one, is a hole in the contract, not in a test. Every key here is derived
// from a label (tests/support/service-keys.ts): no key file, no generated state shared between processes.
const NOW = 1_800_000_000;
const ENV = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SESSION = '11111111-2222-4333-8444-555555555555';
const TARGET = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const SHA = 'ab'.repeat(32);

const keys = testKeys();
const signer = testSigner().signer;
const baseOptions = (extra: Partial<VerifyOptions> = {}): VerifyOptions => ({issuer: 'application', audience: 'gateway', environment: ENV, keySet: keys.keySet, now: NOW, ...extra});
const token = (over: Partial<Parameters<typeof signToken>[1]> = {}, using: Signer = signer) =>
  signToken(using, {audience: 'gateway', environment: ENV, type: 'ticket', claims: {extra: 1}, now: NOW, ...over});
const partsOf = (value: string) => value.split('.');
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/** A token with any header and payload, signed over the label and the two parts as written (the way this module signs), so only what a test changes is wrong. */
function forge(header: unknown, payload: unknown, using: Signer = signer, label = tokenLabel) {
  const h = typeof header === 'string' ? header : encode(header);
  const p = typeof payload === 'string' ? payload : encode(payload);
  return `${h}.${p}.${sign(null, Buffer.from(`${label}${h}.${p}`, 'utf8'), using.privateKey).toString('base64url')}`;
}
const goodHeader = () => ({v: 1, alg: 'EdDSA', kid: signer.kid});
const goodPayload = (over: Record<string, unknown> = {}) => ({iss: 'application', aud: 'gateway', env: ENV, jti: newJti(), iat: NOW, exp: NOW + 300, typ: 'ticket', ...over});

/** Another spelling of the same bytes: the last character of a base64url part changed where its unused bits allow it (null when the length leaves none). */
function otherSpelling(part: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = Buffer.from(part, 'base64url');
  for (const letter of alphabet) {
    const candidate = part.slice(0, -1) + letter;
    if (candidate !== part && Buffer.from(candidate, 'base64url').equals(bytes)) return candidate;
  }
  return null;
}

const rsaPublic = () => generateKeyPairSync('rsa', {modulusLength: 1024}).publicKey.export({type: 'spki', format: 'der'}).toString('base64');
const x25519Public = () => generateKeyPairSync('x25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64');
const x25519Private = () => generateKeyPairSync('x25519').privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64');

const setOf = (change: (set: Record<string, unknown>) => void = () => undefined, base = JSON.parse(keys.json) as Record<string, unknown>) => {
  change(base);
  return JSON.stringify(base);
};

describe('the issuers, the variables and the constants', () => {
  it('names the six issuers of the contract, and only they are issuers', () => {
    expect([...serviceIssuers]).toEqual(['application', 'gateway', 'cad-worker', 'engine-worker', 'backup-service', 'heartbeat']);
    for (const issuer of serviceIssuers) expect(isServiceIssuer(issuer)).toBe(true);
    for (const value of ['', 'Application', 'worker', 'constructor', '__proto__', undefined, null, 7, ['application']]) expect(isServiceIssuer(value), String(value)).toBe(false);
  });

  it('names the private key and the public key set of each issuer', () => {
    expect(signingKeyVariable('application')).toBe('SERVICE_SIGNING_KEY_APPLICATION');
    expect(signingKeyVariable('cad-worker')).toBe('SERVICE_SIGNING_KEY_CAD_WORKER');
    expect(signingKeyVariable('backup-service')).toBe('SERVICE_SIGNING_KEY_BACKUP_SERVICE');
    expect(keySetVariable('application')).toBe('SERVICE_KEYS_APPLICATION');
    expect(keySetVariable('engine-worker')).toBe('SERVICE_KEYS_ENGINE_WORKER');
  });

  it('holds the numbers of the contract: five minutes at most, sixty seconds of skew, a token of a few thousand characters at most', () => {
    expect([maxLifetimeSeconds, defaultLifetimeSeconds, maxSkewSeconds, maxTokenLength]).toEqual([300, 300, 60, 4096]);
    expect(tokenLabel).toBe('nova3d/service-token/v1\0');
    expect(transferLimits).toMatchObject({chunkBytes: 1048576, pictureBytes: 12582912, fileBytes: 104857600, stagingQuotaBytes: 262144000, ticketSeconds: 300, handleSeconds: 1800, leaseSeconds: 86400});
  });

  it('makes a jti of 128 random bits in base64url, different every time', () => {
    const seen = new Set(Array.from({length: 50}, () => newJti()));
    expect(seen.size).toBe(50);
    for (const jti of seen) {
      expect(jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(jti, 'base64url')).toHaveLength(16);
    }
  });

  it('imports node:crypto and nothing else, so the gateway can import it with no framework and no alias', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../lib/service-signing.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1])).toEqual(['node:crypto']);
    expect(source).not.toMatch(/process\.env|console\.|from '@\/|from 'next|\brequire\(/);
  });
});

// Story 1.12 review (P14): the finding was real. A key set could name a retiring key valid until any moment at all, so an old key stayed in force for as long as
// the set said, which is not a rotation. The documented window is six minutes (a ticket lives five, with a minute of skew); ten is the most a set may name.
describe('the rotation window of a retiring key', () => {
  const readAt = Date.parse('2026-12-01T10:00:00.000Z');
  const old = testKeyPair('application-0');
  const setWith = (until: string) =>
    setOf((set) => {
      set.retiring = {kid: old.kid, until};
      (set.keys as Record<string, string>)[old.kid] = old.publicKey;
    });
  const at = (offsetMs: number) => new Date(readAt + offsetMs).toISOString();

  it('accepts an until up to ten minutes after the time the set is read, the documented six included, and refuses anything later', () => {
    expect(maxRetiringWindowMs).toBe(10 * 60 * 1000);
    expect(parseKeySet(setWith(at(6 * 60 * 1000)), 'application', readAt).ok).toBe(true);
    expect(parseKeySet(setWith(at(10 * 60 * 1000)), 'application', readAt).ok, 'exactly ten minutes').toBe(true);
    for (const offset of [10 * 60 * 1000 + 1, 11 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000, 365 * 24 * 60 * 60 * 1000]) {
      const parsed = parseKeySet(setWith(at(offset)), 'application', readAt);
      expect(parsed.ok, String(offset)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toBe('the retiring key\'s until is more than ten minutes ahead (a rotation needs six)');
    }
  });

  it('keeps a past until valid: the key is simply no longer accepted (the verifier refuses it), and the set is still a set', () => {
    for (const offset of [0, -1, -60 * 1000, -365 * 24 * 60 * 60 * 1000]) {
      const parsed = parseKeySet(setWith(at(offset)), 'application', readAt);
      expect(parsed.ok, String(offset)).toBe(true);
      if (parsed.ok) expect(parsed.keySet.retiring?.untilMs).toBe(readAt + offset);
    }
  });

  it('reads the clock when none is given, and takes no clock for a set with no retiring key', () => {
    const now = Date.now();
    expect(parseKeySet(setWith(new Date(now + 5 * 60 * 1000).toISOString()), 'application').ok).toBe(true);
    expect(parseKeySet(setWith(new Date(now + 60 * 60 * 1000).toISOString()), 'application').ok).toBe(false);
    expect(parseKeySet(keys.json, 'application', 0).ok).toBe(true);
  });

  it('names a structural problem before the window, so a set wrong in two ways says the first', () => {
    const wrong = setOf((set) => {
      set.retiring = {kid: old.kid, until: at(24 * 60 * 60 * 1000)};
    });
    expect(parseKeySet(wrong, 'application', readAt)).toMatchObject({ok: false, problem: 'a named key ID has no public key in keys'});
  });

  it('prints no key, key ID or time in the problem', () => {
    const parsed = parseKeySet(setWith(at(60 * 60 * 1000)), 'application', readAt);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      for (const text of [old.publicKey, old.kid, keys.active.kid, '2026']) expect(parsed.problem).not.toContain(text);
    }
  });
});

describe('parseKeySet', () => {
  it('reads a key set of one active key', () => {
    const parsed = parseKeySet(keys.json, 'application');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.keySet).toMatchObject({issuer: 'application', active: keys.active.kid, retiring: null});
    expect([...parsed.keySet.publicKeys.keys()]).toEqual([keys.active.kid]);
    expect(parsed.keySet.publicKeys.get(keys.active.kid)?.asymmetricKeyType).toBe('ed25519');
  });

  it('reads a key set with its one retiring key, and its until as a time', () => {
    const until = new Date('2026-12-01T10:20:30.000Z');
    const withRetiring = testKeys({retiring: {label: 'application-0', until}});
    // (Read six minutes before its until: the rotation window of the contract. Further ahead than ten minutes is refused, below.)
    const parsed = parseKeySet(withRetiring.json, undefined, until.getTime() - 6 * 60 * 1000);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.keySet.retiring).toEqual({kid: 'test-application-0', untilMs: until.getTime()});
    expect([...parsed.keySet.publicKeys.keys()].sort()).toEqual(['test-application-0', 'test-application-1']);
  });

  it('accepts an until with or without milliseconds, and nothing that is not an ISO 8601 UTC time', () => {
    const base = (until: unknown) => setOf((set) => {
      const old = testKeyPair('application-0');
      set.retiring = {kid: old.kid, until};
      (set.keys as Record<string, string>)[old.kid] = old.publicKey;
    });
    const readAt = Date.parse('2026-12-01T10:15:00Z');
    expect(parseKeySet(base('2026-12-01T10:20:30Z'), undefined, readAt).ok).toBe(true);
    expect(parseKeySet(base('2026-12-01T10:20:30.5Z'), undefined, readAt).ok).toBe(true);
    for (const until of ['2026-12-01', '2026-12-01T10:20:30+01:00', '2026-12-01 10:20:30Z', 'tomorrow', '', 1_800_000_000, null, undefined, '2026-13-45T10:20:30Z']) {
      const parsed = parseKeySet(base(until));
      expect(parsed.ok, String(until)).toBe(false);
    }
  });

  it('refuses a set that is not set, not JSON, or too long', () => {
    for (const value of [undefined, null, '', '   ', 5, {}]) expect(parseKeySet(value), String(value)).toEqual({ok: false, problem: 'the key set is not set'});
    expect(parseKeySet('{not json')).toEqual({ok: false, problem: 'the key set is not JSON'});
    expect(parseKeySet(`{"pad":"${'x'.repeat(9000)}"}`)).toEqual({ok: false, problem: 'the key set is too long'});
  });

  it('refuses a set that is not exactly {issuer, active, retiring, keys}', () => {
    for (const text of ['[]', 'null', '"x"', '5']) expect(parseKeySet(text), text).toMatchObject({ok: false, problem: expect.stringContaining('exactly')});
    for (const drop of ['issuer', 'active', 'retiring', 'keys']) {
      expect(parseKeySet(setOf((set) => delete set[drop])), `without ${drop}`).toMatchObject({ok: false, problem: expect.stringContaining('exactly')});
    }
    expect(parseKeySet(setOf((set) => (set.extra = 1)))).toMatchObject({ok: false, problem: expect.stringContaining('exactly')});
  });

  it('refuses an issuer that does not exist, and a set for another issuer than the one expected', () => {
    expect(parseKeySet(setOf((set) => (set.issuer = 'root')))).toMatchObject({ok: false, problem: expect.stringContaining('issuer that does not exist')});
    expect(parseKeySet(setOf((set) => (set.issuer = 7)))).toMatchObject({ok: false});
    expect(parseKeySet(keys.json, 'gateway')).toMatchObject({ok: false, problem: expect.stringContaining('another issuer than gateway')});
    expect(parseKeySet(testKeys({issuer: 'cad-worker'}).json, 'cad-worker').ok).toBe(true);
    // Without an expected issuer, any real issuer's set is a set.
    expect(parseKeySet(testKeys({issuer: 'heartbeat'}).json).ok).toBe(true);
  });

  it('refuses a key ID that is not one', () => {
    const rename = (kid: unknown) => setOf((set) => {
      const keyMap = set.keys as Record<string, string>;
      const [old] = Object.keys(keyMap);
      set.active = kid;
      if (typeof kid === 'string') {
        keyMap[kid] = keyMap[old];
        delete keyMap[old];
      }
    });
    for (const kid of ['', ' ', '-leading', '.dot', 'has space', 'slash/slash', 'x'.repeat(65), 'tab\t', 7, null]) {
      expect(parseKeySet(rename(kid)), String(kid)).toMatchObject({ok: false, problem: 'the active key ID is not a key ID'});
    }
    expect(parseKeySet(rename('K-1.a_b')).ok).toBe(true);
    expect(parseKeySet(rename('x'.repeat(64))).ok).toBe(true);
  });

  const withRetiring = (retiring: unknown, extraKeys: Record<string, string> = {}) =>
    setOf((set) => {
      set.retiring = retiring;
      Object.assign(set.keys as Record<string, string>, extraKeys);
    });
  const old = testKeyPair('application-0');
  const until = '2026-12-01T10:20:30.000Z';

  it('refuses a retiring key that is not exactly {kid, until}, is the active key, or has a bad kid', () => {
    expect(parseKeySet(withRetiring({kid: old.kid}, {[old.kid]: old.publicKey}))).toMatchObject({ok: false, problem: 'the retiring key must be exactly {kid, until}'});
    expect(parseKeySet(withRetiring({until}, {[old.kid]: old.publicKey}))).toMatchObject({ok: false, problem: 'the retiring key must be exactly {kid, until}'});
    expect(parseKeySet(withRetiring({kid: old.kid, until, why: 'x'}, {[old.kid]: old.publicKey}))).toMatchObject({ok: false, problem: 'the retiring key must be exactly {kid, until}'});
    expect(parseKeySet(withRetiring([old.kid, until], {[old.kid]: old.publicKey}))).toMatchObject({ok: false});
    expect(parseKeySet(withRetiring('x'))).toMatchObject({ok: false});
    expect(parseKeySet(withRetiring({kid: keys.active.kid, until}))).toMatchObject({ok: false, problem: 'the retiring key is the active key'});
    expect(parseKeySet(withRetiring({kid: '-bad', until}, {'-bad': old.publicKey}))).toMatchObject({ok: false, problem: 'the retiring key ID is not a key ID'});
    expect(parseKeySet(withRetiring({kid: 5, until}))).toMatchObject({ok: false, problem: 'the retiring key ID is not a key ID'});
  });

  it('refuses a named key ID with no public key, and a public key under an ID that is neither named', () => {
    expect(parseKeySet(withRetiring({kid: old.kid, until}))).toMatchObject({ok: false, problem: 'a named key ID has no public key in keys'});
    expect(parseKeySet(setOf((set) => (set.keys = {})))).toMatchObject({ok: false, problem: 'a named key ID has no public key in keys'});
    // An unnamed extra key ID: there is one active key and at most one retiring key, nothing else.
    expect(parseKeySet(withRetiring(null, {[old.kid]: old.publicKey}))).toMatchObject({ok: false, problem: 'keys holds a key ID that is neither the active nor the retiring key'});
    expect(parseKeySet(withRetiring({kid: old.kid, until}, {[old.kid]: old.publicKey, 'test-third': testKeyPair('third').publicKey}))).toMatchObject({ok: false, problem: 'keys holds a key ID that is neither the active nor the retiring key'});
    expect(parseKeySet(setOf((set) => (set.keys = [])))).toMatchObject({ok: false, problem: 'keys must be an object of key ID to public key'});
    // A key ID that every object has is not a key ID of this set.
    expect(parseKeySet(setOf((set) => { set.active = 'constructor'; set.keys = {}; }))).toMatchObject({ok: false});
  });

  it('refuses a public key that is not a base64 SPKI Ed25519 public key, and prints no key text', () => {
    const real = keys.active.publicKey;
    const garbage = ['', 'not base64!', 'AAAA', Buffer.from('definitely not a key').toString('base64'), real.slice(0, -4), `${real}A`, real.replace(/=+$/, ''), rsaPublic(), x25519Public(), keys.active.privateKey, 5, null];
    for (const value of garbage) {
      const text = setOf((set) => ((set.keys as Record<string, unknown>)[keys.active.kid] = value));
      const parsed = parseKeySet(text);
      expect(parsed.ok, String(value).slice(0, 30)).toBe(false);
      if (!parsed.ok) {
        expect(parsed.problem).toBe('a public key is not a base64 SPKI Ed25519 public key');
        if (typeof value === 'string' && value.length > 8) expect(parsed.problem).not.toContain(value.slice(0, 8));
      }
    }
  });

  it('never puts a key, a key ID or the set in a problem it reports', () => {
    const attempts = [
      setOf((set) => ((set.keys as Record<string, unknown>)[keys.active.kid] = rsaPublic())),
      setOf((set) => (set.issuer = 'root')),
      setOf((set) => (set.retiring = {kid: keys.active.kid, until})),
      setOf((set) => (set.extra = keys.active.publicKey)),
    ];
    for (const text of attempts) {
      const parsed = parseKeySet(text, 'application');
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.problem).not.toContain(keys.active.publicKey);
        expect(parsed.problem).not.toContain(keys.active.kid);
      }
    }
  });
});

describe('loadSigner', () => {
  const set = (): ParsedKeySet => keys.keySet;

  it('loads the private half of the ACTIVE key, and signs as the key set\'s issuer under its key ID', () => {
    const loaded = loadSigner(keys.privateKey, set());
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.signer).toMatchObject({issuer: 'application', kid: keys.active.kid});
    // Whitespace around an environment value is not part of the key.
    expect(loadSigner(`  ${keys.privateKey}\n`, set()).ok).toBe(true);
  });

  it('refuses a key that is not set, or not base64', () => {
    for (const value of [undefined, null, '', '   ', 5, {}, 'not base64!', '%%%%']) {
      expect(loadSigner(value, set()), String(value)).toEqual({ok: false, problem: 'the private key is not set or is not base64'});
    }
  });

  it('refuses base64 that is not a PKCS#8 key', () => {
    expect(loadSigner(randomBytes(48).toString('base64'), set())).toEqual({ok: false, problem: 'the private key is not a PKCS#8 key'});
    // The public key is not a private key.
    expect(loadSigner(keys.active.publicKey, set())).toEqual({ok: false, problem: 'the private key is not a PKCS#8 key'});
  });

  it('refuses a private key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', {modulusLength: 1024}).privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64');
    for (const value of [rsa, x25519Private()]) expect(loadSigner(value, set())).toEqual({ok: false, problem: 'the private key is not an Ed25519 key'});
  });

  it('refuses a key that is not the private half of the active public key, and prints none', () => {
    const other = testKeyPair('someone-else');
    const refused = loadSigner(other.privateKey, set());
    expect(refused).toEqual({ok: false, problem: 'the private key is not the private half of the active public key'});
    expect(JSON.stringify(refused)).not.toContain(other.privateKey);
  });

  it('refuses the RETIRING key\'s private half: only the active key signs', () => {
    const rotating = testKeys({retiring: {label: 'application-0', until: new Date('2026-12-01T00:00:00Z')}});
    const retired = testKeyPair('application-0');
    expect(loadSigner(retired.privateKey, rotating.keySet)).toEqual({ok: false, problem: 'the private key is not the private half of the active public key'});
    expect(loadSigner(rotating.privateKey, rotating.keySet).ok).toBe(true);
  });
});

describe('signToken', () => {
  const input = {audience: 'gateway' as const, environment: ENV, type: 'ticket', claims: {extra: 1}, now: NOW};

  it('signs a token whose header and payload are exactly what the contract says, in that order', () => {
    const value = signToken(signer, {...input, jti: 'A'.repeat(22)});
    const [header, payload, signature] = partsOf(value);
    expect(decode(header)).toEqual({v: 1, alg: 'EdDSA', kid: signer.kid});
    expect(Object.keys(decode(header))).toEqual(['v', 'alg', 'kid']);
    expect(Object.keys(decode(payload))).toEqual(['iss', 'aud', 'env', 'jti', 'iat', 'exp', 'typ', 'extra']);
    expect(decode(payload)).toEqual({iss: 'application', aud: 'gateway', env: ENV, jti: 'A'.repeat(22), iat: NOW, exp: NOW + 300, typ: 'ticket', extra: 1});
    expect(Buffer.from(signature, 'base64url')).toHaveLength(64);
    expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('lives five minutes unless asked for less, and not more than five', () => {
    expect(decode(partsOf(signToken(signer, input))[1]).exp).toBe(NOW + 300);
    expect(decode(partsOf(signToken(signer, {...input, lifetimeSeconds: 1}))[1]).exp).toBe(NOW + 1);
    expect(decode(partsOf(signToken(signer, {...input, lifetimeSeconds: 300}))[1]).exp).toBe(NOW + 300);
    for (const lifetimeSeconds of [0, -1, 301, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => signToken(signer, {...input, lifetimeSeconds}), String(lifetimeSeconds)).toThrow(TypeError);
    }
  });

  it('refuses a claim that is named like a standard claim, so a payload can never have two meanings', () => {
    for (const name of ['iss', 'aud', 'env', 'jti', 'iat', 'exp', 'typ']) expect(() => signToken(signer, {...input, claims: {[name]: 'x'}}), name).toThrow(TypeError);
  });

  it('holds a claim to a string, a boolean or a whole number', () => {
    expect(() => signToken(signer, {...input, claims: {a: 'x', b: true, c: 3}})).not.toThrow();
    for (const bad of [1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, null, undefined, {}, [], BigInt(1)]) {
      expect(() => signToken(signer, {...input, claims: {a: bad as never}}), String(bad)).toThrow(TypeError);
    }
  });

  it('refuses an audience that is not a service, a type that is not a lower-case word, an environment that is not an ID, and a jti that is not 128 bits', () => {
    expect(() => signToken(signer, {...input, audience: 'browser' as never})).toThrow(TypeError);
    for (const type of ['', 'Ticket', '1ticket', 'tick et', 'x'.repeat(33)]) expect(() => signToken(signer, {...input, type}), type).toThrow(TypeError);
    for (const environment of ['', 'x'.repeat(65)]) expect(() => signToken(signer, {...input, environment}), environment).toThrow(TypeError);
    for (const jti of ['', 'short', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}+`]) expect(() => signToken(signer, {...input, jti}), jti).toThrow(TypeError);
    expect(() => signToken(signer, {...input, now: -1})).toThrow(TypeError);
  });

  it('is deterministic for a given jti and time: Ed25519 signs the same bytes the same way', () => {
    const jti = newJti();
    expect(signToken(signer, {...input, jti})).toBe(signToken(signer, {...input, jti}));
    expect(signToken(signer, input)).not.toBe(signToken(signer, input));
  });
});

describe('verifyToken: a token that is right', () => {
  it('is accepted, with the key ID and the payload it carries', async () => {
    const value = token({claims: {extra: 7}});
    const verified = await verifyToken(value, baseOptions({type: 'ticket'}));
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.kid).toBe(signer.kid);
      expect(verified.payload).toMatchObject({iss: 'application', aud: 'gateway', env: ENV, iat: NOW, exp: NOW + 300, typ: 'ticket', extra: 7});
    }
  });

  it('is accepted when the environment differs only in case, and with no type asked for', async () => {
    expect((await verifyToken(token({environment: ENV.toUpperCase()}), baseOptions())).ok).toBe(true);
    expect((await verifyToken(token(), baseOptions({environment: ENV.toUpperCase()}))).ok).toBe(true);
  });
});

describe('verifyToken: step 1, the size', () => {
  it('refuses what is not a string, an empty string, and a string over the cap, and accepts one at the cap\'s edge only if it is a token', async () => {
    for (const value of [undefined, null, 5, {}, [], true, '']) expect(await verifyToken(value, baseOptions()), String(value)).toEqual({ok: false});
    expect(await verifyToken('a'.repeat(maxTokenLength + 1), baseOptions())).toEqual({ok: false});
    // A real token padded with a claim past the cap is refused for its size and nothing else: the same token under the cap verifies.
    const small = token({claims: {pad: 'x'.repeat(100)}});
    expect(small.length).toBeLessThan(maxTokenLength);
    expect((await verifyToken(small, baseOptions())).ok).toBe(true);
    const big = token({claims: {pad: 'x'.repeat(maxTokenLength)}});
    expect(big.length).toBeGreaterThan(maxTokenLength);
    expect(await verifyToken(big, baseOptions())).toEqual({ok: false});
  });
});

describe('verifyToken: step 2, the shape', () => {
  const good = () => token();
  const refuses = async (value: unknown) => expect(await verifyToken(value, baseOptions())).toEqual({ok: false});

  it('refuses a token that is not three base64url parts', async () => {
    const [h, p, s] = partsOf(good());
    for (const value of [`${h}.${p}`, `${h}.${p}.${s}.${s}`, `${h}..${s}`, `.${p}.${s}`, `${h}.${p}.`, `${h}.${p}.${s}=`, `${h}.${p}.${s}+`, `${h} .${p}.${s}`, `${h}.${p}.${s}\n`, `Bearer ${good()}`, 'a.b.c', '...']) {
      await refuses(value);
    }
  });

  it('refuses a header that is not exactly {v: 1, alg: "EdDSA", kid}', async () => {
    for (const header of [
      {...goodHeader(), extra: 'x'},
      {v: 1, alg: 'EdDSA'},
      {alg: 'EdDSA', kid: signer.kid},
      {v: 2, alg: 'EdDSA', kid: signer.kid},
      {v: '1', alg: 'EdDSA', kid: signer.kid},
      {...goodHeader(), alg: 'none'},
      {...goodHeader(), alg: 'HS256'},
      {...goodHeader(), alg: 'eddsa'},
      {...goodHeader(), kid: 5},
      {...goodHeader(), kid: ''},
      {...goodHeader(), kid: '-bad'},
      {...goodHeader(), kid: 'x'.repeat(65)},
      [goodHeader()],
      'a string',
      null,
    ]) {
      await refuses(forge(header, goodPayload()));
    }
    await refuses(forge('bm90IGpzb24', goodPayload()));
  });

  it('refuses a payload that is not an object of the standard claims of the right types', async () => {
    for (const payload of [
      [goodPayload()],
      'text',
      null,
      goodPayload({iss: 5}),
      goodPayload({aud: undefined}),
      goodPayload({env: 5}),
      goodPayload({typ: 5}),
      goodPayload({jti: undefined}),
      goodPayload({jti: 'short'}),
      goodPayload({jti: `${'A'.repeat(21)}+`}),
      goodPayload({iat: NOW + 0.5}),
      goodPayload({iat: String(NOW)}),
      goodPayload({exp: NOW + 300.5}),
      goodPayload({exp: Number.MAX_SAFE_INTEGER + 2}),
      goodPayload({exp: undefined}),
    ]) {
      await refuses(forge(goodHeader(), payload));
    }
    await refuses(forge(goodHeader(), 'bm90IGpzb24'));
    // The control: the same forge with the right claims is accepted, so each refusal above was for the one thing it changed.
    expect((await verifyToken(forge(goodHeader(), goodPayload()), baseOptions())).ok).toBe(true);
  });

  it('refuses a signature that is not 64 bytes, and any part that is not the one spelling of its bytes', async () => {
    const [h, p, s] = partsOf(good());
    await refuses(`${h}.${p}.${s.slice(0, -4)}`);
    await refuses(`${h}.${p}.${s}AAAA`);
    // 64 bytes leave unused bits in the last character: another spelling of the same signature is not this module's output, and is refused.
    const spelled = otherSpelling(s);
    expect(spelled).not.toBeNull();
    expect(Buffer.from(spelled!, 'base64url').equals(Buffer.from(s, 'base64url'))).toBe(true);
    await refuses(`${h}.${p}.${spelled}`);
    expect((await verifyToken(`${h}.${p}.${s}`, baseOptions())).ok).toBe(true);
  });

  it('refuses a header or a payload spelled another way, though it says the same thing and is signed as written', async () => {
    // Choose a key ID whose header is not a whole number of base64 groups, so another spelling of it exists.
    const kid = ['k', 'kk', 'kkk'].find((candidate) => Buffer.from(JSON.stringify({v: 1, alg: 'EdDSA', kid: candidate})).length % 3 !== 0)!;
    const pair = testKeyPair('spelling', kid);
    const set = parseKeySet(JSON.stringify({issuer: 'application', active: kid, retiring: null, keys: {[kid]: pair.publicKey}}), 'application');
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const loaded = loadSigner(pair.privateKey, set.keySet);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const options = baseOptions({keySet: set.keySet});
    const header = encode({v: 1, alg: 'EdDSA', kid});
    const payloadValue = (pad: number) => goodPayload({pad: 'p'.repeat(pad)});
    const pad = [1, 2, 3].find((n) => Buffer.from(JSON.stringify(payloadValue(n))).length % 3 !== 0)!;
    const payload = encode(payloadValue(pad));
    expect((await verifyToken(forge(header, payload, loaded.signer), options)).ok).toBe(true);
    const otherHeader = otherSpelling(header);
    const otherPayload = otherSpelling(payload);
    expect(otherHeader).not.toBeNull();
    expect(otherPayload).not.toBeNull();
    expect(await verifyToken(forge(otherHeader!, payload, loaded.signer), options)).toEqual({ok: false});
    expect(await verifyToken(forge(header, otherPayload!, loaded.signer), options)).toEqual({ok: false});
  });
});

describe('verifyToken: steps 3 and 4, the issuer, the audience and the environment', () => {
  it('refuses another issuer, another audience, and a key set of another issuer', async () => {
    expect(await verifyToken(forge(goodHeader(), goodPayload({iss: 'gateway'})), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(token({audience: 'cad-worker'}), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(token(), baseOptions({audience: 'engine-worker'}))).toEqual({ok: false});
    expect(await verifyToken(token(), baseOptions({issuer: 'gateway'}))).toEqual({ok: false});
    // The receiver's key set is for the issuer it expects: a set of another issuer verifies nothing, even a token that names that issuer.
    const gatewaySet = testKeys({issuer: 'gateway', active: 'gateway-1'});
    expect(await verifyToken(token(), baseOptions({issuer: 'application', keySet: gatewaySet.keySet}))).toEqual({ok: false});
  });

  it('refuses another environment, so one environment\'s ticket is nothing in another', async () => {
    expect(await verifyToken(token({environment: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'}), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(token(), baseOptions({environment: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'}))).toEqual({ok: false});
    expect(await verifyToken(token({environment: ''.padEnd(1, 'x')}), baseOptions())).toEqual({ok: false});
  });
});

describe('verifyToken: step 5, the key', () => {
  const until = new Date((NOW + 1000) * 1000);
  const rotating = testKeys({retiring: {label: 'application-0', until}});
  const retiringSigner = testSigner({active: 'application-0'}).signer;
  const rotatingOptions = (now: number, extra: Partial<VerifyOptions> = {}) => baseOptions({keySet: rotating.keySet, now, ...extra});

  it('refuses a key ID the set does not name', async () => {
    const stranger = testSigner({active: 'stranger'}).signer;
    expect(await verifyToken(token({}, stranger), baseOptions())).toEqual({ok: false});
  });

  it('accepts the retiring key before its until, and refuses it at its until and after', async () => {
    const at = (now: number) => token({now}, retiringSigner);
    expect((await verifyToken(at(NOW), rotatingOptions(NOW))).ok).toBe(true);
    expect((await verifyToken(at(NOW + 999), rotatingOptions(NOW + 999))).ok).toBe(true);
    // The moment of `until` itself is already past it ("before its until").
    expect(await verifyToken(at(NOW + 1000), rotatingOptions(NOW + 1000))).toEqual({ok: false});
    expect(await verifyToken(at(NOW + 999), rotatingOptions(NOW + 1000.5))).toEqual({ok: false});
    expect(await verifyToken(at(NOW + 999), rotatingOptions(NOW + 5000))).toEqual({ok: false});
  });

  it('keeps accepting the active key while the retiring one is still accepted, and after', async () => {
    expect((await verifyToken(token(), rotatingOptions(NOW))).ok).toBe(true);
    expect((await verifyToken(token({now: NOW + 2000}), rotatingOptions(NOW + 2000))).ok).toBe(true);
  });

  it('refuses the retiring key\'s signature in a set that no longer names it (it was removed once the window ended)', async () => {
    expect(await verifyToken(token({}, retiringSigner), baseOptions())).toEqual({ok: false});
  });

  it('refuses a signature made by another key under the ACTIVE key ID: the ID names a key, it does not make one', async () => {
    const impostor = {issuer: 'application' as const, kid: signer.kid, privateKey: createPrivateKey({key: Buffer.from(testKeyPair('impostor').privateKey, 'base64'), format: 'der', type: 'pkcs8'})};
    expect(await verifyToken(token({}, impostor), baseOptions())).toEqual({ok: false});
  });
});

describe('verifyToken: step 6, revocation', () => {
  it('refuses a key that is revoked, asking about this issuer and this key ID, and accepts it when it is not (sync or async)', async () => {
    const isRevoked = vi.fn(() => true);
    expect(await verifyToken(token(), baseOptions({isRevoked}))).toEqual({ok: false});
    expect(isRevoked).toHaveBeenCalledWith('application', signer.kid);
    expect(await verifyToken(token(), baseOptions({isRevoked: async () => true}))).toEqual({ok: false});
    expect((await verifyToken(token(), baseOptions({isRevoked: async () => false}))).ok).toBe(true);
    expect((await verifyToken(token(), baseOptions({isRevoked: () => false}))).ok).toBe(true);
  });

  it('is asked BEFORE the signature: a token with a bad signature under a key that is revoked is refused by the revocation, and one the database cannot answer about is an error even then', async () => {
    const [h, p, s] = partsOf(token());
    // A flipped bit, not a respelling: the signature is well formed, so only the signature check (after the revocation question) can refuse it.
    const flipped = Buffer.from(s, 'base64url');
    flipped[10] ^= 1;
    const tampered = `${h}.${p}.${flipped.toString('base64url')}`;
    const isRevoked = vi.fn(() => false);
    expect(await verifyToken(tampered, baseOptions({isRevoked}))).toEqual({ok: false});
    expect(isRevoked).toHaveBeenCalledTimes(1);
    await expect(verifyToken(tampered, baseOptions({isRevoked: () => { throw new Error('database down'); }}))).rejects.toThrow('database down');
  });

  it('is asked BEFORE the lifetime checks: an expired token still reaches the revocation question', async () => {
    const isRevoked = vi.fn(() => false);
    const expired = token({now: NOW - 1000});
    expect(await verifyToken(expired, baseOptions({isRevoked}))).toEqual({ok: false});
    expect(isRevoked).toHaveBeenCalledTimes(1);
  });

  it('is not asked about a token that failed an earlier step: size, shape, issuer, audience, environment, key', async () => {
    const isRevoked = vi.fn(() => false);
    const stranger = testSigner({active: 'stranger'}).signer;
    for (const value of [
      'a'.repeat(maxTokenLength + 1),
      'a.b',
      forge({...goodHeader(), alg: 'none'}, goodPayload()),
      forge(goodHeader(), goodPayload({iss: 'gateway'})),
      token({audience: 'cad-worker'}),
      token({environment: 'another-environment'}),
      token({}, stranger),
    ]) {
      expect(await verifyToken(value, baseOptions({isRevoked}))).toEqual({ok: false});
    }
    expect(isRevoked).not.toHaveBeenCalled();
  });

  it('propagates an error from the revocation question: "the database did not answer" is not a verdict on the token', async () => {
    const failure = new Error('connection refused');
    await expect(verifyToken(token(), baseOptions({isRevoked: () => { throw failure; }}))).rejects.toBe(failure);
    await expect(verifyToken(token(), baseOptions({isRevoked: async () => { throw failure; }}))).rejects.toBe(failure);
  });
});

describe('verifyToken: step 7, the signature', () => {
  it('refuses a payload or a header that was changed after signing, and a signature that is another token\'s', async () => {
    const [h, p, s] = partsOf(token({claims: {extra: 1}}));
    const edited = encode({...decode(p), extra: 2});
    expect(await verifyToken(`${h}.${edited}.${s}`, baseOptions())).toEqual({ok: false});
    const [h2, p2, s2] = partsOf(token({claims: {extra: 1}}));
    expect(await verifyToken(`${h}.${p}.${s2}`, baseOptions())).toEqual({ok: false});
    expect(await verifyToken(`${h2}.${p2}.${s}`, baseOptions())).toEqual({ok: false});
    // An extra claim added to a signed payload (a claim the signer never made) breaks it too.
    expect(await verifyToken(`${h}.${encode({...decode(p), admin: true})}.${s}`, baseOptions())).toEqual({ok: false});
  });

  it('refuses a flipped bit of the signature', async () => {
    const [h, p, s] = partsOf(token());
    const bytes = Buffer.from(s, 'base64url');
    bytes[10] ^= 1;
    expect(await verifyToken(`${h}.${p}.${bytes.toString('base64url')}`, baseOptions())).toEqual({ok: false});
  });

  it('refuses a signature that does not cover the label: it was not made for this purpose', async () => {
    const h = encode(goodHeader());
    const p = encode(goodPayload());
    const bare = `${h}.${p}.${sign(null, Buffer.from(`${h}.${p}`, 'utf8'), signer.privateKey).toString('base64url')}`;
    expect(await verifyToken(bare, baseOptions())).toEqual({ok: false});
    expect(await verifyToken(forge(h, p, signer, 'nova3d/service-token/v2\0'), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(forge(h, p, signer, 'nova3d/service-token/v1'), baseOptions())).toEqual({ok: false});
    expect((await verifyToken(forge(h, p), baseOptions())).ok).toBe(true);
  });
});

describe('verifyToken: steps 8, 9 and 10, the times', () => {
  const at = (iat: number, exp: number) => forge(goodHeader(), goodPayload({iat, exp}));

  it('refuses a lifetime over 300 seconds, and one that is not positive', async () => {
    expect((await verifyToken(at(NOW, NOW + 300), baseOptions())).ok).toBe(true);
    expect((await verifyToken(at(NOW, NOW + 1), baseOptions())).ok).toBe(true);
    expect(await verifyToken(at(NOW, NOW + 301), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(at(NOW, NOW + 3600), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(at(NOW, NOW), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(at(NOW, NOW - 1), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(at(NOW - 400, NOW - 100), baseOptions())).toEqual({ok: false});
  });

  it('refuses an iat more than 60 seconds ahead, and accepts exactly 60', async () => {
    expect((await verifyToken(at(NOW + 60, NOW + 360), baseOptions())).ok).toBe(true);
    expect(await verifyToken(at(NOW + 61, NOW + 361), baseOptions())).toEqual({ok: false});
    expect(await verifyToken(at(NOW + 61, NOW + 62), baseOptions())).toEqual({ok: false});
    // A fractional now counts: the edge is exactly 60 seconds ahead of the receiver's clock, whatever the fraction.
    expect((await verifyToken(at(NOW + 60, NOW + 360), baseOptions({now: NOW + 0.4}))).ok).toBe(true);
    expect((await verifyToken(at(NOW + 60, NOW + 360), baseOptions({now: NOW - 0.4}))).ok).toBe(false);
  });

  it('refuses a token once now is after its exp, and accepts it exactly at its exp', async () => {
    const value = at(NOW, NOW + 300);
    expect((await verifyToken(value, baseOptions({now: NOW + 300}))).ok).toBe(true);
    expect(await verifyToken(value, baseOptions({now: NOW + 300.001}))).toEqual({ok: false});
    expect(await verifyToken(value, baseOptions({now: NOW + 301}))).toEqual({ok: false});
    expect((await verifyToken(value, baseOptions({now: NOW - 30}))).ok).toBe(true);
  });

  it('refuses a token of another type, and accepts any type when none is asked for', async () => {
    expect((await verifyToken(token({type: 'command'}), baseOptions({type: 'command'}))).ok).toBe(true);
    expect(await verifyToken(token({type: 'command'}), baseOptions({type: 'ticket'}))).toEqual({ok: false});
    expect(await verifyToken(token({type: 'ticket'}), baseOptions({type: 'command'}))).toEqual({ok: false});
    expect((await verifyToken(token({type: 'command'}), baseOptions())).ok).toBe(true);
  });
});

describe('verifyToken: the one refusal', () => {
  it('is the same value, with nothing in it, for every way a token can be wrong', async () => {
    const wrong = [
      undefined,
      'x',
      forge({...goodHeader(), alg: 'none'}, goodPayload()),
      forge(goodHeader(), goodPayload({iss: 'gateway'})),
      token({audience: 'cad-worker'}),
      token({environment: 'another'}),
      token({}, testSigner({active: 'stranger'}).signer),
      forge(goodHeader(), goodPayload({exp: NOW + 301})),
      forge(goodHeader(), goodPayload({iat: NOW + 100, exp: NOW + 200})),
      token({now: NOW - 1000}),
      token({type: 'command'}),
    ];
    const answers = await Promise.all(wrong.map((value) => verifyToken(value, baseOptions({type: 'ticket'}))));
    for (const answer of answers) {
      expect(answer).toEqual({ok: false});
      expect(Object.keys(answer)).toEqual(['ok']);
    }
    // One object: not even a different instance carries a different story.
    expect(new Set(answers).size).toBe(1);
  });
});

describe('ticketClaimsOf', () => {
  const base = (over: Record<string, unknown> = {}): TokenPayload =>
    ({iss: 'application', aud: 'gateway', env: ENV, jti: newJti(), iat: NOW, exp: NOW + 300, typ: 'ticket', acct: ACCOUNT, sid: SESSION, epoch: 3, dir: 'download', tk: 'staging', tid: TARGET, ...over}) as TokenPayload;
  const upload = (over: Record<string, unknown> = {}) => base({dir: 'upload', cls: 'picture', len: 1024, sha: SHA, ct: 'image/png', ...over});

  it('reads a download ticket and an upload ticket, with exactly their claims', () => {
    expect(ticketClaimsOf(base())).toEqual({acct: ACCOUNT, sid: SESSION, epoch: 3, dir: 'download', tk: 'staging', tid: TARGET});
    expect(ticketClaimsOf(upload())).toEqual({acct: ACCOUNT, sid: SESSION, epoch: 3, dir: 'upload', tk: 'staging', tid: TARGET, cls: 'picture', len: 1024, sha: SHA, ct: 'image/png'});
    expect(isUploadTicket(ticketClaimsOf(upload()) as TicketClaims)).toBe(true);
    expect(isUploadTicket(ticketClaimsOf(base()) as TicketClaims)).toBe(false);
  });

  it('refuses a payload that is not for the application\'s tickets to the gateway', () => {
    for (const over of [{typ: 'command'}, {typ: 'Ticket'}, {iss: 'gateway'}, {iss: 'cad-worker'}, {aud: 'cad-worker'}, {aud: 'application'}]) {
      expect(ticketClaimsOf(base(over)), JSON.stringify(over)).toBeNull();
    }
  });

  it('refuses an unknown claim, however harmless it looks, and a missing one', () => {
    for (const extra of [{url: 'https://x.example/'}, {credential: 'x'}, {admin: true}, {note: ''}, {cls: 'picture'}]) expect(ticketClaimsOf(base(extra)), JSON.stringify(extra)).toBeNull();
    for (const name of ['acct', 'sid', 'epoch', 'dir', 'tk', 'tid']) {
      const payload = base();
      delete payload[name];
      expect(ticketClaimsOf(payload), name).toBeNull();
    }
    for (const name of ['cls', 'len', 'sha', 'ct']) {
      const payload = upload();
      delete payload[name];
      expect(ticketClaimsOf(payload), name).toBeNull();
    }
  });

  it('refuses upload claims on a download and a download without them on an upload', () => {
    expect(ticketClaimsOf(base({cls: 'picture', len: 1, sha: SHA, ct: 'image/png'}))).toBeNull();
    expect(ticketClaimsOf(base({dir: 'upload'}))).toBeNull();
    expect(ticketClaimsOf(base({dir: 'sideways'}))).toBeNull();
    expect(ticketClaimsOf(base({dir: undefined}))).toBeNull();
  });

  it('refuses an ID that is not a lower-case UUID, and an epoch that is not a positive whole number', () => {
    for (const name of ['acct', 'sid', 'tid']) {
      for (const bad of [ACCOUNT.toUpperCase(), 'not-a-uuid', '', 5, null, `${ACCOUNT} `, ACCOUNT.replace(/-/g, '')]) expect(ticketClaimsOf(base({[name]: bad})), `${name} ${String(bad)}`).toBeNull();
    }
    for (const epoch of [0, -1, 1.5, '3', null, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) expect(ticketClaimsOf(base({epoch})), String(epoch)).toBeNull();
    expect(ticketClaimsOf(base({epoch: 1}))).not.toBeNull();
  });

  it('refuses a kind of target that is not a lower-case word', () => {
    for (const tk of ['', 'Staging', '1staging', 'stag ing', 'x'.repeat(33), 5, null]) expect(ticketClaimsOf(base({tk})), String(tk)).toBeNull();
    // Whether a kind has a resolver is not this function's business: the route and the gateway ask the registry.
    expect(ticketClaimsOf(base({tk: 'project'}))).not.toBeNull();
  });

  it('refuses an upload whose claims are not shaped right: class, length, SHA-256, content type', () => {
    for (const over of [{cls: 'document'}, {cls: 5}, {len: 0}, {len: -4}, {len: 1.5}, {len: '4'}, {len: Number.MAX_SAFE_INTEGER + 2}, {sha: SHA.toUpperCase()}, {sha: 'ab'}, {sha: SHA.slice(1)}, {ct: 5}, {ct: 'image'}, {ct: 'Image/PNG'}, {ct: 'image/png; charset=x'}, {ct: ''}]) {
      expect(ticketClaimsOf(upload(over)), JSON.stringify(over)).toBeNull();
    }
  });

  it('still READS an upload that is over the limit or of a type that is not allowed: shape only, so the gateway refuses the upload (413, 400) and not the ticket', () => {
    const oversize = upload({cls: 'picture', len: transferLimits.pictureBytes + 1});
    expect(ticketClaimsOf(oversize)).toMatchObject({dir: 'upload', len: transferLimits.pictureBytes + 1});
    expect(uploadProblem({cls: 'picture', len: transferLimits.pictureBytes + 1, ct: 'image/png'})).toBe('too_large');
    const gif = upload({ct: 'image/gif'});
    expect(ticketClaimsOf(gif)).toMatchObject({ct: 'image/gif'});
    expect(uploadProblem({cls: 'picture', len: 1, ct: 'image/gif'})).toBe('content_type');
    const bigFile = upload({cls: 'file', ct: 'application/octet-stream', len: transferLimits.fileBytes + 1});
    expect(ticketClaimsOf(bigFile)).toMatchObject({cls: 'file'});
    expect(uploadProblem({cls: 'file', len: transferLimits.fileBytes + 1, ct: 'application/octet-stream'})).toBe('too_large');
  });
});

describe('commandClaimsOf', () => {
  const base = (over: Record<string, unknown> = {}): TokenPayload =>
    ({iss: 'application', aud: 'gateway', env: ENV, jti: newJti(), iat: NOW, exp: NOW + 300, typ: 'command', acct: ACCOUNT, ...over}) as TokenPayload;
  const attach = (over: Record<string, unknown> = {}) => base({cmd: 'attach', epoch: 2, uid: TARGET, tr: 'none', ...over});
  const stage = (over: Record<string, unknown> = {}) => base({cmd: 'delete-staging', uid: TARGET, ...over});
  const root = (over: Record<string, unknown> = {}) => base({cmd: 'delete-root', root: SHA, ...over});

  it('names the three commands', () => {
    expect([...commandNames]).toEqual(['attach', 'delete-staging', 'delete-root']);
  });

  it('reads each command with exactly its claims', () => {
    expect(commandClaimsOf(attach())).toEqual({cmd: 'attach', acct: ACCOUNT, epoch: 2, uid: TARGET, tr: 'none'});
    expect(commandClaimsOf(stage())).toEqual({cmd: 'delete-staging', acct: ACCOUNT, uid: TARGET});
    expect(commandClaimsOf(root())).toEqual({cmd: 'delete-root', acct: ACCOUNT, root: SHA});
  });

  it('refuses a ticket as a command, and a payload of another issuer, audience or type', () => {
    for (const over of [{typ: 'ticket'}, {iss: 'gateway'}, {aud: 'cad-worker'}, {typ: 'Command'}]) {
      expect(commandClaimsOf(stage(over)), JSON.stringify(over)).toBeNull();
    }
    // A real ticket's payload is not a command whatever it holds.
    expect(commandClaimsOf({...base(), typ: 'ticket', cmd: 'delete-staging', uid: TARGET} as TokenPayload)).toBeNull();
  });

  it('refuses a command that does not exist, and one with no command', () => {
    for (const cmd of ['purge', 'delete', 'Attach', '', 5, null, undefined, 'constructor', '__proto__']) expect(commandClaimsOf(stage({cmd})), String(cmd)).toBeNull();
  });

  it('refuses a claim that is not the command\'s own: extra, missing or from another command', () => {
    expect(commandClaimsOf(stage({root: SHA}))).toBeNull();
    expect(commandClaimsOf(root({uid: TARGET}))).toBeNull();
    expect(commandClaimsOf(attach({root: SHA}))).toBeNull();
    expect(commandClaimsOf(stage({epoch: 1}))).toBeNull();
    expect(commandClaimsOf(stage({note: 'x'}))).toBeNull();
    for (const [make, names] of [[attach, ['acct', 'epoch', 'uid', 'tr']], [stage, ['acct', 'uid']], [root, ['acct', 'root']]] as const) {
      for (const name of names) {
        const payload = make();
        delete payload[name];
        expect(commandClaimsOf(payload), `${String(payload.cmd)} without ${name}`).toBeNull();
      }
    }
  });

  it('refuses IDs, a root, a transform and an epoch that are not shaped right: they build the key that is deleted', () => {
    for (const bad of [ACCOUNT.toUpperCase(), '../../x', 'a/b', '', 5, null]) {
      expect(commandClaimsOf(stage({acct: bad})), `acct ${String(bad)}`).toBeNull();
      expect(commandClaimsOf(stage({uid: bad})), `uid ${String(bad)}`).toBeNull();
      expect(commandClaimsOf(attach({uid: bad})), `attach uid ${String(bad)}`).toBeNull();
    }
    for (const bad of [SHA.toUpperCase(), SHA.slice(1), `${SHA}0`, '../..', `${SHA.slice(0, 60)}/../`, '', 5, null]) expect(commandClaimsOf(root({root: bad})), `root ${String(bad)}`).toBeNull();
    for (const tr of ['None', '1none', 'no ne', '../none', '', 'x'.repeat(64), 5, null]) expect(commandClaimsOf(attach({tr})), String(tr)).toBeNull();
    for (const epoch of [0, -1, 1.5, '2', null]) expect(commandClaimsOf(attach({epoch})), String(epoch)).toBeNull();
  });
});

describe('signTicket and signCommand', () => {
  const download: TicketClaims = {acct: ACCOUNT, sid: SESSION, epoch: 3, dir: 'download', tk: 'staging', tid: TARGET};
  const upload: TicketClaims = {acct: ACCOUNT, sid: SESSION, epoch: 3, dir: 'upload', tk: 'staging', tid: TARGET, cls: 'picture', len: 2048, sha: SHA, ct: 'image/png'};

  it('signs a ticket the gateway reads back as the same claims, for the gateway, of type ticket, for five minutes', async () => {
    for (const claims of [download, upload]) {
      const value = signTicket(signer, ENV, claims, {now: NOW});
      const verified = await verifyToken(value, baseOptions({type: 'ticket'}));
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(ticketClaimsOf(verified.payload)).toEqual(claims);
        expect(verified.payload.exp - verified.payload.iat).toBe(300);
        expect(verified.payload.aud).toBe('gateway');
        expect(verified.payload.iss).toBe('application');
      }
    }
  });

  it('signs a command the gateway reads back as the same claims', async () => {
    const commands: CommandClaims[] = [
      {cmd: 'attach', acct: ACCOUNT, epoch: 2, uid: TARGET, tr: 'none'},
      {cmd: 'delete-staging', acct: ACCOUNT, uid: TARGET},
      {cmd: 'delete-root', acct: ACCOUNT, root: SHA},
    ];
    for (const claims of commands) {
      const verified = await verifyToken(signCommand(signer, ENV, claims, {now: NOW}), baseOptions({type: 'command'}));
      expect(verified.ok).toBe(true);
      if (verified.ok) expect(commandClaimsOf(verified.payload)).toEqual(claims);
    }
    // A command is not a ticket and a ticket is not a command, to the verifier that asks for the type.
    expect(await verifyToken(signCommand(signer, ENV, commands[1], {now: NOW}), baseOptions({type: 'ticket'}))).toEqual({ok: false});
    expect(await verifyToken(signTicket(signer, ENV, download, {now: NOW}), baseOptions({type: 'command'}))).toEqual({ok: false});
  });

  it('takes a shorter life and a pinned jti, and refuses a longer life', async () => {
    const jti = newJti();
    const verified = await verifyToken(signTicket(signer, ENV, download, {now: NOW, lifetimeSeconds: 60, jti}), baseOptions());
    expect(verified.ok && verified.payload.jti).toBe(jti);
    expect(verified.ok && verified.payload.exp - verified.payload.iat).toBe(60);
    expect(() => signTicket(signer, ENV, download, {lifetimeSeconds: 301})).toThrow(TypeError);
    expect(() => signCommand(signer, ENV, {cmd: 'delete-staging', acct: ACCOUNT, uid: TARGET}, {lifetimeSeconds: 0})).toThrow(TypeError);
  });

  it('refuses claims the gateway would refuse, so a ticket it would not read is never made', () => {
    const bad = (change: Record<string, unknown>) => ({...upload, ...change}) as unknown as TicketClaims;
    expect(() => signTicket(signer, ENV, bad({acct: ACCOUNT.toUpperCase()}))).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, bad({sid: 'nope'}))).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, bad({epoch: 0}))).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, bad({tk: 'Staging'}))).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, bad({sha: 'ab'}))).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, bad({len: 0}))).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, bad({cls: 'movie'}))).toThrow(TypeError);
    // An unknown claim, a credential or a URL among them.
    expect(() => signTicket(signer, ENV, bad({url: 'https://storage.example/object?sig=x'}))).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, bad({secret_access_key: 'x'}))).toThrow(TypeError);
    // Upload claims on a download, a download missing them as an upload.
    expect(() => signTicket(signer, ENV, {...download, len: 5} as unknown as TicketClaims)).toThrow(TypeError);
    expect(() => signTicket(signer, ENV, {...download, dir: 'upload'} as unknown as TicketClaims)).toThrow(TypeError);
    // A claim named like a standard one is refused by the signer itself.
    expect(() => signTicket(signer, ENV, bad({jti: 'x'}))).toThrow(TypeError);
  });

  it('signs an oversize upload ticket, since its shape is right: the limit is held where the bytes arrive', () => {
    expect(() => signTicket(signer, ENV, {...upload, len: transferLimits.pictureBytes + 1})).not.toThrow();
  });

  it('refuses command claims the gateway would refuse', () => {
    const bad = (claims: Record<string, unknown>) => claims as unknown as CommandClaims;
    expect(() => signCommand(signer, ENV, bad({cmd: 'attach', acct: ACCOUNT, epoch: 2, uid: TARGET, tr: '../none'}))).toThrow(TypeError);
    expect(() => signCommand(signer, ENV, bad({cmd: 'delete-root', acct: ACCOUNT, root: 'not-hex'}))).toThrow(TypeError);
    expect(() => signCommand(signer, ENV, bad({cmd: 'delete-staging', acct: ACCOUNT}))).toThrow(TypeError);
    expect(() => signCommand(signer, ENV, bad({cmd: 'delete-staging', acct: ACCOUNT, uid: TARGET, extra: 1}))).toThrow(TypeError);
    expect(() => signCommand(signer, ENV, bad({cmd: 'purge', acct: ACCOUNT}))).toThrow(TypeError);
  });
});

describe('uploadProblem', () => {
  const ok = {cls: 'picture', len: 1000, ct: 'image/png'};

  it('accepts a picture of each allowed type up to 12 MiB, and a file of the one allowed type up to 100 MiB', () => {
    for (const ct of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(uploadProblem({cls: 'picture', len: 1, ct})).toBeNull();
      expect(uploadProblem({cls: 'picture', len: transferLimits.pictureBytes, ct})).toBeNull();
    }
    expect(uploadProblem({cls: 'file', len: 1, ct: 'application/octet-stream'})).toBeNull();
    expect(uploadProblem({cls: 'file', len: transferLimits.fileBytes, ct: 'application/octet-stream'})).toBeNull();
  });

  it('says too_large one byte over each limit', () => {
    expect(uploadProblem({cls: 'picture', len: transferLimits.pictureBytes + 1, ct: 'image/jpeg'})).toBe('too_large');
    expect(uploadProblem({cls: 'file', len: transferLimits.fileBytes + 1, ct: 'application/octet-stream'})).toBe('too_large');
    // A file may be bigger than a picture can be.
    expect(uploadProblem({cls: 'file', len: transferLimits.pictureBytes + 1, ct: 'application/octet-stream'})).toBeNull();
  });

  it('says content_type for a type the class does not take, whatever the type is for the other class', () => {
    for (const ct of ['application/octet-stream', 'image/gif', 'image/svg+xml', 'IMAGE/PNG', 'image/png; charset=binary', '', 'text/html']) expect(uploadProblem({...ok, ct}), ct).toBe('content_type');
    for (const ct of ['image/png', 'image/jpeg', 'application/octet-stream; x=1', 'application/pdf', '']) expect(uploadProblem({cls: 'file', len: 1, ct}), ct).toBe('content_type');
    expect(uploadProblem({...ok, ct: 5})).toBe('content_type');
    expect(uploadProblem({...ok, ct: undefined})).toBe('content_type');
  });

  it('says length for a length that is not a positive whole number', () => {
    for (const len of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, Number.MAX_SAFE_INTEGER + 2]) expect(uploadProblem({...ok, len}), String(len)).toBe('length');
  });

  it('says class for a class that is neither, and asks in this order: class, length, content type, size', () => {
    for (const cls of ['document', 'Picture', '', 5, null, undefined]) expect(uploadProblem({...ok, cls}), String(cls)).toBe('class');
    expect(uploadProblem({cls: 'x', len: 0, ct: 'x'})).toBe('class');
    expect(uploadProblem({cls: 'picture', len: 0, ct: 'x'})).toBe('length');
    expect(uploadProblem({cls: 'picture', len: transferLimits.pictureBytes + 1, ct: 'x'})).toBe('content_type');
  });
});

describe('the kinds of target and the UUID test', () => {
  it('knows `staging` and no other kind yet: a kind with no resolver is refused', () => {
    expect([...transferTargetKinds]).toEqual(['staging']);
    expect(isTransferTargetKind('staging')).toBe(true);
    for (const kind of ['project', 'manifest', 'export', 'Staging', 'staging ', '', 'constructor', '__proto__', undefined, null, 5]) expect(isTransferTargetKind(kind), String(kind)).toBe(false);
  });

  it('holds an ID to the lower-case canonical UUID spelling', () => {
    expect(isUuid(ACCOUNT)).toBe(true);
    for (const value of [ACCOUNT.toUpperCase(), ` ${ACCOUNT}`, `${ACCOUNT}\n`, ACCOUNT.replace(/-/g, ''), '', 5, null, undefined, `${ACCOUNT}0`]) expect(isUuid(value), String(value)).toBe(false);
  });
});
