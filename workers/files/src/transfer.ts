// Pure helpers of a transfer: cutting a stream into chunks of at most the chunk size, reading a Range header, checking what a picture's first
// bytes say it is, and reading a transfer handle. No I/O, no clock, no logging.
import {createHash} from 'node:crypto';

/**
 * Cuts a stream into pieces of exactly `size` bytes (the last one shorter), whatever size the pieces it arrives in are. This is what makes "a
 * chunk of at most 1 MiB" true for a request body or a stored object that arrives in 16 KiB or 64 KiB reads: each piece yielded here is one chunk,
 * and the caller authorizes it before it is stored or sent.
 */
export async function* blocks(source: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let length = 0;
  for await (const piece of source) {
    let rest = Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength);
    while (rest.length > 0) {
      const take = Math.min(size - length, rest.length);
      pending.push(rest.subarray(0, take));
      length += take;
      rest = rest.subarray(take);
      if (length === size) {
        yield Buffer.concat(pending, length);
        pending = [];
        length = 0;
      }
    }
  }
  if (length > 0) yield Buffer.concat(pending, length);
}

/** What a `Range` header asks for of an object of `length` bytes: all of it, an inclusive byte range, or nothing that can be served. */
export type RangeRequest = {kind: 'whole'} | {kind: 'partial'; start: number; end: number} | {kind: 'unsatisfiable'};

/**
 * One byte range at most: `bytes=a-b`, `bytes=a-` and `bytes=-n`. No header is the whole object. Several ranges, a unit other than `bytes`, a range
 * that cannot be read and one that starts at or past the end are all `unsatisfiable` (416): the gateway serves one range per ticket and does not
 * guess what a malformed one meant.
 */
export function parseRange(header: string | undefined, length: number): RangeRequest {
  if (header === undefined) return {kind: 'whole'};
  const match = /^bytes=(\d{1,15})?-(\d{1,15})?$/.exec(header.trim());
  if (!match || (match[1] === undefined && match[2] === undefined)) return {kind: 'unsatisfiable'};
  if (match[1] === undefined) {
    // A suffix: the last n bytes.
    const suffix = Number(match[2]);
    if (suffix === 0 || length === 0) return {kind: 'unsatisfiable'};
    return {kind: 'partial', start: Math.max(0, length - suffix), end: length - 1};
  }
  const start = Number(match[1]);
  if (start >= length) return {kind: 'unsatisfiable'};
  const end = match[2] === undefined ? length - 1 : Number(match[2]);
  if (end < start) return {kind: 'unsatisfiable'};
  return {kind: 'partial', start, end: Math.min(end, length - 1)};
}

const startsWith = (head: Uint8Array, bytes: number[], offset = 0) => head.length >= offset + bytes.length && bytes.every((byte, index) => head[offset + index] === byte);

/**
 * Whether the leading bytes of an upload are what its declared content type says: a JPEG starts FF D8 FF, a PNG with its eight-byte signature, a
 * WebP with `RIFF`, four bytes of size and `WEBP`. Any other content type (the opaque `application/octet-stream` of a file) has no signature to check.
 */
export function leadingBytesMatch(contentType: string, head: Uint8Array): boolean {
  switch (contentType) {
    case 'image/jpeg':
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8);
    default:
      return true;
  }
}

/** A handle in a URL is 32 random bytes in base64url (43 characters). Its SHA-256 is what the database holds; null when it is not shaped like one. */
export function handleHashOf(handle: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) return null;
  const bytes = Buffer.from(handle, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== handle) return null;
  return createHash('sha256').update(bytes).digest();
}

/** A fresh handle: the text for a URL, and the hash the database stores. */
export function newHandle(random: (size: number) => Buffer): {handle: string; hash: Buffer} {
  const bytes = random(32);
  return {handle: bytes.toString('base64url'), hash: createHash('sha256').update(bytes).digest()};
}
