import {createHash, randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';

// What the picture browser tests (Story 2.2, tests/e2e/pictures.spec.ts) share: real, decodable pictures of chosen colours and exact sizes to choose in a
// file input, and the digest the browser should compute for them. Nothing here touches the application: the files are handed to Playwright's `setInputFiles`.

export const MiB = 1024 * 1024;
export const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export type PictureFile = {name: string; mimeType: string; buffer: Buffer};

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export type Rgb = readonly [number, number, number];

/** A real PNG whose pixel at (x, y) is `at(x, y)` (so the browser can decode it and a test can say what it measures): `width` by `height` pixels, no new dependency. */
export function pngOf(width: number, height: number, at: (x: number, y: number) => Rgb): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    pixels[row] = 0; // no filter
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = at(x, y);
      pixels[row + 1 + x * 3] = red;
      pixels[row + 2 + x * 3] = green;
      pixels[row + 3 + x * 3] = blue;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

/** A real PNG of one colour (so the browser can show it), `size` pixels square. */
export function png(rgb: readonly [number, number, number], size = 24): Buffer {
  return pngOf(size, size, () => rgb);
}

/** A real PNG padded (with a private ancillary chunk, which a decoder skips) to exactly `length` bytes. */
export function pngOfLength(rgb: readonly [number, number, number], length: number): Buffer {
  const base = png(rgb);
  if (length <= base.length) throw new Error(`A PNG is at least ${base.length} bytes.`);
  // A chunk costs 12 bytes of framing; the padding is random so two files of one length differ.
  const padding = length - base.length - 12;
  const iend = base.subarray(base.length - 12);
  return Buffer.concat([base.subarray(0, base.length - 12), chunk('prVt', randomBytes(padding)), iend]);
}

const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const tinyWebp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

/** A tiny JPEG; a different `seed` is a different file (a comment segment carries it). */
export function jpeg(seed: number): Buffer {
  const comment = Buffer.from(`seed ${seed}`, 'latin1');
  const segment = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, comment.length + 2]), comment]);
  return Buffer.concat([tinyJpeg.subarray(0, 2), segment, tinyJpeg.subarray(2)]);
}

/** A tiny WebP; the same bytes every time. */
export const webp = (): Buffer => Buffer.from(tinyWebp);

/** The picture of a colour as a file to choose. */
export function pictureFile(name: string, rgb: readonly [number, number, number], mimeType = 'image/png'): PictureFile {
  return {name, mimeType, buffer: png(rgb)};
}

/** Distinct colours, so every picture of a set is a different file. */
export const palette: readonly (readonly [number, number, number])[] = [
  [200, 40, 40], [40, 160, 60], [50, 80, 210], [220, 170, 30], [150, 60, 190], [40, 180, 180], [240, 120, 20], [120, 120, 120],
  [10, 10, 10], [250, 250, 250], [100, 30, 30], [30, 100, 30], [30, 30, 100],
];

/** `count` distinct PNGs named `view-1.png`, `view-2.png`... */
export const views = (count: number, prefix = 'view'): PictureFile[] => Array.from({length: count}, (_, index) => pictureFile(`${prefix}-${index + 1}.png`, palette[index % palette.length]));

// Pictures with a known quality (Story 2.3): real PNGs of the sizes and contents the review measures. Their numbers are worked out from the content, not from a
// file: a checkerboard of two mid-tones has sharp edges every few pixels and no clipping, a ramp has no edge at all, and a picture that is mostly white is clipped.

/** Two mid-tones, so a sharp picture is never clipped (luminance 45 and 215). */
const dark: Rgb = [45, 45, 45];
const light: Rgb = [215, 215, 215];

/** A sharp, evenly lit picture: a checkerboard of squares of `square` pixels, in mid-tones. A different `shift` is a different file (the pattern moves). */
export function sharpPng(width = 1200, height = 900, square = 24, shift = 0): Buffer {
  return pngOf(width, height, (x, y) => (Math.floor((x + shift) / square) + Math.floor(y / square)) % 2 === 0 ? dark : light);
}

/** A smooth picture with no edge at all: a ramp from dark to light across its width (a different `from` is a different file). */
export function blurryPng(width = 1200, height = 900, from = 60): Buffer {
  return pngOf(width, height, (x) => {
    const value = from + Math.floor((x / width) * 120);
    return [value, value, value];
  });
}

/** An over-exposed picture: the top `share` of it is pure white, the rest a sharp checkerboard. A different `square` is a different file. */
export function blownOutPng(width = 1200, height = 900, share = 0.5, square = 24): Buffer {
  return pngOf(width, height, (x, y) => (y < height * share ? [255, 255, 255] : (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0 ? dark : light));
}

/** A set of `count` sharp pictures that are all different files. */
export const sharpViews = (count: number, prefix = 'view'): PictureFile[] =>
  Array.from({length: count}, (_, index) => ({name: `${prefix}-${index + 1}.png`, mimeType: 'image/png', buffer: sharpPng(1200, 900, 20 + index * 2, index * 3)}));
