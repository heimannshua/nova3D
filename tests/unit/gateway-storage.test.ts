import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {createS3Storage, MissingObject, PartialDeleteError, type S3Sender} from '../../workers/files/src/storage';

// The gateway's Storage module (workers/files/src/storage.ts) against a fake S3 client that answers as the store does. The real store is
// tests/integration/file-gateway.test.ts. Story 1.12 review (P3): the finding was real. `DeleteObjects` with `Quiet: true` answers HTTP 200 and reports each key
// it could not delete in `Errors`; the module counted every key it asked about as deleted, so a lease could be marked `deleted` while its object was still there.

const ACCOUNT = '1111111a-dddd-4eee-8fff-11111111111a';
const UPLOAD = randomUUID();
const prefix = `staging/${ACCOUNT}/${UPLOAD}`;
const settings = {endpoint: 'http://127.0.0.1:1/s3', region: 'local', accessKeyId: 'id', secretAccessKey: 'a-secret-that-must-never-be-printed'};

type Command = {constructor: {name: string}; input: Record<string, unknown>};

/** A bucket in memory behind the two calls `deletePrefix` makes, with a page size, and the failures a test asks for. */
function fakeS3(keys: string[], options: {pageSize?: number; refuse?: (key: string) => boolean; throwOn?: string} = {}) {
  const held = new Set(keys);
  const sent: {name: string; input: Record<string, unknown>}[] = [];
  const sender = {
    send: async (command: Command) => {
      const name = command.constructor.name;
      sent.push({name, input: command.input});
      if (options.throwOn === name) throw Object.assign(new Error('the store said no'), {name: 'InternalError'});
      if (name === 'ListObjectsV2Command') {
        // A continuation token is the last key of the page before (as the store's are), so deleting a page does not move the next.
        const after = command.input.ContinuationToken ? String(command.input.ContinuationToken) : '';
        const wanted = [...held].filter((key) => key.startsWith(String(command.input.Prefix)) && key > after).sort();
        const size = options.pageSize ?? 1000;
        const page = wanted.slice(0, size);
        const more = wanted.length > size;
        return {Contents: page.map((Key) => ({Key})), IsTruncated: more, NextContinuationToken: more ? page[page.length - 1] : undefined};
      }
      if (name === 'DeleteObjectCommand') {
        held.delete(String(command.input.Key));
        return {};
      }
      if (name === 'CopyObjectCommand') return {};
      if (name === 'DeleteObjectsCommand') {
        const objects = (command.input.Delete as {Objects: {Key: string}[]; Quiet: boolean}).Objects;
        const errors: {Key: string; Code: string; Message: string}[] = [];
        for (const {Key} of objects) {
          if (options.refuse?.(Key)) errors.push({Key, Code: 'AccessDenied', Message: `cannot delete ${Key}`});
          else held.delete(Key);
        }
        // A quiet answer lists failures and nothing else, and is a 200.
        return errors.length > 0 ? {Errors: errors} : {};
      }
      throw new Error(`unexpected ${name}`);
    },
  } as unknown as S3Sender;
  return {sender, held, sent, storage: createS3Storage(settings, sender)};
}

