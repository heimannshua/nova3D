// Synthetic picture FILE HEADERS for the tests of `imageDimensions` and of the decoder's size check (Story 2.3): the first bytes of a PNG, a JPEG and a WebP
// (lossy, lossless and extended) built from the layouts in the formats' specifications, never from a file, so the sizes they state are known by construction.

const bigEndian32 = (value: number) => [Math.floor(value / 0x1000000) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const bigEndian16 = (value: number) => [(value >>> 8) & 0xff, value & 0xff];
const littleEndian16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const littleEndian24 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
const text = (value: string) => [...value].map((character) => character.charCodeAt(0));

/** A PNG's signature and IHDR chunk (length, type, width, height, depth 8, RGBA, no interlace, and a placeholder checksum), then `extra` bytes of "data". */
export function png(width: number, height: number, extra = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...bigEndian32(13), ...text('IHDR'), ...bigEndian32(width), ...bigEndian32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ...new Array<number>(extra).fill(0),
  ]);
}

/**
 * A JPEG: the start of image, an APP0 (JFIF) segment, `before` segments (each already a marker, a length and a payload) and then a start-of-frame `marker` (baseline
 * 0xc0 by default; progressive is 0xc2) that states the size, three components, and a start of scan.
 */
export function jpeg(width: number, height: number, options: {marker?: number; before?: number[][]; fill?: boolean} = {}): Uint8Array<ArrayBuffer> {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...text('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const frame = [0xff, options.marker ?? 0xc0, 0x00, 0x11, 8, ...bigEndian16(height), ...bigEndian16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const fill = options.fill ? [0xff, 0xff] : [];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...(options.before ?? []).flat(), ...fill, ...frame, 0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
}

/** A segment of `size` payload bytes under `marker` (an EXIF APP1 or a comment, say), as it stands before the frame. */
export const segment = (marker: number, size: number): number[] => [0xff, marker, ...bigEndian16(size + 2), ...new Array<number>(size).fill(0x41)];

const riff = (chunk: number[]) => [...text('RIFF'), ...littleEndian16(chunk.length + 4), 0, 0, ...text('WEBP'), ...chunk];

/** A lossy WebP: the VP8 chunk's frame tag, its start code and its 14-bit width and height (the two high bits are the scale). */
export function webpLossy(width: number, height: number, scale = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(riff([...text('VP8 '), 0x20, 0, 0, 0, 0x50, 0x01, 0x00, 0x9d, 0x01, 0x2a, ...littleEndian16((scale << 14) | width), ...littleEndian16((scale << 14) | height), 0, 0, 0, 0]));
}

/** A lossless WebP: the VP8L signature byte and the 14-bit (width - 1) and (height - 1), packed from the low bit. */
export function webpLossless(width: number, height: number): Uint8Array<ArrayBuffer> {
  const w = width - 1;
  const h = height - 1;
  const packed = [w & 0xff, ((w >>> 8) & 0x3f) | ((h & 0x03) << 6), (h >>> 2) & 0xff, (h >>> 10) & 0x0f];
  return Uint8Array.from(riff([...text('VP8L'), 0x0d, 0, 0, 0, 0x2f, ...packed, 0, 0, 0, 0, 0, 0, 0, 0]));
}

/** An extended WebP: the VP8X chunk's flags, and the 24-bit (canvas width - 1) and (canvas height - 1). */
export function webpExtended(width: number, height: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(riff([...text('VP8X'), 0x0a, 0, 0, 0, 0x10, 0, 0, 0, ...littleEndian24(width - 1), ...littleEndian24(height - 1), ...text('VP8 '), 0, 0, 0, 0]));
}
