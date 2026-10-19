import {createHash} from 'node:crypto';
import {describe, expect, it, vi} from 'vitest';
import {readConfig, type Env} from '../../workers/files/src/config';
import type {Query, Row} from '../../workers/files/src/database';
import {createResolvers, retainedResolver, stagingResolver, type Resolver} from '../../workers/files/src/resolvers';
import {blocks, handleHashOf, leadingBytesMatch, newHandle, parseRange} from '../../workers/files/src/transfer';
import {testKeys} from '../support/service-keys';

// The pure parts of the file gateway (Story 1.12, workers/files/src): how a stream is cut into chunks of at most 1 MiB, how a Range header is read,
// what a picture's first bytes must be, how a handle in a URL becomes the hash the database holds, the resolver registry and its one resolver, and
// the configuration the gateway refuses to start without. No database, no Storage, no network: the server over all of them is
// tests/unit/gateway-server.test.ts and the real thing is tests/integration/file-gateway.test.ts.

async function* source(pieces: Uint8Array[]) {
  for (const piece of pieces) yield piece;
}
async function collect(iterable: AsyncIterable<Buffer>) {
  const out: Buffer[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe('blocks: a chunk is at most the chunk size, however the pieces arrive', () => {
  const pattern = (length: number) => Uint8Array.from({length}, (_unused, index) => index % 251);

  it('cuts pieces of any size into chunks of exactly the size, and a last chunk that is shorter', async () => {
    const bytes = pattern(1000);
    // Pieces of 7, 300, 1 and the rest: nothing lines up with 128.
    const pieces = [bytes.subarray(0, 7), bytes.subarray(7, 307), bytes.subarray(307, 308), bytes.subarray(308)];
    const chunks = await collect(blocks(source(pieces), 128));
    expect(chunks.map((chunk) => chunk.length)).toEqual([128, 128, 128, 128, 128, 128, 128, 104]);
    expect(Buffer.concat(chunks).equals(Buffer.from(bytes))).toBe(true);
  });

  it('yields nothing for nothing, and one short chunk for less than a chunk', async () => {
    expect(await collect(blocks(source([]), 128))).toEqual([]);
    expect(await collect(blocks(source([new Uint8Array(0), new Uint8Array(0)]), 128))).toEqual([]);
    const short = await collect(blocks(source([pattern(5)]), 128));
    expect(short.map((chunk) => chunk.length)).toEqual([5]);
  });

  it('yields a chunk of exactly the size, and no empty chunk after it, when the input ends on the edge', async () => {
    const chunks = await collect(blocks(source([pattern(128), pattern(128)]), 128));
    expect(chunks.map((chunk) => chunk.length)).toEqual([128, 128]);
  });

  it('reads a piece that is a view into a larger buffer by its own offset and length, not the whole buffer', async () => {
    const backing = new Uint8Array(64);
    backing.fill(9);
    backing.set([1, 2, 3, 4, 5, 6], 20);
    const view = new Uint8Array(backing.buffer, 20, 6);
    const chunks = await collect(blocks(source([view, new Uint8Array(backing.buffer, 26, 2)]), 4));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 9, 9]));
    expect(chunks.map((chunk) => chunk.length)).toEqual([4, 4]);
  });

  it('never yields more than the size, for a 1 MiB chunk from 64 KiB reads', async () => {
    const MiB = 1024 * 1024;
    const reads = Array.from({length: 40}, () => new Uint8Array(64 * 1024));
    const chunks = await collect(blocks(source(reads), MiB));
    expect(chunks.map((chunk) => chunk.length)).toEqual([MiB, MiB, 512 * 1024]);
  });

  it('stops reading its source when the consumer stops: a refused chunk leaves nothing pulled ahead', async () => {
    let pulled = 0;
    async function* counted() {
      for (let index = 0; index < 100; index += 1) {
        pulled += 1;
        yield new Uint8Array(10);
      }
    }
    for await (const chunk of blocks(counted(), 10)) {
      expect(chunk).toHaveLength(10);
      break;
    }
    expect(pulled).toBe(1);
  });
});

