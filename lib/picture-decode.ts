// Story 2.3. The browser's half of measuring a picture: decode it, make the analyzed copy and a small thumbnail, and hand the copy to the pure analyzer
// (lib/picture-quality.ts). The server never decodes an image, so every number the review reports is measured here, in the browser, and is a claim the
// database stores and cross-checks only for completeness. Story 7.9 reuses this file for the device's own checks.
//
// The copy (the definitions are in lib/picture-quality.ts and docs/picture-quality.md): the picture is decoded with its EXIF orientation applied
// (`createImageBitmap` with `imageOrientation: 'from-image'`), so the natural width and height are the ones the person sees; the copy is drawn with the
// platform's `drawImage` at high smoothing quality, its long edge at most 512 px and never enlarged. The thumbnail is a small JPEG drawn from that copy on a
// white ground. Nothing is stored or sent: the bitmap is closed as soon as the copy is drawn, and the bytes stay in the caller's memory.
//
// Two limits protect the device. A picture whose FILE HEADER states more than 100 megapixels is refused (`too_large_pixels`) BEFORE any decoder is asked to open
// it (a decoder would have to hold it whole), and a decode that has not finished in 30 seconds is given up (`busy`: the device is too slow or too short of memory
// for it; trying again may help).
//
// BROWSER-SAFE; every dependency is injectable so the tests run it in Node (as lib/picture-camera.ts does). It touches `document` and
// `createImageBitmap` only inside a function. It never throws for a picture that cannot be decoded: that is a result.
import {analyze, copySize, imageDimensions, overPixelCap, type Measurements, type Pixels} from './picture-quality.ts';

/** The longest side of a thumbnail, in pixels, and the JPEG quality it is drawn at. */
export const thumbnailEdge = 240;
export const thumbnailQuality = 0.8;
/** How long a decode may take before it is given up, and how much of the file's start is read to find the size its header states. */
export const decodeTimeoutMs = 30_000;
export const headerBytes = 256 * 1024;

/** What this uses of a decoded image. */
export type DecodedBitmap = {width: number; height: number; close?: () => void};

/** What this uses of a 2D canvas context. */
export type DrawingContext = {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: never, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, width: number, height: number): Pixels;
};

/** What this uses of a canvas. */
export type DrawingCanvas = {
  width: number;
  height: number;
  getContext(type: '2d', options?: {willReadFrequently?: boolean}): DrawingContext | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
};

export type DecodeDeps = {
  /** `createImageBitmap`; undefined where the browser has none. */
  createImageBitmap?: ((blob: Blob, options?: {imageOrientation?: 'from-image' | 'none'}) => Promise<DecodedBitmap>) | undefined;
  /** Makes a canvas. */
  createCanvas?: () => DrawingCanvas;
  /** The first bytes of the file (to read the size its header states); by default the start of the blob. */
  readHeader?: (blob: Blob) => Promise<Uint8Array>;
  /** How long a decode may take, in milliseconds (30 seconds by default). */
  timeoutMs?: number;
};

/**
 * Why a picture could not be measured: `undecodable` (the browser could not open it, or read its pixels), `too_large_pixels` (its header states more than 100
 * megapixels, so no decoder was asked) or `busy` (the decode did not finish in time).
 */
export type DecodeProblem = 'undecodable' | 'too_large_pixels' | 'busy';

/** A picture measured: its numbers, its natural size, and a small JPEG to show (null when the browser could not make one: the measurements stand). */
export type Decoded = {ok: true; measurements: Measurements; naturalWidth: number; naturalHeight: number; thumbnail: Blob | null} | {ok: false; problem: DecodeProblem};

const hasBitmaps = (deps: DecodeDeps) => ('createImageBitmap' in deps ? typeof deps.createImageBitmap === 'function' : typeof createImageBitmap === 'function');

/** Whether this browser can decode a picture to measure it (`createImageBitmap` exists). It decodes nothing. */
export function canDecode(deps: DecodeDeps = {}): boolean {
  return hasBitmaps(deps);
}

/**
 * The decoded picture with its EXIF orientation applied. A browser that does not know the `from-image` option (older ones throw on it) is asked again without
 * options: its default is that very orientation. A picture that cannot be decoded at all is refused both times.
 */
