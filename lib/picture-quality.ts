// Story 2.3. The quality of a set of pictures, measured the same way everywhere: how sharp, how large and how evenly lit each picture is, which views the
// set shows, which views are missing, and whether direct conversion has enough to go on. PURE and CLIENT-SAFE: no run-time import, no browser or Node
// API, no clock, no random source, no `fetch`, no `process`, no `crypto`. The screen (components/projects/picture-review.tsx), the database's twin of the
// rule (projects.picture_review_incomplete, 20261020120000_picture_review.sql) and Story 7.9 (the same checks on the device) all use these definitions,
// and a test holds this file and the database equal over a table of cases. Erasable TypeScript syntax only.
//
// Nothing here decodes an image: the browser does (lib/picture-decode.ts), because the server never touches a picture's pixels. What the browser reports
// is an untrusted claim: the database stores it, and applies the same thresholds to it only to decide whether an acknowledgment is required.
//
// THE DEFINITIONS (written once here and in docs/picture-quality.md; the choices the Spine left open are decided here and are for Josh's approval):
//
//   The analyzed copy.  The analyzer takes `{width, height, data}` (RGBA, 8 bits a channel, row by row) of a COPY of the picture whose long edge is at most
//                       512 px, and the picture's natural width and height. The decoder makes the copy with the platform's `drawImage` at high smoothing
//                       quality, never enlarging, after applying the image's EXIF orientation (`copySize` says how big it is).
//   Composite.          A pixel with alpha under 255 is composited over white in integers: c' = (c * a + 255 * (255 - a) + 127) div 255 for each colour
//                       channel c (rounded half up).
//   Luminance.          The integer (299 * R + 587 * G + 114 * B + 500) div 1000, from 0 to 255, of the composited pixel.
//   Blur.               The population variance of the integer responses of the 4-neighbour 3x3 Laplacian kernel [0 1 0; 1 -4 1; 0 1 0] over the INTERIOR
//                       pixels only (the copy without its outer ring), computed exactly in integers and rounded half up to 3 decimals. A copy under 3x3 has
//                       no interior and its blur is 0. (A 0/255 checkerboard with an even interior is 1,040,400; a ramp is 0.)
//   Clipped.            The share of ALL the pixels of the copy whose luminance is 0 or 255, one combined count, rounded half up to 4 decimals.
//   Short edge.         The smaller of the picture's natural width and height (after orientation), an integer in pixels.
//   Thresholds.         Short edge at least 800 px, blur at least 100, clipped at most 0.35 (35%). Each result is `ok` or the named problem `resolution`,
//                       `blur` or `exposure`, judged on the kept (rounded) numbers, so a value exactly on a threshold is ok.
//   Labels.             front, back, left, right, top, bottom and detail.
//   Coverage.           The distinct labels among front to bottom (a `detail` close-up is not an angle and does not count) must number at least 3 for direct
//                       conversion. The missing views are recommended in the order front, back, left, right, top, bottom, as many as are needed to reach 3.
//   Incomplete.         Coverage under 3, or any picture with a problem.
//
// Rounding is done in integers (BigInt for the variance, whose exact numerator can pass 2^53), so the same pixels give the same numbers on every device.

/** The long edge of the analyzed copy, at most. */
export const copyEdge = 512;

/** The thresholds of a good picture. */
export const thresholds = {minShortEdgePx: 800, minBlurVariance: 100, maxClippedFraction: 0.35} as const;

/** The labels a person gives a view. */
export const viewLabels = ['front', 'back', 'left', 'right', 'top', 'bottom', 'detail'] as const;
export type ViewLabel = (typeof viewLabels)[number];

/** The labels that are angles, in the order missing ones are recommended. `detail` is not one. */
export const angleLabels = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;

/** How many different angles direct conversion needs. */
export const minDistinctViews = 3;

export function isViewLabel(value: unknown): value is ViewLabel {
  return typeof value === 'string' && (viewLabels as readonly string[]).includes(value);
}

