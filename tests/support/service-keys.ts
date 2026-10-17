import {createHash, createPrivateKey, createPublicKey} from 'node:crypto';
import {loadSigner, parseKeySet, type ParsedKeySet, type ServiceIssuer, type Signer} from '../../lib/service-signing';

// Service-signing keys for the tests (Story 1.12). They are made up, belong to no environment, and are derived from a label by a fixed rule, so
// the unit and integration tests, the application server and the gateway server of the browser tests all hold the same pair without a key file
// (the secret scan fails on a committed private key) and without anything being generated and passed between processes. The application's `.env`
// files never hold them: the browser tests set them in the web servers' environment (playwright.config.ts), the way the QStash test keys are set.

// The fixed prefix of a PKCS#8 Ed25519 private key; the 32-byte seed follows it.
const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');

export type TestKeyPair = {kid: string; privateKey: string; publicKey: string};

/** The key pair of a label: the seed is the SHA-256 of a fixed sentence and the label, so the same label is the same pair in every process. */
export function testKeyPair(label: string, kid = `test-${label}`): TestKeyPair {
  const seed = createHash('sha256').update(`nova3d test service key: ${label}`).digest();
  const privateDer = Buffer.concat([pkcs8Prefix, seed]);
  const publicDer = createPublicKey(createPrivateKey({key: privateDer, format: 'der', type: 'pkcs8'})).export({type: 'spki', format: 'der'});
  return {kid, privateKey: privateDer.toString('base64'), publicKey: publicDer.toString('base64')};
}

export type TestKeySetOptions = {
  issuer?: ServiceIssuer;
  /** The active key's label (and so its pair). */
  active?: string;
  /** A retiring key: its label and the moment it stops being accepted. */
  retiring?: {label: string; until: Date} | null;
  /**
   * The moment the key set is read at (`parseKeySet` refuses a retiring key whose `until` is more than ten minutes after it). Defaults to six minutes before
   * the retiring key's `until` (the documented rotation window), or now when there is none: a test that builds a set and then verifies at times of its own
   * is not made to choose its `until` within ten minutes of the real clock.
   */
  readAt?: Date;
};

/** A key set (the JSON an environment variable holds) and the private key of its active key. */
export function testKeys(options: TestKeySetOptions = {}) {
  const issuer = options.issuer ?? 'application';
  const active = testKeyPair(options.active ?? 'application-1');
  const retiring = options.retiring ? testKeyPair(options.retiring.label) : null;
  const keys: Record<string, string> = {[active.kid]: active.publicKey};
  if (retiring) keys[retiring.kid] = retiring.publicKey;
  const json = JSON.stringify({issuer, active: active.kid, retiring: retiring ? {kid: retiring.kid, until: options.retiring!.until.toISOString()} : null, keys});
  const readAt = options.readAt ?? (options.retiring ? new Date(options.retiring.until.getTime() - 6 * 60 * 1000) : new Date());
  const parsed = parseKeySet(json, issuer, readAt.getTime());
  if (!parsed.ok) throw new Error(`The test key set is not a key set (${parsed.problem}).`);
  return {json, keySet: parsed.keySet as ParsedKeySet, active, retiring, privateKey: active.privateKey};
}

/** A signer for a label's key pair under a key set that names it as the active key. */
export function testSigner(options: TestKeySetOptions = {}): {signer: Signer; keySet: ParsedKeySet; json: string} {
  const keys = testKeys(options);
  const loaded = loadSigner(keys.privateKey, keys.keySet);
  if (!loaded.ok) throw new Error(`The test signer did not load (${loaded.problem}).`);
  return {signer: loaded.signer, keySet: keys.keySet, json: keys.json};
}

/** The application's keys as the browser tests' web servers hold them: the private key for the app, the public key set for the gateway. */
export const testApplicationKeys = (() => {
  const keys = testKeys();
  return {kid: keys.active.kid, privateKey: keys.privateKey, keySet: keys.json};
})();