describe('parseRange', () => {
  const whole = {kind: 'whole'};
  const bad = {kind: 'unsatisfiable'};
  const partial = (start: number, end: number) => ({kind: 'partial', start, end});

  it('is the whole object when there is no Range header', () => {
    expect(parseRange(undefined, 1000)).toEqual(whole);
  });

  it.each([
    ['bytes=0-99', partial(0, 99)],
    ['bytes=10-10', partial(10, 10)],
    ['bytes=500-', partial(500, 999)],
    ['bytes=0-', partial(0, 999)],
    ['bytes=-100', partial(900, 999)],
    ['bytes=-1', partial(999, 999)],
    ['bytes=990-5000', partial(990, 999)],
    ['bytes=0-999', partial(0, 999)],
    ['bytes=999-999', partial(999, 999)],
    ['  bytes=5-6  ', partial(5, 6)],
  ])('reads %s', (header, expected) => {
    expect(parseRange(header, 1000)).toEqual(expected);
  });

  it('takes a suffix longer than the object as the whole object, as a range', () => {
    expect(parseRange('bytes=-5000', 1000)).toEqual(partial(0, 999));
  });

  it.each([
    ['a suffix of 0', 'bytes=-0'],
    ['a start at the end', 'bytes=1000-'],
    ['a start past the end', 'bytes=2000-3000'],
    ['an end before the start', 'bytes=50-10'],
    ['several ranges', 'bytes=0-1,5-6'],
    ['several ranges with spaces', 'bytes=0-1, 5-6'],
    ['another unit', 'items=0-5'],
    ['no unit', '0-5'],
    ['an empty range', 'bytes=-'],
    ['an empty header', ''],
    ['junk', 'bytes=abc'],
    ['a negative start', 'bytes=-5-10'],
    ['a sign', 'bytes=+5-10'],
    ['a space inside', 'bytes=5 -10'],
    ['a decimal', 'bytes=1.5-3'],
    ['digits too many to be a position', `bytes=${'9'.repeat(16)}-`],
    ['an upper-case unit', 'Bytes=0-5'],
  ])('is unsatisfiable for %s', (_name, header) => {
    expect(parseRange(header, 1000)).toEqual(bad);
  });

  it('serves nothing from an empty object but the whole of it', () => {
    expect(parseRange(undefined, 0)).toEqual(whole);
    expect(parseRange('bytes=0-', 0)).toEqual(bad);
    expect(parseRange('bytes=-5', 0)).toEqual(bad);
  });

  it('reads a position up to 15 digits exactly', () => {
    const size = 2 ** 40;
    expect(parseRange(`bytes=${size - 10}-`, size)).toEqual(partial(size - 10, size - 1));
  });
});

