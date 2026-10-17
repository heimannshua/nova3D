// The gateway's Storage: the private bucket `private-files` through the S3 protocol, with the gateway's OWN key pair (Supabase cannot scope a key
// below the project, and the key bypasses row policies, which is why nothing but the gateway holds one). Every key is built by the caller from
// validated parts (UUIDs and hex), never from caller text: this module takes a key and trusts it to be one, and refuses a key that is not
// shaped like one of the two the bucket holds.
//
//   staging/<account>/<upload>      a verified upload, until it is attached or its lease is removed
//   objects/<account>/<root>        an attached file, copied here from staging under its manifest's ROOT: the SHA-256 of the manifest body, which holds
//                                   the upload's own ID, so every attach has a key of its own (two uploads of the same bytes are two objects)
//
// Uploads are multipart (lib-storage), streamed from the request with no whole body in memory; a failed or aborted upload is aborted with its
// parts. Downloads are streamed with an optional byte range. Nothing here returns a signed URL, and nothing logs.
import {Readable} from 'node:stream';
import {CopyObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, S3Client} from '@aws-sdk/client-s3';
import {Upload} from '@aws-sdk/lib-storage';

export const bucketName = 'private-files';

const keyPattern = /^(?:staging|objects)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})$/;
const prefixPattern = /^(?:staging|objects)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64})$/;

export type ByteRange = {start: number; end: number};

export type StoredBody = {
  /** The bytes, in order. */
  body: AsyncIterable<Uint8Array>;
  /** How many bytes the store is sending. */
  length: number;
  /** Stops the read (the client went away, or access ended). */
  cancel(): void;
};

export type GatewayStorage = {
  /** Streams a body into `key` (multipart). Rejects, and leaves no object and no parts, when the stream throws or `signal` aborts. */
  put(key: string, body: AsyncIterable<Uint8Array>, options: {contentType: string; signal?: AbortSignal}): Promise<void>;
  /** Opens `key` for reading, the whole object or an inclusive byte range. Rejects with `MissingObject` when there is none. */
  get(key: string, range: ByteRange | null): Promise<StoredBody>;
  /** Copies an object inside the bucket. */
  copy(from: string, to: string): Promise<void>;
  /** Deletes one object (no error when it is not there). */
  delete(key: string): Promise<void>;
  /** Deletes the objects whose key is exactly `prefix` or begins with `prefix/`, and says how many. The prefix is a validated key. */
  deletePrefix(prefix: string): Promise<number>;
};

/**
 * A batch delete answered 200 with some keys it could not delete (S3 reports each failure in the body of a successful answer). Only the NUMBER of keys
 * is kept: a key holds an Account's ID, and this error is printed and recorded by name.
 */
export class PartialDeleteError extends Error {
  readonly failed: number;
  constructor(failed: number) {
    super('the store could not delete some of the objects');
    this.name = 'PartialDeleteError';
    this.failed = failed;
  }
}

export class MissingObject extends Error {
  constructor() {
    super('the object is not in the store');
    this.name = 'MissingObject';
  }
}

export type S3Settings = {endpoint: string; region: string; accessKeyId: string; secretAccessKey: string};

const missing = (error: unknown) => {
  const {name, $metadata} = (error ?? {}) as {name?: unknown; $metadata?: {httpStatusCode?: unknown}};
  return name === 'NoSuchKey' || name === 'NotFound' || $metadata?.httpStatusCode === 404;
};

/** The part of an S3 client the storage uses: the real one, or a test's fake that answers as the store would. */
export type S3Sender = Pick<S3Client, 'send'>;

export function createS3Storage(settings: S3Settings, sender?: S3Sender): GatewayStorage {
  const real = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: {accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey},
    forcePathStyle: true,
    // S3-compatible stores do not all accept the checksum trailers the SDK adds by default; this one is asked for only where S3 itself requires it.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
  const client: S3Sender = sender ?? real;
  const checked = (key: string) => {
    if (!keyPattern.test(key)) throw new TypeError('not a key of this bucket');
    return key;
  };

  return {
    async put(key, body, options) {
      const upload = new Upload({
        client: real,
        params: {Bucket: bucketName, Key: checked(key), Body: Readable.from(body, {objectMode: false}), ContentType: options.contentType},
        // Two parts in flight of 8 MiB each: a few tens of MiB of memory for one upload, however large the file.
        queueSize: 2,
        partSize: 8 * 1024 * 1024,
        leavePartsOnError: false,
      });
      const abort = () => void upload.abort().catch(() => undefined);
      options.signal?.addEventListener('abort', abort, {once: true});
      try {
        await upload.done();
      } catch (error) {
        await upload.abort().catch(() => undefined);
        throw error;
      } finally {
        options.signal?.removeEventListener('abort', abort);
      }
    },

    async get(key, range) {
      const controller = new AbortController();
      try {
        const result = await client.send(
          new GetObjectCommand({Bucket: bucketName, Key: checked(key), ...(range ? {Range: `bytes=${range.start}-${range.end}`} : {})}),
          {abortSignal: controller.signal},
        );
        const stream = result.Body as Readable | undefined;
        if (!stream || typeof result.ContentLength !== 'number') throw new Error('the store answered without a body');
        return {body: stream, length: result.ContentLength, cancel: () => controller.abort()};
      } catch (error) {
        if (missing(error)) throw new MissingObject();
        throw error;
      }
    },

    async copy(from, to) {
      await client.send(new CopyObjectCommand({Bucket: bucketName, Key: checked(to), CopySource: `${bucketName}/${checked(from)}`}));
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({Bucket: bucketName, Key: checked(key)}));
    },

    async deletePrefix(prefix) {
      if (!prefixPattern.test(prefix)) throw new TypeError('not a prefix of this bucket');
      let deleted = 0;
      let failed = 0;
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({Bucket: bucketName, Prefix: prefix, ContinuationToken: token}));
        // Exactly this prefix: the key itself, or something beneath `prefix/`. A key that merely starts with the same characters is not ours to delete.
        const keys = (page.Contents ?? []).map((object) => object.Key).filter((key): key is string => typeof key === 'string' && (key === prefix || key.startsWith(`${prefix}/`)));
        if (keys.length > 0) {
          const answer = await client.send(new DeleteObjectsCommand({Bucket: bucketName, Delete: {Objects: keys.map((Key) => ({Key})), Quiet: true}}));
          // A quiet batch delete answers 200 and reports each key it could not delete in `Errors`: those are failures, not deletions.
          const refused = answer.Errors?.length ?? 0;
          failed += refused;
          deleted += keys.length - refused;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      // Every page was tried (what could go, went), and then the call fails: the caller must not call the prefix deleted, and the next run tries again.
      if (failed > 0) throw new PartialDeleteError(failed);
      return deleted;
    },
  };
}