/** The three ways a picture can be too poor to rely on. */
export const qualityProblems = ['resolution', 'blur', 'exposure'] as const;
export type QualityProblem = (typeof qualityProblems)[number];

/** RGBA pixels, 8 bits a channel, row by row: what a canvas's `getImageData` returns. */
export type Pixels = {width: number; height: number; data: ArrayLike<number>};

/** The three numbers a picture is judged by. `shortEdgePx` is an integer, `blurVariance` has at most 3 decimals and `clippedFraction` at most 4. */
export type Measurements = {shortEdgePx: number; blurVariance: number; clippedFraction: number};

// Sizes -------------------------------------------------------------------------------------------------------------------------

const isDimension = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/** The size of the analyzed copy of a picture: its long edge at most 512 px, the proportions kept, never larger than the picture, each side at least 1 px. */
export function copySize(naturalWidth: number, naturalHeight: number): {width: number; height: number} {
  if (!isDimension(naturalWidth) || !isDimension(naturalHeight)) throw new RangeError('A picture has a whole number of pixels on each side.');
  const longEdge = Math.max(naturalWidth, naturalHeight);
  if (longEdge <= copyEdge) return {width: naturalWidth, height: naturalHeight};
  const scale = copyEdge / longEdge;
  return {width: Math.max(1, Math.round(naturalWidth * scale)), height: Math.max(1, Math.round(naturalHeight * scale))};
}

// Measuring ---------------------------------------------------------------------------------------------------------------------

/** One colour channel over white at an alpha under 255, in integers. */
const overWhite = (channel: number, alpha: number) => Math.floor((channel * alpha + 255 * (255 - alpha) + 127) / 255);

/** The luminance of a pixel, an integer from 0 to 255. */
export function luminance(red: number, green: number, blue: number): number {
  return Math.floor((299 * red + 587 * green + 114 * blue + 500) / 1000);
}

/** The population variance of `count` integer responses with the given sum and sum of squares, rounded half up to 3 decimals, exactly. */
function exactVariance(count: number, sum: number, sumOfSquares: number): number {
  const n = BigInt(count);
  const numerator = n * BigInt(sumOfSquares) - BigInt(sum) * BigInt(sum);
  const denominator = n * n;
  const thousandths = (numerator * BigInt(2000) + denominator) / (denominator * BigInt(2));
  return Number(thousandths) / 1000;
}

/**
 * Measures a picture from an analyzed copy of it and its natural size. Throws a RangeError for input that is not a copy (a size that is not a whole number
 * of pixels, or data that is not exactly four bytes a pixel): the decoder never produces one, and a measurement is never made up.
 */
export function analyze(copy: Pixels, natural: {width: number; height: number}): Measurements {
  const {width, height, data} = copy;
  if (!isDimension(width) || !isDimension(height) || !isDimension(natural.width) || !isDimension(natural.height)) throw new RangeError('A picture has a whole number of pixels on each side.');
  if (data.length !== width * height * 4) throw new RangeError('A copy has four bytes for each of its pixels.');
  const total = width * height;

  const luma = new Int16Array(total);
  let clipped = 0;
  for (let index = 0; index < total; index += 1) {
    const at = index * 4;
    let red = data[at];
    let green = data[at + 1];
    let blue = data[at + 2];
    const alpha = data[at + 3];
    if (alpha < 255) {
      red = overWhite(red, alpha);
      green = overWhite(green, alpha);
      blue = overWhite(blue, alpha);
    }
    const value = luminance(red, green, blue);
    luma[index] = value;
    if (value === 0 || value === 255) clipped += 1;
  }

  let count = 0;
  let sum = 0;
  let sumOfSquares = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const response = luma[at - width] + luma[at - 1] + luma[at + 1] + luma[at + width] - 4 * luma[at];
      count += 1;
      sum += response;
      sumOfSquares += response * response;
    }
  }

  return {
    shortEdgePx: Math.min(natural.width, natural.height),
    blurVariance: count === 0 ? 0 : exactVariance(count, sum, sumOfSquares),
    clippedFraction: Math.floor((clipped * 20000 + total) / (2 * total)) / 10000,
  };
}