describe('leadingBytesMatch', () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const webp = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
  const head = (bytes: number[], extra = 4) => Uint8Array.from([...bytes, ...new Array(extra).fill(0)]);

  it('knows a JPEG by FF D8 FF, a PNG by its eight-byte signature, a WebP by RIFF, four bytes and WEBP', () => {
    expect(leadingBytesMatch('image/jpeg', head([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(leadingBytesMatch('image/png', head(png))).toBe(true);
    expect(leadingBytesMatch('image/webp', head(webp))).toBe(true);
  });

  it('does not take one picture type for another', () => {
    const heads = {'image/jpeg': head([0xff, 0xd8, 0xff]), 'image/png': head(png), 'image/webp': head(webp)} as const;
    for (const [declared] of Object.entries(heads)) {
      for (const [actual, bytes] of Object.entries(heads)) expect(leadingBytesMatch(declared, bytes), `${declared} declared, ${actual} sent`).toBe(declared === actual);
    }
  });

  it('refuses bytes that are almost a signature, and a head that is too short to hold one', () => {
    expect(leadingBytesMatch('image/png', head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]))).toBe(false);
    expect(leadingBytesMatch('image/png', Uint8Array.from(png.slice(0, 7)))).toBe(false);
    expect(leadingBytesMatch('image/jpeg', Uint8Array.from([0xff, 0xd8]))).toBe(false);
    expect(leadingBytesMatch('image/webp', Uint8Array.from(webp.slice(0, 11)))).toBe(false);
    expect(leadingBytesMatch('image/webp', head([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x51]))).toBe(false);
    expect(leadingBytesMatch('image/webp', head([0x52, 0x49, 0x46, 0x47, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]))).toBe(false);
    expect(leadingBytesMatch('image/jpeg', new Uint8Array(0))).toBe(false);
  });

  it('has no signature to check for an opaque file, whatever its first bytes are, or for a type it does not know', () => {
    expect(leadingBytesMatch('application/octet-stream', new Uint8Array(0))).toBe(true);
    expect(leadingBytesMatch('application/octet-stream', head(png))).toBe(true);
    expect(leadingBytesMatch('application/octet-stream', Uint8Array.from([1, 2, 3]))).toBe(true);
  });
});

describe('handles', () => {
  const fixed = Buffer.alloc(32, 7);

  it('makes a handle of 32 random bytes in base64url, and the SHA-256 of those bytes as what the database holds', () => {
    const random = vi.fn(() => fixed);
    const made = newHandle(random);
    expect(random).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledWith(32);
    expect(made.handle).toBe(fixed.toString('base64url'));
    expect(made.handle).toHaveLength(43);
    expect(made.hash).toEqual(createHash('sha256').update(fixed).digest());
    expect(made.hash).toHaveLength(32);
    // The hash is not the handle, and the handle is not recoverable from it.
    expect(made.hash.toString('base64url')).not.toBe(made.handle);
  });

  it('reads a handle back to the same hash, so the URL and the row meet', () => {
    const made = newHandle(() => fixed);
    expect(handleHashOf(made.handle)).toEqual(made.hash);
  });

  it('refuses what is not a handle: another length, characters of another alphabet, padding, whitespace', () => {
    const {handle} = newHandle(() => fixed);
    for (const value of ['', handle.slice(1), `${handle}A`, `${handle}=`, handle.replace(/.$/, '+'), handle.replace(/.$/, '/'), ` ${handle}`, `${handle}\n`, 'x'.repeat(42), 'x'.repeat(44), handle.toLowerCase() === handle ? handle.toUpperCase().slice(0, 42) : '']) {
      expect(handleHashOf(value), value).toBeNull();
    }
  });

  it('refuses another spelling of the same 32 bytes: one handle, one spelling', () => {
    const {handle} = newHandle(() => fixed);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const other = [...alphabet].map((letter) => handle.slice(0, -1) + letter).find((candidate) => candidate !== handle && Buffer.from(candidate, 'base64url').equals(fixed));
    expect(other).toBeDefined();
    expect(handleHashOf(other!)).toBeNull();
    expect(handleHashOf(handle)).not.toBeNull();
  });

  it('gives different handles different hashes', () => {
    const a = newHandle(() => Buffer.alloc(32, 1));
    const b = newHandle(() => Buffer.alloc(32, 2));
    expect(a.handle).not.toBe(b.handle);
    expect(a.hash.equals(b.hash)).toBe(false);
  });
});

describe('the resolver registry', () => {
  const never: Resolver = async () => ({outcome: 'unavailable'});

  it('holds `staging` and `retained` (Story 2.12) and nothing else, and no resolver for any other kind', () => {
    const registry = createResolvers();
    expect(registry.kinds()).toEqual(['retained', 'staging']);
    expect(registry.resolver('staging')).toBe(stagingResolver);
    expect(registry.resolver('retained')).toBe(retainedResolver);
    for (const kind of ['project', 'manifest', 'export', 'fixture', '', 'Staging', 'Retained', 'constructor', '__proto__', 'toString']) expect(registry.resolver(kind), kind).toBeUndefined();
  });

  it('takes the kinds a caller registers (a test fixture, a later story), listed in order', () => {
    const registry = createResolvers({project: never, fixture: never});
    expect(registry.kinds()).toEqual(['fixture', 'project', 'retained', 'staging']);
    expect(registry.resolver('project')).toBe(never);
    expect(registry.resolver('fixture')).toBe(never);
  });

  it('refuses a kind registered twice, `staging` and `retained` included: the registry is one place and says who owns a kind', () => {
    expect(() => createResolvers({staging: never})).toThrow(/already registered/);
    expect(() => createResolvers({retained: never})).toThrow(/already registered/);
  });

  it('refuses a kind that is not a lower-case word', () => {
    for (const kind of ['', 'Project', '1project', 'pro ject', 'pro/ject', '__proto__', 'x'.repeat(33)]) expect(() => createResolvers({[kind]: never}), kind).toThrow(TypeError);
  });

  it('is built fresh for each caller, so one test\'s fixture is never another\'s', () => {
    createResolvers({fixture: never});
    expect(createResolvers().kinds()).toEqual(['retained', 'staging']);
  });
});

describe('the staging resolver', () => {
  const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const UPLOAD = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
  const SHA = 'cd'.repeat(32);
  const now = new Date('2026-10-15T12:00:00Z');

  function asking(rows: Row[]) {
    const calls: {sql: string; params: unknown[]}[] = [];
    const query: Query = async (sql, params) => {
      calls.push({sql, params});
      return rows;
    };
    return {query, calls};
  }

  it('asks for a lease of THIS Account, by upload, in the states of the direction, not expired at the moment it is asked', async () => {
    const download = asking([{length: '5242880', content_type: 'image/png', sha256: SHA}]);
    await stagingResolver(download.query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now});
    expect(download.calls).toHaveLength(1);
    expect(download.calls[0].sql).toMatch(/from artifacts\.staging_leases/);
    expect(download.calls[0].sql).toMatch(/id = \$1 and account_id = \$2 and state = any\(\$3\) and expires_at > \$4/);
    expect(download.calls[0].params).toEqual([UPLOAD, ACCOUNT, ['complete', 'attached'], now]);

    const upload = asking([{length: 1, content_type: 'image/png', sha256: SHA}]);
    await stagingResolver(upload.query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'upload', now});
    expect(upload.calls[0].params).toEqual([UPLOAD, ACCOUNT, ['receiving'], now]);
  });

  it('answers where the bytes are, built from the two IDs and nothing else, with the length, the type and the SHA-256 as the etag', async () => {
    const {query} = asking([{length: '5242880', content_type: 'image/png', sha256: SHA}]);
    expect(await stagingResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).toEqual({
      outcome: 'allowed',
      key: `staging/${ACCOUNT}/${UPLOAD}`,
      length: 5242880,
      contentType: 'image/png',
      etag: SHA,
    });
  });

  it('is `unavailable`, one answer with nothing in it, when no lease is there for this Account in these states', async () => {
    const {query} = asking([]);
    expect(await stagingResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).toEqual({outcome: 'unavailable'});
  });

  it.each([
    ['a length that is not a number', {length: 'big', content_type: 'image/png', sha256: SHA}],
    ['a fractional length', {length: 1.5, content_type: 'image/png', sha256: SHA}],
    ['no content type', {length: 5, sha256: SHA}],
    ['a content type that is not text', {length: 5, content_type: 7, sha256: SHA}],
    ['no digest', {length: 5, content_type: 'image/png'}],
    ['a digest that is not text', {length: 5, content_type: 'image/png', sha256: 9}],
    ['nothing', {}],
  ])('is `unavailable` for a row with %s: a row that is not an answer is not permission', async (_name, row) => {
    const {query} = asking([row]);
    expect(await stagingResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).toEqual({outcome: 'unavailable'});
  });

  it('lets a database failure reach the caller, which stops the transfer: it does not turn it into an answer', async () => {
    const failing: Query = async () => {
      throw new Error('connection terminated');
    };
    await expect(stagingResolver(failing, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).rejects.toThrow('connection terminated');
  });
});

