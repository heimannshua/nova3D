// Synthetic pixel fixtures for the picture quality tests (Story 2.3): RGBA buffers built from formulas, never from a file, so the exact numbers they should
// measure can be worked out by hand. `lib/picture-quality.ts` takes `{width, height, data}`; so does a canvas's `getImageData`.
import type {Pixels} from '../../lib/picture-quality';

export type Rgba = readonly [number, number, number, number];

/** A `width` by `height` picture whose pixel at (x, y) is `at(x, y)`. */
export function pixels(width: number, height: number, at: (x: number, y: number) => Rgba): Pixels & {data: Uint8ClampedArray} {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = at(x, y);
      data.set([red, green, blue, alpha], (y * width + x) * 4);
    }
  }
  return {width, height, data};
}

export const gray = (value: number): Rgba => [value, value, value, 255];

/** One grey for the whole picture. */
export const flat = (width: number, height: number, value: number) => pixels(width, height, () => gray(value));

/** A grey that rises by `step` for each column (a ramp has the same value in every row). */
export const ramp = (width: number, height: number, step = 1, from = 0) => pixels(width, height, (x) => gray(Math.min(255, from + x * step)));

/** Black and white squares of one pixel. */
export const checkerboard = (width: number, height: number) => pixels(width, height, (x, y) => gray((x + y) % 2 === 0 ? 0 : 255));

/** `fraction` of the pixels, in whole rows from the top, pure white; the rest the grey `rest`. */
export const rowsOfWhite = (width: number, height: number, whiteRows: number, rest = 128) => pixels(width, height, (_x, y) => gray(y < whiteRows ? 255 : rest));

/** A small deterministic random source (mulberry32): the same seed gives the same sequence on every machine. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform noise, each channel from 0 to 255, from a seed. */
export function noise(width: number, height: number, seed: number) {
  const next = seeded(seed);
  return pixels(width, height, () => [Math.floor(next() * 256), Math.floor(next() * 256), Math.floor(next() * 256), 255]);
}

/** Uniform grey noise between `low` and `high`, from a seed. */
export function greyNoise(width: number, height: number, seed: number, low = 40, high = 215) {
  const next = seeded(seed);
  return pixels(width, height, () => gray(low + Math.floor(next() * (high - low + 1))));
}
