// Story 2.12. The metadata strip: what the gateway's `attach` command does to a staged picture before it is published as a retained root.
//
// Pure: a picture goes in and a picture comes out, with no I/O, no clock, no randomness and no logging, and the same bytes in always give the same bytes out
// (so the SHA-256 of the result, and the manifest root built from it, are reproducible: a repeated attach finds the same manifest). The one import is
// `node:zlib`'s `crc32`, which a PNG chunk needs.
//
// WHAT IT KEEPS. Everything that decodes the picture, byte for byte, in the order it was found; nothing is re-encoded, resized or recompressed, so the pixel data is
// exactly the original's. Everything else is removed, and a picture whose structure cannot be read is REFUSED (`StripError`): an unstripped copy is never produced.
//   JPEG  the start and end markers and every segment that decodes the image: DQT, SOFn, DHT, DAC, DRI, DNL, DHP, EXP, SOS with its entropy-coded data (byte
//         stuffing and restart markers included) and the Adobe APP14 segment (the colour transform of a CMYK or YCCK picture). Every other APPn (JFIF, EXIF, XMP,
//         ICC, FlashPix, MPF, Photoshop and IPTC) and every COM segment is dropped, and so is anything after the end marker. (An Adobe segment is cut to the 12
//         bytes a decoder reads, so it can hold nothing else.) A marker this module does not know
//         (a reserved one, or a JPGn extension) makes the picture unreadable: it could be carrying anything.
//   PNG   IHDR, PLTE, tRNS, IDAT, IEND, gAMA, cHRM, sRGB, sBIT, bKGD and the animation chunks acTL, fcTL, fdAT, with their own CRCs. Every other chunk (tEXt, zTXt,
//         iTXt, tIME, eXIf, iCCP, pHYs, sPLT, hIST, and private ones) is dropped, and so are the bytes after IEND.
//   WebP  a simple file (a lone VP8 or VP8L image) holds no metadata and passes unchanged. With a VP8X header: VP8X, VP8, VP8L, ALPH, ANIM and ANMF are kept; ICCP,
//         EXIF, XMP and unknown chunks are dropped, their VP8X flags are cleared and the RIFF size is rewritten.
//
// THE ONE THING THAT SURVIVES is the EXIF orientation (tag 0x0112, a value from 1 to 8), because a browser and every later step apply it to show the picture the
// right way up. It is read from the original EXIF (every offset checked against the data) and written back as a MINIMAL orientation-only EXIF block of 26 bytes of
// TIFF stream (little-endian, one directory with one entry): an APP1 segment of 36 bytes right after the start marker for a JPEG, an `eXIf` chunk right before the
// first IDAT for a PNG, an `EXIF` chunk after the image data (and the EXIF flag of the VP8X header) for a WebP. No other tag survives, and no GPS data, no thumbnail
// and no maker note. A picture with no readable orientation gets no EXIF block at all.
//
// Reading is defensive throughout: every length and offset is checked against the data before it is used, every loop advances by at least one byte, the output
// is never more than a few dozen bytes longer than the input, and a message carries a fixed sentence and never a byte of the picture.
import {crc32} from 'node:zlib';

/** The picture cannot be stripped: it is truncated, not what its type says, or built in a way this module does not understand. The reason is a fixed sentence. */
export class StripError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'StripError';
    this.reason = reason;
  }
}

const fail = (reason: string): never => {
  throw new StripError(reason);
};

const u16be = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const u32be = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const u32le = (bytes: Uint8Array, at: number) => ((bytes[at + 3] << 24) | (bytes[at + 2] << 16) | (bytes[at + 1] << 8) | bytes[at]) >>> 0;

/** Four bytes as text (a chunk type). */
const tagAt = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

// The orientation block ----------------------------------------------------------------------------------------------------

/**
 * The orientation (1 to 8) in a TIFF stream that occupies `data[start, end)`: the byte-order mark, the offset of the first directory, and in that directory the
 * entry with tag 0x0112 (type SHORT, count 1). Anything out of range, truncated or not exactly that is `null`. Only the first directory is read.
 */