describe('the retained resolver (Story 2.12)', () => {
  const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const UPLOAD = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
  const ROOT = 'ab'.repeat(32);
  const DIGEST = 'cd'.repeat(32);
  const now = new Date('2026-10-21T12:00:00Z');

  function asking(rows: Row[]) {
    const calls: {sql: string; params: unknown[]}[] = [];
    const query: Query = async (sql, params) => {
      calls.push({sql, params});
      return rows;
    };
    return {query, calls};
  }
  const pinned = {root: ROOT, digest: DIGEST, length: '482113', content_type: 'image/jpeg'};

  it('asks the live-authorization view for the Account\'s own pinned picture by upload, and nothing else', async () => {
    const {query, calls} = asking([pinned]);
    await retainedResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now});
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/from artifacts\.retained_pictures/);
    expect(calls[0].sql).toMatch(/upload_id = \$1 and account_id = \$2/);
    expect(calls[0].params).toEqual([UPLOAD, ACCOUNT]);
    // It reads no table of the Projects or the staging: the view is the whole of the question.
    expect(calls[0].sql).not.toMatch(/staging_leases|projects\.|manifests/);
  });

  it('serves the object at objects/<account>/<root> with the retained length and type and the retained digest as its etag', async () => {
    const {query} = asking([pinned]);
    expect(await retainedResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).toEqual({
      outcome: 'allowed',
      key: `objects/${ACCOUNT}/${ROOT}`,
      length: 482113,
      contentType: 'image/jpeg',
      etag: DIGEST,
    });
  });

  it('is `unavailable` for an upload, and asks nothing, when the direction is an upload: a retained picture is only ever read', async () => {
    const {query, calls} = asking([pinned]);
    expect(await retainedResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'upload', now})).toEqual({outcome: 'unavailable'});
    expect(calls).toHaveLength(0);
  });

  it('is `unavailable`, one answer with nothing in it, when no pinned picture of this Account is there (another Account\'s, unknown, unpinned, deleted or tombstoned)', async () => {
    const {query} = asking([]);
    expect(await retainedResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).toEqual({outcome: 'unavailable'});
  });

  it.each([
    ['a root that is not a digest', {...pinned, root: 'objects/../x'}],
    ['an upper-case root', {...pinned, root: ROOT.toUpperCase()}],
    ['no root', {...pinned, root: undefined}],
    ['a length that is not a number', {...pinned, length: 'big'}],
    ['a length of zero', {...pinned, length: 0}],
    ['a fractional length', {...pinned, length: 1.5}],
    ['no content type', {...pinned, content_type: undefined}],
    ['no digest', {...pinned, digest: undefined}],
    ['nothing', {}],
  ])('is `unavailable` for a row with %s: a row that is not an answer is not permission, and a key is never made of text the database did not validate', async (_name, row) => {
    const {query} = asking([row as Row]);
    expect(await retainedResolver(query, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).toEqual({outcome: 'unavailable'});
  });

  it('lets a database failure reach the caller, which stops the transfer: it does not turn it into an answer', async () => {
    const failing: Query = async () => {
      throw new Error('connection terminated');
    };
    await expect(retainedResolver(failing, {accountId: ACCOUNT, targetId: UPLOAD, direction: 'download', now})).rejects.toThrow('connection terminated');
  });
});

