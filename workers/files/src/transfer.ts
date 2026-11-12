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

const WEBP_MAX_CHUNKS = 10_000;
const WEBP_MAX_FRAMES = 4_096;
const RIFF = 0x46464952;
const WEBP = 0x50424557;
const VP8X = 0x58385056;
const VP8 = 0x20385056;
const VP8L = 0x4c385056;
const ALPH = 0x48504c41;
const ANIM = 0x4d494e41;
const ANMF = 0x464d4e41;
const ICCP = 0x50434349;
const EXIF = 0x46495845;
const XMP = 0x20504d58;

export type WebpStructureCheck = {valid: boolean; chunksVisited: number; framesVisited: number};

function webpImageMatches(bytes: Buffer, type: number, start: number, length: number, expectedWidth: number | null, expectedHeight: number | null): boolean {
  let width: number;
  let height: number;
  if (type === VP8) {
    if (length < 10 || (bytes[start] & 1) !== 0 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return false;
    width = bytes.readUInt16LE(start + 6) & 0x3fff;
    height = bytes.readUInt16LE(start + 8) & 0x3fff;
  } else if (type === VP8L) {
    if (length < 5 || bytes[start] !== 0x2f) return false;
    const bits = bytes.readUInt32LE(start + 1);
    if ((bits >>> 29) !== 0) return false;
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else {
    return false;
  }
  return width > 0 && height > 0 && (expectedWidth === null || width === expectedWidth) && (expectedHeight === null || height === expectedHeight);
}

/** Bounded O(1) parser diagnostics for unit tests; runtime upload responses expose only the boolean validation result. */
export function inspectWebpStructure(input: Uint8Array): WebpStructureCheck {
  let chunksVisited = 0;
  let framesVisited = 0;
  const result = (valid: boolean): WebpStructureCheck => ({valid, chunksVisited, framesVisited});
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 12 || bytes.readUInt32LE(0) !== RIFF || bytes.readUInt32LE(8) !== WEBP) return result(false);

  const riffSize = bytes.readUInt32LE(4);
  if (riffSize < 4 || riffSize > bytes.length - 8) return result(false);
  const riffEnd = 8 + riffSize;
  let cursor = 12;
  let hasVp8x = false;
  let flags = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let sawExtended = false;
  let animationChunks = 0;
  let imageChunks = 0;
  let imageType = 0;
  let imageWidth = 0;
  let imageHeight = 0;
  let alphaChunks = 0;

  while (cursor < riffEnd) {
    if (chunksVisited >= WEBP_MAX_CHUNKS || riffEnd - cursor < 8) return result(false);
    const type = bytes.readUInt32LE(cursor);
    const length = bytes.readUInt32LE(cursor + 4);
    const dataStart = cursor + 8;
    const padLength = length & 1;
    if (length > riffEnd - dataStart - padLength) return result(false);
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + padLength;
    if (padLength !== 0 && bytes[dataEnd] !== 0x00) return result(false);
    chunksVisited += 1;

    if (type === VP8X) {
      if (hasVp8x || chunksVisited !== 1 || length !== 10) return result(false);
      hasVp8x = true;
      flags = bytes[dataStart];
      if ((flags & 0xc1) !== 0 || bytes[dataStart + 1] !== 0 || bytes[dataStart + 2] !== 0 || bytes[dataStart + 3] !== 0) return result(false);
      canvasWidth = bytes.readUIntLE(dataStart + 4, 3) + 1;
      canvasHeight = bytes.readUIntLE(dataStart + 7, 3) + 1;
    } else if (type === ICCP || type === ALPH || type === EXIF || type === XMP || type === ANIM || type === ANMF) {
      sawExtended = true;
      if (type === ANIM) {
        animationChunks += 1;
        if (animationChunks !== 1 || length !== 6) return result(false);
      } else if (type === ANMF) {
        if (!hasVp8x || (flags & 0x02) === 0 || animationChunks !== 1 || imageChunks !== 0 || alphaChunks !== 0) return result(false);
        if (framesVisited >= WEBP_MAX_FRAMES || length < 16 || (bytes[dataStart + 15] & 0xfc) !== 0) return result(false);
        framesVisited += 1;
        const frameX = bytes.readUIntLE(dataStart, 3) * 2;
        const frameY = bytes.readUIntLE(dataStart + 3, 3) * 2;
        const frameWidth = bytes.readUIntLE(dataStart + 6, 3) + 1;
        const frameHeight = bytes.readUIntLE(dataStart + 9, 3) + 1;
        if (frameX + frameWidth > canvasWidth || frameY + frameHeight > canvasHeight) return result(false);

        let nestedCursor = dataStart + 16;
        let nestedImageCount = 0;
        let nestedImageType = 0;
        let nestedAlphaCount = 0;
        while (nestedCursor < dataEnd) {
          if (chunksVisited >= WEBP_MAX_CHUNKS || dataEnd - nestedCursor < 8) return result(false);
          const nestedType = bytes.readUInt32LE(nestedCursor);
          const nestedLength = bytes.readUInt32LE(nestedCursor + 4);
          const nestedStart = nestedCursor + 8;
          const nestedPadLength = nestedLength & 1;
          if (nestedLength > dataEnd - nestedStart - nestedPadLength) return result(false);
          const nestedDataEnd = nestedStart + nestedLength;
          const nestedEnd = nestedDataEnd + nestedPadLength;
          if (nestedPadLength !== 0 && bytes[nestedDataEnd] !== 0x00) return result(false);
          chunksVisited += 1;
          if (nestedType === ALPH) {
            nestedAlphaCount += 1;
            if (nestedAlphaCount !== 1 || nestedImageCount !== 0) return result(false);
          } else if (nestedType === VP8 || nestedType === VP8L) {
            nestedImageCount += 1;
            if (nestedImageCount !== 1 || !webpImageMatches(bytes, nestedType, nestedStart, nestedLength, frameWidth, frameHeight)) return result(false);
            nestedImageType = nestedType;
          } else {
            return result(false);
          }
          nestedCursor = nestedEnd;
        }
        if (nestedCursor !== dataEnd || nestedImageCount !== 1 || (nestedAlphaCount !== 0 && nestedImageType !== VP8)) return result(false);
      } else if (type === ALPH) {
        alphaChunks += 1;
        if (alphaChunks !== 1 || imageChunks !== 0) return result(false);
      }
    } else if (type === VP8 || type === VP8L) {
      imageChunks += 1;
      if (imageChunks !== 1 || !webpImageMatches(bytes, type, dataStart, length, null, null)) return result(false);
      imageType = type;
      if (type === VP8) {
        imageWidth = bytes.readUInt16LE(dataStart + 6) & 0x3fff;
        imageHeight = bytes.readUInt16LE(dataStart + 8) & 0x3fff;
      } else {
        const bits = bytes.readUInt32LE(dataStart + 1);
        imageWidth = (bits & 0x3fff) + 1;
        imageHeight = ((bits >>> 14) & 0x3fff) + 1;
      }
    }
    cursor = chunkEnd;
  }

  if (cursor !== riffEnd || (!hasVp8x && sawExtended)) return result(false);
  if ((flags & 0x02) !== 0) return result(animationChunks === 1 && framesVisited > 0 && imageChunks === 0 && alphaChunks === 0);
  if (animationChunks !== 0 || framesVisited !== 0 || imageChunks !== 1 || alphaChunks > 1 || (alphaChunks !== 0 && imageType !== VP8)) return result(false);
  return result(!hasVp8x || (canvasWidth === imageWidth && canvasHeight === imageHeight));
}

/** Checks WebP structure using a bounded scalar-cursor walk over the original bytes. */
export function hasValidWebpStructure(input: Uint8Array): boolean {
  return inspectWebpStructure(input).valid;
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