function tiffOrientation(data: Uint8Array, start: number, end: number): number | null {
  if (end - start < 8) return null;
  const little = data[start] === 0x49 && data[start + 1] === 0x49 && data[start + 2] === 0x2a && data[start + 3] === 0x00;
  const big = data[start] === 0x4d && data[start + 1] === 0x4d && data[start + 2] === 0x00 && data[start + 3] === 0x2a;
  if (!little && !big) return null;
  const short = (at: number) => (little ? data[at] | (data[at + 1] << 8) : (data[at] << 8) | data[at + 1]);
  const long = (at: number) => (little ? u32le(data, at) : u32be(data, at));
  const offset = long(start + 4);
  // The directory must start inside the stream, after the header, and hold its count and every one of its entries.
  if (offset < 8 || offset > end - start - 2) return null;
  const directory = start + offset;
  const count = short(directory);
  if (count < 1 || directory + 2 + count * 12 > end) return null;
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12;
    if (short(entry) !== 0x0112) continue;
    // SHORT (3), one value: it sits in the first two bytes of the entry's value field.
    if (short(entry + 2) !== 3 || long(entry + 4) !== 1) return null;
    const value = short(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/** The 26 bytes of the minimal orientation-only TIFF stream: little-endian, one directory, one entry (tag 0x0112, SHORT, count 1), no next directory. */
function orientationTiff(orientation: number): Buffer {
  return Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // 'II', 42, the directory is at offset 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, // tag 0x0112, SHORT, count 1, the value left-justified in its four bytes
    0x00, 0x00, 0x00, 0x00, // no next directory
  ]);
}

const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // 'Exif\0\0'
const hasExifHeader = (data: Uint8Array, at: number, end: number) => end - at >= exifHeader.length && exifHeader.every((byte, index) => data[at + index] === byte);

// JPEG ----------------------------------------------------------------------------------------------------------------------

/** What a JPEG walk keeps, in order: a range of the original, or (for an Adobe segment that is longer than the 12 bytes a decoder reads) the bytes that replace it. */
type JpegWalk = {orientation: number | null; kept: (readonly [number, number] | Uint8Array)[]};

const adobe = [0x41, 0x64, 0x6f, 0x62, 0x65]; // 'Adobe'
const adobeBytes = 12;

/**
 * Walks the segments of a JPEG from the start marker to the end marker, collecting the byte ranges to keep and the orientation. With `untilScan` it stops at the first
 * scan header (all the metadata comes before it), which is how the orientation of a picture is read without checking the rest. Anything unreadable throws a StripError.
 */