describe('readConfig', () => {
  const keys = testKeys();
  const INSTANCE = '3F0D6C1E-8A52-4C1B-9D57-2B6A1F0E7C44';
  const valid = (): Env => ({
    APP_ENV: 'local',
    INSTANCE_ID: INSTANCE,
    APP_ORIGIN: 'http://127.0.0.1:4173',
    SERVICE_KEYS_APPLICATION: keys.json,
    GATEWAY_DATABASE_URL: 'postgresql://nova3d_gateway:a-password-that-must-never-be-printed@127.0.0.1:54322/postgres',
    GATEWAY_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:54321/storage/v1/s3',
    GATEWAY_STORAGE_S3_REGION: 'local',
    GATEWAY_STORAGE_S3_ACCESS_KEY_ID: 'access-key-id-for-tests',
    GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY: 'a-secret-access-key-that-must-never-be-printed',
  });
  const hosted = (environment: 'staging' | 'production' = 'staging'): Env => ({
    ...valid(),
    APP_ENV: environment,
    APP_ORIGIN: 'https://nova3d-staging.example.test',
    // (Story 1.12 review: a hosted database URL carries sslmode, below.)
    GATEWAY_DATABASE_URL: 'postgresql://nova3d_gateway.abcdefgh:a-password-that-must-never-be-printed@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require',
    GATEWAY_STORAGE_S3_ENDPOINT: 'https://abcdefgh.supabase.co/storage/v1/s3',
    GATEWAY_STORAGE_S3_REGION: 'eu-west-1',
  });
  const problemsOf = (env: Env) => {
    const result = readConfig(env);
    expect(result.ok, JSON.stringify(Object.keys(env))).toBe(false);
    return result.ok ? [] : result.problems;
  };

  it('reads a complete environment: the settings, the lower-cased instance, the parsed key set and the default port', () => {
    const result = readConfig(valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      port: 8080,
      appEnv: 'local',
      instanceId: INSTANCE.toLowerCase(),
      appOrigin: 'http://127.0.0.1:4173',
      databaseUrl: valid().GATEWAY_DATABASE_URL,
      s3: {endpoint: 'http://127.0.0.1:54321/storage/v1/s3', region: 'local', accessKeyId: 'access-key-id-for-tests', secretAccessKey: 'a-secret-access-key-that-must-never-be-printed'},
    });
    expect(result.config.keySet.issuer).toBe('application');
    expect(result.config.keySet.active).toBe(keys.active.kid);
    expect(readConfig(hosted('production')).ok).toBe(true);
    expect(readConfig(hosted('staging')).ok).toBe(true);
  });

  it('takes PORT as the port to listen on, trimmed', () => {
    const result = readConfig({...valid(), PORT: ' 3456 '});
    expect(result.ok && result.config.port).toBe(3456);
    const empty = readConfig({...valid(), PORT: ''});
    expect(empty.ok && empty.config.port).toBe(8080);
  });

  it.each(['abc', '0', '65536', '-1', '80.5', '1e3', '123456', '0x50'])('refuses PORT=%s', (port) => {
    expect(problemsOf({...valid(), PORT: port})).toEqual(['PORT must be a port number']);
  });

  it.each(['APP_ENV', 'INSTANCE_ID', 'APP_ORIGIN', 'SERVICE_KEYS_APPLICATION', 'GATEWAY_DATABASE_URL', 'GATEWAY_STORAGE_S3_ENDPOINT', 'GATEWAY_STORAGE_S3_REGION', 'GATEWAY_STORAGE_S3_ACCESS_KEY_ID', 'GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY'])(
    'refuses a missing %s, an empty one and a placeholder, naming the variable',
    (name) => {
      for (const value of [undefined, '', '   ', 'replace-with-the-value', '<the value>', 'changeme', 'TODO']) {
        const problems = problemsOf({...valid(), [name]: value});
        expect(problems, `${name}=${String(value)}`).toContain(`${name} is not set`);
      }
    },
  );

  it('names every problem at once, so one run says everything that is wrong', () => {
    const problems = problemsOf({});
    expect(problems).toHaveLength(9);
    for (const name of ['APP_ENV', 'INSTANCE_ID', 'APP_ORIGIN', 'SERVICE_KEYS_APPLICATION', 'GATEWAY_DATABASE_URL', 'GATEWAY_STORAGE_S3_ENDPOINT', 'GATEWAY_STORAGE_S3_REGION', 'GATEWAY_STORAGE_S3_ACCESS_KEY_ID', 'GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY']) {
      expect(problems.some((problem) => problem.startsWith(name)), name).toBe(true);
    }
  });

  it('refuses an APP_ENV that is not one of the three, and an INSTANCE_ID that is not a UUID', () => {
    expect(problemsOf({...valid(), APP_ENV: 'prod'})).toEqual(['APP_ENV must be local, staging or production']);
    expect(problemsOf({...valid(), INSTANCE_ID: 'not-a-uuid'})).toEqual(['INSTANCE_ID must be a UUID']);
  });

  it('holds APP_ORIGIN to an origin and nothing more, and to https for staging and production', () => {
    for (const origin of ['https://nova3d.example.test/', 'https://nova3d.example.test/path', 'https://nova3d.example.test?x=1', 'https://nova3d.example.test#x', 'https://user:pass@nova3d.example.test', 'nova3d.example.test', 'not a url', '*', 'null']) {
      expect(problemsOf({...valid(), APP_ORIGIN: origin}).join(' '), origin).toContain('APP_ORIGIN must be an origin and nothing more');
    }
    expect(problemsOf({...hosted('staging'), APP_ORIGIN: 'http://nova3d.example.test'})).toEqual(['APP_ORIGIN must be an https origin for staging and production']);
    expect(problemsOf({...hosted('production'), APP_ORIGIN: 'http://nova3d.example.test'})).toEqual(['APP_ORIGIN must be an https origin for staging and production']);
    // A local gateway serves a local application over http, on any port.
    expect(readConfig({...valid(), APP_ORIGIN: 'http://localhost:3000'}).ok).toBe(true);
    expect(readConfig({...hosted(), APP_ORIGIN: 'https://nova3d.example.test:8443'}).ok).toBe(true);
  });

  it('prefixes the key set\'s problem with the variable, and never prints the set, a key or any other value', () => {
    const rotated = JSON.parse(keys.json) as Record<string, unknown>;
    rotated.issuer = 'gateway';
    const cases: Env[] = [
      {...valid(), SERVICE_KEYS_APPLICATION: '{not json'},
      {...valid(), SERVICE_KEYS_APPLICATION: JSON.stringify(rotated)},
      {...valid(), SERVICE_KEYS_APPLICATION: testKeys({issuer: 'gateway', active: 'gateway-1'}).json},
      {...valid(), SERVICE_KEYS_APPLICATION: JSON.stringify({issuer: 'application', active: 'a', retiring: null, keys: {a: 'AAAA'}})},
    ];
    for (const env of cases) {
      const problems = problemsOf(env);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^SERVICE_KEYS_APPLICATION: (?:the key set |a public key )/);
      expect(problems[0]).not.toContain(keys.active.publicKey);
    }
  });

  it('refuses a database URL that is not a postgres URL', () => {
    for (const url of ['mysql://x@h/db', 'http://127.0.0.1:54322', '127.0.0.1:54322', 'postgres']) expect(problemsOf({...valid(), GATEWAY_DATABASE_URL: url}), url).toEqual(['GATEWAY_DATABASE_URL must be a postgres URL']);
    expect(readConfig({...valid(), GATEWAY_DATABASE_URL: 'postgres://u:p@h:5432/postgres'}).ok).toBe(true);
  });

  // Story 1.12 review (P7): the finding was real. A hosted database is reached over the network, and nothing made the URL say the connection is encrypted.
  describe('TLS to the database', () => {
    const withUrl = (environment: 'staging' | 'production', url: string): Env => ({...hosted(environment), GATEWAY_DATABASE_URL: url});
    const base = 'postgresql://nova3d_gateway.abcdefgh:a-password-that-must-never-be-printed@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    const sslProblem = 'GATEWAY_DATABASE_URL must carry sslmode=require, sslmode=verify-ca or sslmode=verify-full for staging and production';

    it.each(['staging', 'production'] as const)('requires sslmode=require, verify-ca or verify-full for %s, wherever it stands among the parameters', (environment) => {
      for (const query of ['?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full', '?application=x&sslmode=require', '?sslmode=require&connect_timeout=5']) {
        expect(readConfig(withUrl(environment, base + query)).ok, query).toBe(true);
      }
      for (const query of ['', '?', '?sslmode=disable', '?sslmode=allow', '?sslmode=prefer', '?sslmode=', '?sslmode=REQUIRE', '?ssl=true', '?sslmode', '?x=sslmode=require', '?sslmode=require%00']) {
        expect(problemsOf(withUrl(environment, base + query)), query).toEqual([sslProblem]);
      }
    });

    it('exempts the local stack, on loopback, which has no TLS', () => {
      expect(readConfig(valid()).ok).toBe(true);
      expect(readConfig({...valid(), GATEWAY_DATABASE_URL: `${valid().GATEWAY_DATABASE_URL}?sslmode=disable`}).ok).toBe(true);
    });

    it('prints no part of the URL in the problem, and does not add one for a URL that is not a postgres URL', () => {
      const problems = problemsOf(withUrl('staging', base + '?sslmode=disable'));
      expect(problems.join('\n')).not.toMatch(/a-password|pooler|nova3d_gateway|abcdefgh/);
      expect(problemsOf(withUrl('staging', 'mysql://u:p@h/db'))).toEqual(['GATEWAY_DATABASE_URL must be a postgres URL']);
      // An environment that is not one of the three has its own problem and is not asked about TLS as well.
      expect(problemsOf({...valid(), APP_ENV: 'prod'})).toEqual(['APP_ENV must be local, staging or production']);
    });
  });

  // Story 1.12 review (P14): a key set read by the gateway at start-up names a retiring key valid for at most ten minutes ahead.
  it('refuses a key set whose retiring key is valid for more than ten minutes, naming the variable', () => {
    const soon = testKeys({retiring: {label: 'application-0', until: new Date(Date.now() + 5 * 60 * 1000)}, readAt: new Date()});
    expect(readConfig({...valid(), SERVICE_KEYS_APPLICATION: soon.json}).ok).toBe(true);
    const far = JSON.parse(soon.json) as {retiring: {until: string}};
    far.retiring.until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(problemsOf({...valid(), SERVICE_KEYS_APPLICATION: JSON.stringify(far)})).toEqual(["SERVICE_KEYS_APPLICATION: the retiring key's until is more than ten minutes ahead (a rotation needs six)"]);
  });

  it('holds the Storage endpoint to a URL, and to https for staging and production, and the region to a name', () => {
    expect(problemsOf({...valid(), GATEWAY_STORAGE_S3_ENDPOINT: 'not a url'})).toEqual(['GATEWAY_STORAGE_S3_ENDPOINT must be a URL']);
    expect(problemsOf({...valid(), GATEWAY_STORAGE_S3_ENDPOINT: 'ftp://127.0.0.1/s3'})).toEqual(['GATEWAY_STORAGE_S3_ENDPOINT must be an http or https URL']);
    expect(problemsOf({...hosted(), GATEWAY_STORAGE_S3_ENDPOINT: 'http://abcdefgh.supabase.co/storage/v1/s3'})).toEqual(['GATEWAY_STORAGE_S3_ENDPOINT must be https for staging and production']);
    expect(readConfig({...valid(), GATEWAY_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:54321/storage/v1/s3'}).ok).toBe(true);
    for (const region of ['has space', 'x'.repeat(65), 'a/b', 'a.b']) expect(problemsOf({...valid(), GATEWAY_STORAGE_S3_REGION: region}), region).toEqual(['GATEWAY_STORAGE_S3_REGION must be a region name']);
  });

  it('prints no value of the environment in any problem, secrets and the wrong value included', () => {
    const everything = problemsOf({
      APP_ENV: 'prod-with-a-secret-looking-value',
      INSTANCE_ID: 'instance-value-must-never-be-printed',
      APP_ORIGIN: 'https://origin-value-must-never-be-printed.example/with/a/path',
      SERVICE_KEYS_APPLICATION: '{"key":"key-value-must-never-be-printed"',
      GATEWAY_DATABASE_URL: 'mysql://user:db-password-must-never-be-printed@host/db',
      GATEWAY_STORAGE_S3_ENDPOINT: 'endpoint-value-must-never-be-printed',
      GATEWAY_STORAGE_S3_REGION: 'region value must never be printed',
      GATEWAY_STORAGE_S3_ACCESS_KEY_ID: 'access-key-id-value',
      GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY: 'secret-value-must-never-be-printed',
      PORT: 'port-value-must-never-be-printed',
    }).join('\n');
    expect(everything).not.toMatch(/must-never-be-printed|must never be printed|secret-looking/);
    expect(everything).toContain('APP_ENV');
    expect(everything).toContain('PORT');
  });
});