// The size a picture says it has -----------------------------------------------------------------------------------------------

/** The most pixels (width times height) a picture may have: over 100 megapixels is refused before any decoder is asked to open it. */
export const maxPixels = 100_000_000;

export type Dimensions = {width: number; height: number};

/** Whether a picture has more pixels than a device can be asked to open and measure (strictly over 100 megapixels: exactly 100,000,000 is fine). */
export const overPixelCap = (dimensions: Dimensions): boolean => dimensions.width * dimensions.height > maxPixels;

const be16 = (bytes: ArrayLike<number>, at: number) => (bytes[at] << 8) | bytes[at + 1];
const be32 = (bytes: ArrayLike<number>, at: number) => bytes[at] * 0x1000000 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);
const le16 = (bytes: ArrayLike<number>, at: number) => bytes[at] | (bytes[at + 1] << 8);
const le24 = (bytes: ArrayLike<number>, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
const ascii = (bytes: ArrayLike<number>, at: number, text: string) => [...text].every((character, index) => bytes[at + index] === character.charCodeAt(0));
const known = (width: number, height: number): Dimensions | null => (Number.isSafeInteger(width) && Number.isSafeInteger(height) && width >= 1 && height >= 1 ? {width, height} : null);

/**
 * The width and height a picture's FILE HEADER states, as stored (a JPEG's EXIF orientation is not applied; the short edge is the same either way), from the first bytes
 * of the file alone: a PNG's IHDR, a JPEG's start-of-frame segment, a WebP's VP8, VP8L or VP8X chunk. Null for anything else, and for a header that is cut short or
 * states no size. Pure and cheap: it decodes nothing, so a picture can be refused for its size BEFORE a browser is asked to open it.
 */
export function imageDimensions(bytes: ArrayLike<number>): Dimensions | null {
  const length = bytes.length;
  // PNG: the signature, then the IHDR chunk (length, 'IHDR', width, height).
  if (length >= 24 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte) && ascii(bytes, 12, 'IHDR')) {
    return known(be32(bytes, 16), be32(bytes, 20));
  }
  // JPEG: markers one after another until a start-of-frame (SOF0 to SOF15 but DHT, JPG and DAC) states the size; a start of scan before one means there is none.
  if (length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 3 < length) {
      if (bytes[at] !== 0xff) return null;
      while (at < length && bytes[at] === 0xff) at += 1;
      const marker = bytes[at];
      at += 1;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8) || marker === 0x00) continue;
      if (marker === 0xd9 || marker === 0xda) return null;
      if (at + 1 >= length) return null;
      const size = be16(bytes, at);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (at + 6 >= length) return null;
        return known(be16(bytes, at + 5), be16(bytes, at + 3));
      }
      if (size < 2) return null;
      at += size;
    }
    return null;
  }
  // WebP: a RIFF container; the first chunk is the lossy bitstream (VP8 ), the lossless one (VP8L) or the extended header (VP8X).
  if (length >= 30 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) {
    if (ascii(bytes, 12, 'VP8 ')) {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return known(le16(bytes, 26) & 0x3fff, le16(bytes, 28) & 0x3fff);
    }
    if (ascii(bytes, 12, 'VP8L')) {
      if (bytes[20] !== 0x2f) return null;
      const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
      const height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6));
      return known(width, height);
    }
    if (ascii(bytes, 12, 'VP8X')) return known(1 + le24(bytes, 24), 1 + le24(bytes, 27));
  }
  return null;
}

// Judging -----------------------------------------------------------------------------------------------------------------------

/** `ok`, or the named problem, for each of the three measurements; `problems` lists the named ones in the order resolution, blur, exposure. */
export type Assessment = {
  resolution: 'ok' | 'resolution';
  blur: 'ok' | 'blur';
  exposure: 'ok' | 'exposure';
  problems: QualityProblem[];
};