function walkJpeg(bytes: Uint8Array, walk: JpegWalk, untilScan: boolean): void {
  const size = bytes.length;
  if (size < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('The picture is not a JPEG.');
  let position = 2;
  let sawFrame = false;
  let sawScan = false;
  for (;;) {
    // A marker is 0xFF, then any number of 0xFF fill bytes, then its code. The fill bytes are not kept.
    if (position >= size || bytes[position] !== 0xff) fail('The JPEG is truncated or damaged.');
    let code = position + 1;
    while (code < size && bytes[code] === 0xff) code += 1;
    if (code >= size) fail('The JPEG is truncated.');
    const marker = bytes[code];
    const start = code - 1;
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan) fail('The JPEG holds no image.');
      return;
    }
    if (marker === 0x00 || marker === 0xd8) fail('The JPEG is damaged.');
    // The markers with no length: TEM and the restart markers (which belong inside a scan, and are harmless between segments).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      walk.kept.push([start, code + 1]);
      position = code + 1;
      continue;
    }
    if (code + 3 > size) fail('The JPEG is truncated.');
    const length = u16be(bytes, code + 1);
    if (length < 2) fail('The JPEG is damaged.');
    const payload = code + 3;
    const end = code + 1 + length;
    if (end > size) fail('A JPEG segment runs past the end of the file.');

    if (marker >= 0xe0 && marker <= 0xef) {
      // An application segment is metadata, whatever it says, except Adobe's colour transform: 'Adobe', the version, two flags and the transform byte, 12 bytes
      // in all, which is every byte a decoder reads of it. A segment that says more is cut to those 12 (and its length rewritten), so it can hold nothing else; one
      // that says less is no Adobe segment to a decoder, and is dropped.
      if (marker === 0xee && end - payload >= adobeBytes && adobe.every((byte, index) => bytes[payload + index] === byte)) {
        if (end - payload === adobeBytes) walk.kept.push([start, end]);
        else walk.kept.push(Buffer.concat([Buffer.from([0xff, 0xee, 0x00, 0x02 + adobeBytes]), bytes.subarray(payload, payload + adobeBytes)]));
      } else if (marker === 0xe1 && walk.orientation === null && hasExifHeader(bytes, payload, end)) walk.orientation = tiffOrientation(bytes, payload + exifHeader.length, end);
      position = end;
      continue;
    }
    if (marker === 0xfe) {
      position = end;
      continue;
    }
    if (marker === 0xda) {
      if (untilScan) return;
      if (!sawFrame) fail('The JPEG has a scan before its frame.');
      sawScan = true;
      // The entropy-coded data follows the header up to the next real marker: 0xFF00 is a stuffed byte and 0xFFD0 to 0xFFD7 a restart marker, and both are data.
      let scan = end;
      for (;;) {
        const found = bytes.indexOf(0xff, scan);
        if (found < 0) fail('The JPEG is truncated.');
        let next = found + 1;
        while (next < size && bytes[next] === 0xff) next += 1;
        if (next >= size) fail('The JPEG is truncated.');
        const follower = bytes[next];
        if (follower === 0x00 || (follower >= 0xd0 && follower <= 0xd7)) {
          scan = next + 1;
          continue;
        }
        scan = next - 1;
        break;
      }
      walk.kept.push([start, scan]);
      position = scan;
      continue;
    }
    // The frame headers (SOF0 to SOF15 but DHT, JPG and DAC), the tables (DHT, DAC, DQT, DRI), DNL, DHP and EXP: everything the decoder needs.
    const decodes = (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) || marker === 0xdb || marker === 0xdc || marker === 0xdd || marker === 0xde || marker === 0xdf;
    if (!decodes) fail('The JPEG has a segment this check does not know.');
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) sawFrame = true;
    walk.kept.push([start, end]);
    position = end;
  }
}

function stripJpeg(bytes: Uint8Array): Buffer {
  const walk: JpegWalk = {orientation: null, kept: []};
  walkJpeg(bytes, walk, false);
  const parts: Uint8Array[] = [Buffer.from([0xff, 0xd8])];
  if (walk.orientation !== null) {
    // APP1, length 34 (itself, 'Exif\0\0' and 26 bytes of TIFF): 36 bytes with the marker.
    parts.push(Buffer.from([0xff, 0xe1, 0x00, 0x22, ...exifHeader]), orientationTiff(walk.orientation));
  }
  for (const entry of walk.kept) parts.push(entry instanceof Uint8Array ? entry : bytes.subarray(entry[0], entry[1]));
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function orientationOfJpeg(bytes: Uint8Array): number | null {
  const walk: JpegWalk = {orientation: null, kept: []};
  try {
    walkJpeg(bytes, walk, true);
  } catch {
    // What was found before the damage stands.
  }
  return walk.orientation;
}

// PNG -----------------------------------------------------------------------------------------------------------------------

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngKept = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'acTL', 'fcTL', 'fdAT']);

type PngChunk = {type: string; start: number; end: number};
type PngWalk = {orientation: number | null; chunks: PngChunk[]};

const isLetter = (byte: number) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);