async function bitmapOf(blob: Blob, deps: DecodeDeps): Promise<DecodedBitmap> {
  const make = 'createImageBitmap' in deps ? deps.createImageBitmap : (source: Blob, options?: {imageOrientation?: 'from-image' | 'none'}) => createImageBitmap(source, options as ImageBitmapOptions);
  if (typeof make !== 'function') throw new TypeError('This browser cannot decode a picture.');
  try {
    return await make(blob, {imageOrientation: 'from-image'});
  } catch {
    return await make(blob);
  }
}

const canvasOf = (deps: DecodeDeps): DrawingCanvas => (deps.createCanvas ? deps.createCanvas() : (document.createElement('canvas') as unknown as DrawingCanvas));

function jpegOf(canvas: DrawingCanvas): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', thumbnailQuality);
    } catch {
      resolve(null);
    }
  });
}

/** A small JPEG of the copy on a white ground (a transparent picture would be black otherwise). Null when the browser cannot make one. */
async function thumbnailOf(source: DrawingCanvas, copy: {width: number; height: number}, deps: DecodeDeps): Promise<Blob | null> {
  try {
    const scale = Math.min(1, thumbnailEdge / Math.max(copy.width, copy.height));
    const canvas = canvasOf(deps);
    canvas.width = Math.max(1, Math.round(copy.width * scale));
    canvas.height = Math.max(1, Math.round(copy.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source as never, 0, 0, canvas.width, canvas.height);
    const blob = await jpegOf(canvas);
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

/** The size the file's header states, from the start of the blob; null when it cannot be read or states none. */
async function headerSize(blob: Blob, deps: DecodeDeps) {
  try {
    const bytes = deps.readHeader ? await deps.readHeader(blob) : new Uint8Array(await blob.slice(0, headerBytes).arrayBuffer());
    return imageDimensions(bytes);
  } catch {
    return null;
  }
}

const isSide = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

async function measure(blob: Blob, deps: DecodeDeps): Promise<Decoded> {
  let bitmap: DecodedBitmap | null = null;
  try {
    // The size the header states is read FIRST: a picture of more than 100 megapixels is refused before any decoder is asked to hold it.
    const stated = await headerSize(blob, deps);
    if (stated && overPixelCap(stated)) return {ok: false, problem: 'too_large_pixels'};
    bitmap = await bitmapOf(blob, deps);
    // The decoder's size is the oriented one the person sees; the header's stands in for it when the decoder cannot supply one (the short edge is the same either way).
    const naturalWidth = isSide(bitmap.width) ? bitmap.width : stated?.width;
    const naturalHeight = isSide(bitmap.height) ? bitmap.height : stated?.height;
    if (!isSide(naturalWidth) || !isSide(naturalHeight)) return {ok: false, problem: 'undecodable'};
    if (overPixelCap({width: naturalWidth, height: naturalHeight})) return {ok: false, problem: 'too_large_pixels'};
    const size = copySize(naturalWidth, naturalHeight);
    const canvas = canvasOf(deps);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) return {ok: false, problem: 'undecodable'};
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap as never, 0, 0, size.width, size.height);
    const copy = context.getImageData(0, 0, size.width, size.height);
    bitmap.close?.();
    bitmap = null;
    const measurements = analyze({width: copy.width, height: copy.height, data: copy.data}, {width: naturalWidth, height: naturalHeight});
    return {ok: true, measurements, naturalWidth, naturalHeight, thumbnail: await thumbnailOf(canvas, size, deps)};
  } catch {
    return {ok: false, problem: 'undecodable'};
  } finally {
    try {
      bitmap?.close?.();
    } catch {
      // Already released.
    }
  }
}

/**
 * Decodes a picture and measures it. `{ok: false}` says why not: the browser could not open it (not a picture after all, damaged, or too large for the device's
 * memory) or read its pixels (`undecodable`), its header states more than 100 megapixels (`too_large_pixels`, no decoder was asked), or the decode did not finish in
 * 30 seconds (`busy`). Each counts as a problem that cannot be acknowledged; only `busy` is worth trying again. One picture at a time is the caller's rule; the
 * decoded bitmap is closed before this returns, and a decode that finishes after the limit is closed and dropped.
 */
export async function decodePicture(blob: Blob, deps: DecodeDeps = {}): Promise<Decoded> {
  const limit = deps.timeoutMs ?? decodeTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Decoded>((resolve) => {
    timer = setTimeout(() => resolve({ok: false, problem: 'busy'}), limit);
  });
  try {
    return await Promise.race([measure(blob, deps), late]);
  } finally {
    clearTimeout(timer);
  }
}