/** Judges the kept numbers of a picture against the thresholds. A value exactly on a threshold is ok. */
export function assess(measurements: Measurements): Assessment {
  const resolution = measurements.shortEdgePx >= thresholds.minShortEdgePx ? 'ok' : 'resolution';
  const blur = measurements.blurVariance >= thresholds.minBlurVariance ? 'ok' : 'blur';
  const exposure = measurements.clippedFraction <= thresholds.maxClippedFraction ? 'ok' : 'exposure';
  const problems: QualityProblem[] = [];
  if (resolution !== 'ok') problems.push('resolution');
  if (blur !== 'ok') problems.push('blur');
  if (exposure !== 'ok') problems.push('exposure');
  return {resolution, blur, exposure, problems};
}

// Coverage ----------------------------------------------------------------------------------------------------------------------

/**
 * Which angles the labelled pictures show, and which are missing. `views` are the distinct angles among front to bottom in that order; `count` is how many;
 * `met` says there are at least 3; `missing` are the views to add, in the order front, back, left, right, top, bottom, as many as are needed to reach 3 (none
 * when it is met). A picture with no label yet (null) and a `detail` close-up show no angle.
 */
export type Coverage = {views: ViewLabel[]; count: number; needed: number; met: boolean; missing: ViewLabel[]};

export function coverage(labels: readonly (ViewLabel | null)[]): Coverage {
  const present = new Set<ViewLabel | null>(labels);
  const views = angleLabels.filter((label) => present.has(label));
  const short = Math.max(0, minDistinctViews - views.length);
  const missing = angleLabels.filter((label) => !present.has(label)).slice(0, short);
  return {views, count: views.length, needed: minDistinctViews, met: views.length >= minDistinctViews, missing};
}

/** Whether direct conversion has too little to go on: fewer than 3 different angles, or any picture with a problem. */
export function incomplete(labels: readonly (ViewLabel | null)[], measurements: readonly Measurements[]): boolean {
  return !coverage(labels).met || measurements.some((measured) => assess(measured).problems.length > 0);
}

// The digest an acknowledgment is pinned to ---------------------------------------------------------------------------------

/** The number of bytes a text takes in UTF-8, as the database's `octet_length` counts them. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** A field as the digest takes it: its length in bytes, a colon, then the field (`projects.length_prefixed`). */
export function lengthPrefixed(value: string): string {
  return `${utf8Length(value)}:${value}`;
}

/**
 * The exact text the database hashes (SHA-256, lower-case hex) into the digest an acknowledgment is pinned to: the length-prefixed scope and outcome, then for
 * each picture in order its position (from 1), upload, SHA-256 (the staged one) and label, each length-prefixed. It pins the acknowledgment to the confirmed
 * scope and to these pictures in this order: it cannot be reused for others. The database makes the digest (`projects.picture_review_digest`); this is the same
 * text, for a test or another story to hash and compare.
 */
export function reviewDigestInput(input: {scope: string; outcome: string; images: readonly {uploadId: string; sha256: string; label: ViewLabel}[]}): string {
  return (
    lengthPrefixed(input.scope) +
    lengthPrefixed(input.outcome) +
    input.images.map((image, index) => lengthPrefixed(String(index + 1)) + lengthPrefixed(image.uploadId) + lengthPrefixed(image.sha256) + lengthPrefixed(image.label)).join('')
  );
}

// Explaining --------------------------------------------------------------------------------------------------------------------

/** A share as a percentage for a message, exactly as kept (at most 2 decimals, none trailing): 0.4256 is `42.56`, 0.35 is `35`, 0.3501 is `35.01`. */
export function percentOf(fraction: number): string {
  const hundredths = Math.round(fraction * 10000);
  const whole = Math.floor(hundredths / 100);
  const rest = hundredths % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/** A blur value as a message says it: cut (not rounded) to one decimal, none trailing, so a value under the threshold never reads as the threshold (99.96 is `99.9`, 100 is `100`). */
export function blurText(variance: number): string {
  const tenths = Math.floor(Math.round(variance * 1000) / 100);
  const whole = Math.floor(tenths / 10);
  return tenths % 10 === 0 ? String(whole) : `${whole}.${tenths % 10}`;
}
