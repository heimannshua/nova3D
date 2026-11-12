// Helpers of a transfer: cutting a stream into chunks of at most the chunk size, reading a Range header, validating picture bytes, and reading a transfer handle.
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const pngIendChunk = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

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

/** Whether a PNG has a complete IEND chunk; established uploads may carry opaque trailer bytes after it. libvips can decode all pixels when IEND is missing. */
export function hasCompletePngEnd(bytes: Buffer): boolean {
  let offset = 8;
  while (offset <= bytes.length - 12) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const end = offset + 12 + length;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IEND') {
      return length === 0 && bytes.subarray(offset, end).equals(pngIendChunk);
    }
    offset = end;
  }
  return false;
}

type WebpChunk = {type: string; data: Buffer};
type WebpImageDimensions = {width: number; height: number};

function webpChunksWithin(bytes: Buffer, start: number, end: number): WebpChunk[] | null {
  const chunks: WebpChunk[] = [];
  let offset = start;
  while (offset < end) {
    if (end - offset < 8) return null;
    const type = bytes.toString('latin1', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const paddedLength = length + (length & 1);
    if (paddedLength > end - offset - 8) return null;
    chunks.push({type, data: bytes.subarray(offset + 8, offset + 8 + length)});
    offset += 8 + paddedLength;
  }
  return offset === end ? chunks : null;
}

function webpImageDimensions(type: string, data: Buffer): WebpImageDimensions | null {
  if (type === 'VP8 ') {
    if (data.length < 10 || (data[0] & 1) !== 0 || !data.subarray(3, 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return null;
    const width = data.readUInt16LE(6) & 0x3fff;
    const height = data.readUInt16LE(8) & 0x3fff;
    return width > 0 && height > 0 ? {width, height} : null;
  }
  if (type === 'VP8L') {
    if (data.length < 5 || data[0] !== 0x2f) return null;
    const bits = data.readUInt32LE(1);
    if ((bits >>> 29) !== 0) return null;
    return {width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1};
  }
  return null;
}

/** Checks the RIFF/chunk and still/animated image framing in the original WebP bytes. */
export function hasValidWebpStructure(input: Uint8Array): boolean {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return false;

  const riffSize = bytes.readUInt32LE(4);
  if (riffSize < 4 || riffSize > bytes.length - 8) return false;
  const riffEnd = 8 + riffSize;
  const chunks = webpChunksWithin(bytes, 12, riffEnd);
  if (!chunks) return false;

  const extended = chunks.filter((chunk) => chunk.type === 'VP8X');
  if (extended.length > 1 || (extended.length === 1 && (chunks[0] !== extended[0] || extended[0].data.length !== 10))) return false;
  const canvas = extended[0]?.data;
  const flags = canvas?.[0] ?? 0;
  if ((flags & 0xc1) !== 0 || (canvas && (canvas[1] !== 0 || canvas[2] !== 0 || canvas[3] !== 0))) return false;
  const canvasWidth = canvas ? canvas.readUIntLE(4, 3) + 1 : null;
  const canvasHeight = canvas ? canvas.readUIntLE(7, 3) + 1 : null;

  const animationChunks = chunks.filter((chunk) => chunk.type === 'ANIM');
  const frames = chunks.filter((chunk) => chunk.type === 'ANMF');
  const imageChunks = chunks.filter((chunk) => chunk.type === 'VP8 ' || chunk.type === 'VP8L');
  const alphaChunks = chunks.filter((chunk) => chunk.type === 'ALPH');
  const animated = (flags & 0x02) !== 0;

  if (extended.length === 0 && chunks.some((chunk) => ['ICCP', 'ALPH', 'EXIF', 'XMP ', 'ANIM', 'ANMF'].includes(chunk.type))) return false;

  if (animated) {
    if (animationChunks.length !== 1 || animationChunks[0].data.length !== 6 || imageChunks.length !== 0 || alphaChunks.length !== 0 || frames.length === 0) return false;
    const animationIndex = chunks.indexOf(animationChunks[0]);
    if (chunks.filter((chunk) => chunk.type === 'VP8X').length !== 1) return false;
    for (const frame of frames) {
      if (chunks.indexOf(frame) < animationIndex || frame.data.length < 16 || (frame.data[15] & 0xfc) !== 0) return false;
      const x = frame.data.readUIntLE(0, 3) * 2;
      const y = frame.data.readUIntLE(3, 3) * 2;
      const width = frame.data.readUIntLE(6, 3) + 1;
      const height = frame.data.readUIntLE(9, 3) + 1;
      if (x + width > canvasWidth! || y + height > canvasHeight!) return false;

      const nested = webpChunksWithin(frame.data, 16, frame.data.length);
      if (!nested) return false;
      const nestedImages = nested.filter((chunk) => chunk.type === 'VP8 ' || chunk.type === 'VP8L');
      const nestedAlpha = nested.filter((chunk) => chunk.type === 'ALPH');
      if (nestedImages.length !== 1 || nestedAlpha.length > 1) return false;
      if (nestedAlpha.length === 1 && (nestedImages[0].type !== 'VP8 ' || nested.indexOf(nestedAlpha[0]) > nested.indexOf(nestedImages[0]))) return false;
      const dimensions = webpImageDimensions(nestedImages[0].type, nestedImages[0].data);
      if (!dimensions || dimensions.width !== width || dimensions.height !== height) return false;
      if (nested.some((chunk) => chunk.type !== 'ALPH' && chunk.type !== 'VP8 ' && chunk.type !== 'VP8L')) return false;
    }
    return true;
  }

  if (animationChunks.length !== 0 || frames.length !== 0 || imageChunks.length !== 1 || alphaChunks.length > 1) return false;
  const image = imageChunks[0];
  if (alphaChunks.length === 1 && (image.type !== 'VP8 ' || chunks.indexOf(alphaChunks[0]) > chunks.indexOf(image))) return false;
  const dimensions = webpImageDimensions(image.type, image.data);
  if (!dimensions) return false;
  return canvasWidth === null || (canvasWidth === dimensions.width && canvasHeight === dimensions.height);
}

/** Fully decodes a declared picture without retaining decoded output; ordinary files remain opaque bytes. */
export async function validPicture(contentType: string, bytes: Buffer): Promise<boolean> {
  if (contentType === 'application/octet-stream') return true;
  if (contentType === 'image/png' && !hasCompletePngEnd(bytes)) return false;
  if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp') return false;
  if (contentType === 'image/webp' && !hasValidWebpStructure(bytes)) return false;
  try {
    await sharp(bytes, {animated: true, sequentialRead: true, failOn: 'error', limitInputPixels: 100_000_000}).stats();
    return true;
  } catch {
    return false;
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