/** Walks the chunks of a PNG from the signature to IEND (the bytes after it are not read), collecting where each is and the orientation of the first eXIf chunk. */
function walkPng(bytes: Uint8Array, walk: PngWalk): void {
  const size = bytes.length;
  if (size < 8 + 12 + 13 || !pngSignature.every((byte, index) => bytes[index] === byte)) fail('The picture is not a PNG.');
  let position = 8;
  for (;;) {
    if (position + 12 > size) fail('The PNG is truncated.');
    const length = u32be(bytes, position);
    // A chunk's length is at most 2^31 - 1, and its data, type and CRC must lie inside the file.
    if (length > 0x7fffffff || position + 12 + length > size) fail('A PNG chunk runs past the end of the file.');
    if (!isLetter(bytes[position + 4]) || !isLetter(bytes[position + 5]) || !isLetter(bytes[position + 6]) || !isLetter(bytes[position + 7])) fail('The PNG is damaged.');
    const type = tagAt(bytes, position + 4);
    const end = position + 12 + length;
    if (walk.chunks.length === 0 && (type !== 'IHDR' || length !== 13)) fail('The PNG does not start with its header.');
    if (walk.chunks.length > 0 && type === 'IHDR') fail('The PNG has two headers.');
    if (type === 'eXIf' && walk.orientation === null) {
      const data = position + 8;
      walk.orientation = tiffOrientation(bytes, hasExifHeader(bytes, data, data + length) ? data + exifHeader.length : data, data + length);
    }
    walk.chunks.push({type, start: position, end});
    if (type === 'IEND') {
      if (length !== 0) fail('The PNG is damaged.');
      return;
    }
    position = end;
  }
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  chunk.set(data, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function stripPng(bytes: Uint8Array): Buffer {
  const walk: PngWalk = {orientation: null, chunks: []};
  walkPng(bytes, walk);
  if (!walk.chunks.some((chunk) => chunk.type === 'IDAT')) fail('The PNG holds no image.');
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let written = false;
  for (const chunk of walk.chunks) {
    // The orientation goes right before the first IDAT, where a reader that stops at the image data has already read it.
    if (chunk.type === 'IDAT' && !written && walk.orientation !== null) {
      parts.push(pngChunk('eXIf', orientationTiff(walk.orientation)));
      written = true;
    }
    if (pngKept.has(chunk.type)) parts.push(bytes.subarray(chunk.start, chunk.end));
  }
  return Buffer.concat(parts);
}

function orientationOfPng(bytes: Uint8Array): number | null {
  const walk: PngWalk = {orientation: null, chunks: []};
  try {
    walkPng(bytes, walk);
  } catch {
    // What was found before the damage stands.
  }
  return walk.orientation;
}

// WebP ----------------------------------------------------------------------------------------------------------------------

const webpKept = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF']);

/** `start` is the chunk's header, `payload` and `payloadEnd` bound its data, and `end` includes the padding byte of an odd size when the file has it. */
type WebpChunk = {type: string; start: number; payload: number; payloadEnd: number; end: number};
type WebpWalk = {orientation: number | null; extent: number; chunks: WebpChunk[]};

/** Walks the chunks of a WebP inside its RIFF extent (the bytes after it are not read), collecting where each is and the orientation of the first EXIF chunk. */
function walkWebp(bytes: Uint8Array, walk: WebpWalk): void {
  const size = bytes.length;
  if (size < 12 + 8 || tagAt(bytes, 0) !== 'RIFF' || tagAt(bytes, 8) !== 'WEBP') fail('The picture is not a WebP.');
  const declared = u32le(bytes, 4);
  if (declared < 4 + 8 || declared + 8 > size) fail('The WebP is truncated.');
  const extent = declared + 8;
  walk.extent = extent;
  let position = 12;
  while (position < extent) {
    if (position + 8 > extent) fail('The WebP is truncated.');
    const length = u32le(bytes, position + 4);
    const payload = position + 8;
    const payloadEnd = payload + length;
    if (payloadEnd > extent) fail('A WebP chunk runs past the end of the file.');
    // An odd size is followed by one padding byte; the last chunk of a file that left it out is accepted.
    const end = Math.min(payloadEnd + (length & 1), extent);
    const type = tagAt(bytes, position);
    if (type === 'EXIF' && walk.orientation === null) {
      walk.orientation = tiffOrientation(bytes, hasExifHeader(bytes, payload, payloadEnd) ? payload + exifHeader.length : payload, payloadEnd);
    }
    walk.chunks.push({type, start: position, payload, payloadEnd, end});
    position = end;
  }
  if (walk.chunks.length === 0) fail('The WebP holds no image.');
}

/** A chunk as the output writes it: its header and data, and the padding byte of an odd size (the file's own, or zero when it had none). */
function webpChunkBytes(bytes: Uint8Array, chunk: WebpChunk): Buffer {
  const length = chunk.payloadEnd - chunk.start;
  const out = Buffer.alloc(length + ((chunk.payloadEnd - chunk.payload) & 1));
  out.set(bytes.subarray(chunk.start, chunk.payloadEnd), 0);
  if (chunk.end > chunk.payloadEnd) out[length] = bytes[chunk.payloadEnd];
  return out;
}

function stripWebp(bytes: Uint8Array): Buffer {
  const walk: WebpWalk = {orientation: null, extent: 0, chunks: []};
  walkWebp(bytes, walk);
  const first = walk.chunks[0];
  const riff = (body: Uint8Array[]) => {
    const out = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP', 'latin1'), ...body]);
    out.writeUInt32LE(out.length - 8, 4);
    return out;
  };

  // A simple file: one image chunk, VP8 or VP8L, and no header that could announce anything else. It holds no metadata and passes unchanged: the file is rebuilt from
  // its one chunk, which is the same bytes for a well-formed file. (A chunk after the image in a file with no VP8X is announced by nothing and read by no decoder, so
  // it is not kept; neither are bytes after the end of the RIFF.)
  if (first.type === 'VP8 ' || first.type === 'VP8L') return riff([webpChunkBytes(bytes, first)]);
  if (first.type !== 'VP8X' || first.payloadEnd - first.payload < 10) fail('The WebP does not start with an image or its header.');

  const body: Uint8Array[] = [];
  let images = 0;
  for (const [index, chunk] of walk.chunks.entries()) {
    if (chunk.type === 'VP8X' && index > 0) fail('The WebP has two headers.');
    if (!webpKept.has(chunk.type)) continue;
    const out = webpChunkBytes(bytes, chunk);
    if (chunk.type === 'VP8X') {
      // The flags byte: ICC profile (0x20), EXIF (0x08) and XMP (0x04) are gone; alpha (0x10) and animation (0x02) are what they were.
      out[8] &= ~(0x20 | 0x08 | 0x04);
      if (walk.orientation !== null) out[8] |= 0x08;
    }
    if (chunk.type === 'VP8 ' || chunk.type === 'VP8L' || chunk.type === 'ANMF') images += 1;
    body.push(out);
  }
  if (images === 0) fail('The WebP holds no image.');
  if (walk.orientation !== null) {
    const exif = Buffer.alloc(8 + 26);
    exif.write('EXIF', 0, 'latin1');
    exif.writeUInt32LE(26, 4);
    exif.set(orientationTiff(walk.orientation), 8);
    body.push(exif);
  }
  return riff(body);
}

function orientationOfWebp(bytes: Uint8Array): number | null {
  const walk: WebpWalk = {orientation: null, extent: 0, chunks: []};
  try {
    walkWebp(bytes, walk);
  } catch {
    // What was found before the damage stands.
  }
  return walk.orientation;
}

// The two functions ---------------------------------------------------------------------------------------------------------

/**
 * The picture without any metadata but its EXIF orientation: see the top of this file for what is kept and what is removed. `contentType` is `image/jpeg`,
 * `image/png` or `image/webp`; anything else, a picture that is not what its type says, and a picture that cannot be read to its end are a StripError.
 * The same bytes always give the same bytes.
 */
export function stripPictureMetadata(contentType: string, bytes: Uint8Array): Buffer {
  switch (contentType) {
    case 'image/jpeg':
      return stripJpeg(bytes);
    case 'image/png':
      return stripPng(bytes);
    case 'image/webp':
      return stripWebp(bytes);
    default:
      return fail('The picture is not a JPEG, a PNG or a WebP.');
  }
}

/**
 * The EXIF orientation (1 to 8) of the ORIGINAL picture, or null when it has none, has an invalid one, or is not readable. Every offset is checked against the data
 * and nothing is thrown.
 */
export function readOrientation(contentType: string, bytes: Uint8Array): number | null {
  try {
    switch (contentType) {
      case 'image/jpeg':
        return orientationOfJpeg(bytes);
      case 'image/png':
        return orientationOfPng(bytes);
      case 'image/webp':
        return orientationOfWebp(bytes);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