describe('deletePrefix', () => {
  it('deletes the key itself and what is beneath prefix/, counts them, and leaves a key that merely starts with the same characters', async () => {
    const neighbour = `${prefix}x`;
    const other = `staging/${ACCOUNT}/${randomUUID()}`;
    const fake = fakeS3([prefix, `${prefix}/part`, neighbour, other]);
    expect(await fake.storage.deletePrefix(prefix)).toBe(2);
    expect([...fake.held].sort()).toEqual([neighbour, other].sort());
  });

  it('asks for the objects of a quiet batch delete, in the one bucket, and for nothing outside the prefix', async () => {
    const fake = fakeS3([prefix]);
    await fake.storage.deletePrefix(prefix);
    const batch = fake.sent.find((call) => call.name === 'DeleteObjectsCommand')!;
    expect(batch.input).toMatchObject({Bucket: 'private-files', Delete: {Objects: [{Key: prefix}], Quiet: true}});
  });

  it('follows the pages of a long listing', async () => {
    const keys = [prefix, ...Array.from({length: 5}, (_unused, index) => `${prefix}/${index}`)];
    const fake = fakeS3(keys, {pageSize: 2});
    expect(await fake.storage.deletePrefix(prefix)).toBe(6);
    expect(fake.held.size).toBe(0);
    expect(fake.sent.filter((call) => call.name === 'ListObjectsV2Command')).toHaveLength(3);
  });

  it('is harmless when nothing is there: no batch is sent, and it counts none', async () => {
    const fake = fakeS3([]);
    expect(await fake.storage.deletePrefix(prefix)).toBe(0);
    expect(fake.sent.map((call) => call.name)).toEqual(['ListObjectsV2Command']);
  });

  it('FAILS when the store reports a key it could not delete inside a 200 answer, instead of counting it as deleted', async () => {
    const fake = fakeS3([prefix, `${prefix}/a`, `${prefix}/b`], {refuse: (key) => key.endsWith('/a')});
    const error = await fake.storage.deletePrefix(prefix).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartialDeleteError);
    expect(error).toMatchObject({name: 'PartialDeleteError', failed: 1});
    // What could go, went; what could not is still there, for the next run to find.
    expect([...fake.held]).toEqual([`${prefix}/a`]);
  });

  it('tries every page before it fails, so one refused key does not keep the rest of a long prefix', async () => {
    const keys = Array.from({length: 6}, (_unused, index) => `${prefix}/${index}`);
    const fake = fakeS3(keys, {pageSize: 2, refuse: (key) => key.endsWith('/0')});
    await expect(fake.storage.deletePrefix(prefix)).rejects.toMatchObject({name: 'PartialDeleteError', failed: 1});
    expect([...fake.held]).toEqual([`${prefix}/0`]);
    expect(fake.sent.filter((call) => call.name === 'DeleteObjectsCommand')).toHaveLength(3);
  });

  it('counts every failure of a batch, and a batch that is all failures deletes nothing and fails', async () => {
    const fake = fakeS3([`${prefix}/a`, `${prefix}/b`, `${prefix}/c`], {refuse: () => true});
    await expect(fake.storage.deletePrefix(prefix)).rejects.toMatchObject({name: 'PartialDeleteError', failed: 3});
    expect(fake.held.size).toBe(3);
  });

  it('names the failure by class and count only: no key, no Account, no store message in the error', async () => {
    const fake = fakeS3([prefix], {refuse: () => true});
    const error = (await fake.storage.deletePrefix(prefix).catch((caught: unknown) => caught)) as PartialDeleteError;
    expect(error.name).toBe('PartialDeleteError');
    for (const text of [error.message, String(error), JSON.stringify(error), error.stack ?? '']) {
      expect(text).not.toContain(ACCOUNT);
      expect(text).not.toContain(UPLOAD);
      expect(text).not.toContain('AccessDenied');
      expect(text).not.toContain('cannot delete');
    }
    expect(/^[A-Z][A-Za-z]{0,47}$/.test(error.name)).toBe(true);
  });

  it('lets a failure of the call itself through, and refuses a prefix that is not one of the bucket\'s, before it asks the store anything', async () => {
    await expect(fakeS3([prefix], {throwOn: 'DeleteObjectsCommand'}).storage.deletePrefix(prefix)).rejects.toMatchObject({name: 'InternalError'});
    const fake = fakeS3([prefix]);
    for (const bad of ['staging/', 'staging/../objects/x', `staging/${ACCOUNT}`, `staging/${ACCOUNT}/${UPLOAD}/`, `objects/${ACCOUNT}/not-hex`, `other/${ACCOUNT}/${UPLOAD}`, '']) {
      await expect(fake.storage.deletePrefix(bad), bad).rejects.toBeInstanceOf(TypeError);
    }
    expect(fake.sent).toEqual([]);
  });
});

describe('the keys of the bucket', () => {
  it('holds a key of the two layouts only: staging/<account>/<upload> and objects/<account>/<root> (a root is 64 hex characters)', async () => {
    const fake = fakeS3([]);
    const root = 'ab'.repeat(32);
    await expect(fake.storage.delete(`objects/${ACCOUNT}/${root}`)).resolves.toBeUndefined();
    await expect(fake.storage.copy(prefix, `objects/${ACCOUNT}/${root}`)).resolves.toBeUndefined();
    for (const bad of [`objects/${ACCOUNT}/${root.toUpperCase()}`, `objects/${ACCOUNT}/${root}0`, `objects/${ACCOUNT}/${root.slice(1)}`, `objects/../${root}`, `objects/${ACCOUNT}/../${root}`, 'staging', `objects/${ACCOUNT}`]) {
      await expect(fake.storage.delete(bad), bad).rejects.toBeInstanceOf(TypeError);
      await expect(fake.storage.copy(prefix, bad), bad).rejects.toBeInstanceOf(TypeError);
    }
    expect(fake.sent.map((call) => call.name)).toEqual(['DeleteObjectCommand', 'CopyObjectCommand']);
    expect(fake.sent[1].input).toMatchObject({Bucket: 'private-files', Key: `objects/${ACCOUNT}/${root}`, CopySource: `private-files/${prefix}`});
  });

  it('knows a missing object when the store says there is none', async () => {
    const missing = {send: async () => { throw Object.assign(new Error('x'), {name: 'NoSuchKey', $metadata: {httpStatusCode: 404}}); }} as unknown as S3Sender;
    await expect(createS3Storage(settings, missing).get(prefix, null)).rejects.toBeInstanceOf(MissingObject);
  });
});
