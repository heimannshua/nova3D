import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {
  analyze,
  angleLabels,
  assess,
  blurText,
  copyEdge,
  copySize,
  coverage,
  imageDimensions,
  incomplete,
  isViewLabel,
  lengthPrefixed,
  luminance,
  maxPixels,
  minDistinctViews,
  overPixelCap,
  percentOf,
  reviewDigestInput,
  thresholds,
  viewLabels,
  type Measurements,
  type ViewLabel,
} from '@/lib/picture-quality';
import {jpeg, png, segment, webpExtended, webpLossless, webpLossy} from '../support/headers';
import {checkerboard, flat, gray, greyNoise, noise, pixels, ramp, rowsOfWhite, seeded} from '../support/pixels';

// The quality of a set of pictures (Story 2.3, lib/picture-quality.ts), on synthetic pixel buffers built from formulas: no image file. Every number here can be
// worked out by hand from the definitions in the module's header and in docs/picture-quality.md.
const natural = (width: number, height: number) => ({width, height});
const measured = (patch: Partial<Measurements> = {}): Measurements => ({shortEdgePx: 1200, blurVariance: 500, clippedFraction: 0.02, ...patch});

describe('the definitions', () => {
  it('has the Spine\'s thresholds, labels and the three views direct conversion needs', () => {
    expect(thresholds).toEqual({minShortEdgePx: 800, minBlurVariance: 100, maxClippedFraction: 0.35});
    expect(copyEdge).toBe(512);
    expect(viewLabels).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom', 'detail']);
    expect(angleLabels).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom']);
    expect(minDistinctViews).toBe(3);
    expect(viewLabels.every(isViewLabel)).toBe(true);
    for (const value of ['', 'Front', 'side', null, undefined, 3]) expect(isViewLabel(value)).toBe(false);
  });

  it('weighs the colour channels as the integer luminance (299, 587, 114, plus 500, div 1000)', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBe(255);
    expect(luminance(255, 0, 0)).toBe(76);
    expect(luminance(0, 255, 0)).toBe(150);
    expect(luminance(0, 0, 255)).toBe(29);
    expect(luminance(10, 10, 10)).toBe(10);
    // 254 is below pure white only when every channel is: a near white with one channel at 254 still rounds to 255.
    expect(luminance(255, 255, 254)).toBe(255);
    expect(luminance(254, 254, 254)).toBe(254);
  });
});

describe('the size of the copy that is analyzed', () => {
  it('has a long edge of at most 512 px, keeps the proportions, never enlarges, and has no side under 1 px', () => {
    expect(copySize(1200, 900)).toEqual({width: 512, height: 384});
    expect(copySize(900, 1200)).toEqual({width: 384, height: 512});
    expect(copySize(512, 512)).toEqual({width: 512, height: 512});
    expect(copySize(300, 200)).toEqual({width: 300, height: 200});
    expect(copySize(5000, 1)).toEqual({width: 512, height: 1});
    expect(copySize(4032, 3024)).toEqual({width: 512, height: 384});
  });

  it('refuses a size that is not a whole number of pixels', () => {
    for (const [width, height] of [[0, 10], [10, 0], [1.5, 10], [10, -1], [Number.NaN, 10]]) expect(() => copySize(width, height)).toThrow(RangeError);
  });
});

describe('measuring a picture', () => {
  it('measures a flat picture as sharpness 0 (there is no edge) and no clipping at mid grey', () => {
    expect(analyze(flat(40, 30, 128), natural(1200, 900))).toEqual({shortEdgePx: 900, blurVariance: 0, clippedFraction: 0});
  });

  it('measures a ramp as sharpness 0: the Laplacian of a straight rise is zero everywhere', () => {
    expect(analyze(ramp(64, 48, 1, 20), natural(2000, 1500)).blurVariance).toBe(0);
    expect(analyze(ramp(100, 20, 2), natural(100, 20)).blurVariance).toBe(0);
  });

  it('measures a 0/255 checkerboard as 1,040,400 (1020 squared), the most a picture can have, and every pixel clipped', () => {
    // An even interior has responses of exactly +1020 and -1020 in equal numbers, so the mean is 0 and the variance 1020 squared.
    expect(analyze(checkerboard(10, 10), natural(10, 10))).toEqual({shortEdgePx: 10, blurVariance: 1040400, clippedFraction: 1});
    expect(analyze(checkerboard(512, 384), natural(1200, 900))).toEqual({shortEdgePx: 900, blurVariance: 1040400, clippedFraction: 1});
  });

  it('works the variance out exactly, with the mean taken off (an odd interior is not 1020 squared)', () => {
    // 5x5: the interior is 3x3 = 9 pixels, 5 of one sign and 4 of the other, mean = 1020 / 9, variance = 1020^2 - (1020 / 9)^2 = 1,027,555.5555...
    const odd = analyze(checkerboard(5, 5), natural(5, 5)).blurVariance;
    expect(odd).toBe(1027555.556);
  });

  it('has no interior under 3x3, so its sharpness is 0', () => {
    for (const [width, height] of [[1, 1], [2, 2], [2, 9], [9, 2], [1, 40]]) {
      expect(analyze(checkerboard(width, height), natural(500, 500)).blurVariance, `${width}x${height}`).toBe(0);
    }
  });

  it('has the variance of a single interior response as 0 (3x3)', () => {
    const lone = pixels(3, 3, (x, y) => gray(x === 1 && y === 1 ? 200 : 0));
    expect(analyze(lone, natural(3, 3)).blurVariance).toBe(0);
  });

  it('measures the kernel on the four neighbours, never the diagonals', () => {
    // A 4x3 picture: row 1 is [0, b, c, 0] between two rows of zeros. The two interior responses are c - 4b and b - 4c.
    const strip = (b: number, c: number) => pixels(4, 3, (x, y) => gray(y === 1 && x === 1 ? b : y === 1 && x === 2 ? c : 0));
    // b = 10, c = 14: the responses are -26 and -46, a mean of -36 and a variance of 100 exactly.
    expect(analyze(strip(10, 14), natural(1000, 1000)).blurVariance).toBe(100);
    // A diagonal neighbour does not count: a bright corner pixel changes nothing.
    const corner = pixels(3, 3, (x, y) => gray(x === 0 && y === 0 ? 255 : 100));
    expect(analyze(corner, natural(3, 3)).blurVariance).toBe(0);
  });

  it('rounds the variance half up to 3 decimals', () => {
    // Responses 0 and 1: variance 1/4 = 0.25. Responses 0, 0, 1: mean 1/3, variance 2/9 = 0.2222... -> 0.222.
    const two = pixels(4, 3, (x, y) => gray(y === 1 && x === 1 ? 1 : 0)); // interior responses: -4 and 1 -> mean -1.5, variance 6.25
    expect(analyze(two, natural(10, 10)).blurVariance).toBe(6.25);
    const three = pixels(5, 3, (x, y) => gray(y === 1 && x === 2 ? 1 : 0)); // responses 1, -4, 1: mean -2/3, variance (1+16+1)/3 - 4/9 = 5.5555... -> 5.556
    expect(analyze(three, natural(10, 10)).blurVariance).toBe(5.556);
  });

  it('measures noise with a large, repeatable sharpness: the same seed is the same number', () => {
    const first = analyze(noise(64, 64, 7), natural(1600, 1200));
    const second = analyze(noise(64, 64, 7), natural(1600, 1200));
    expect(second).toEqual(first);
    expect(first.blurVariance).toBeGreaterThan(thresholds.minBlurVariance * 10);
    expect(analyze(noise(64, 64, 8), natural(1600, 1200))).not.toEqual(first);
    // Grey noise inside 40..215 never reaches a pure black or white.
    expect(analyze(greyNoise(64, 64, 3), natural(1600, 1200)).clippedFraction).toBe(0);
  });

  it('counts luminance 0 and 255 together, as one share of all the pixels', () => {
    // 20 pixels: 4 black, 3 white, 13 grey -> 7 / 20 = 0.35 exactly.
    const mixed = pixels(5, 4, (x, y) => {
      const index = y * 5 + x;
      return gray(index < 4 ? 0 : index < 7 ? 255 : 128);
    });
    expect(analyze(mixed, natural(900, 900)).clippedFraction).toBe(0.35);
    expect(analyze(rowsOfWhite(10, 10, 4), natural(900, 900)).clippedFraction).toBe(0.4);
    const dark = pixels(10, 10, (_x, y) => gray(y < 5 ? 0 : 90));
    expect(analyze(dark, natural(900, 900)).clippedFraction).toBe(0.5);
  });

  it('rounds the clipped share half up to 4 decimals', () => {
    // 1 of 3 pixels = 0.33333... -> 0.3333; 2 of 3 = 0.6666... -> 0.6667; 1 of 8 = 0.125; 1 of 16 = 0.0625; 1 of 32 = 0.03125 -> 0.0313 (half up).
    const share = (clipped: number, total: number) => analyze(pixels(total, 1, (x) => gray(x < clipped ? 255 : 100)), natural(900, 900)).clippedFraction;
    expect(share(1, 3)).toBe(0.3333);
    expect(share(2, 3)).toBe(0.6667);
    expect(share(1, 8)).toBe(0.125);
    expect(share(1, 16)).toBe(0.0625);
    expect(share(1, 32)).toBe(0.0313);
    expect(share(0, 7)).toBe(0);
    expect(share(7, 7)).toBe(1);
  });

  it('takes the short edge from the NATURAL size, not from the copy', () => {
    expect(analyze(flat(8, 8, 100), natural(1200, 800)).shortEdgePx).toBe(800);
    expect(analyze(flat(8, 8, 100), natural(799, 3000)).shortEdgePx).toBe(799);
    expect(analyze(flat(8, 8, 100), natural(30, 30)).shortEdgePx).toBe(30);
  });

  it('composites a transparent pixel over white in integers before it takes its luminance', () => {
    // Fully transparent black becomes white: luminance 255, clipped. Half transparent black: (0 * 128 + 255 * 127 + 127) div 255 = 127 (grey).
    const clear = pixels(4, 4, () => [0, 0, 0, 0]);
    expect(analyze(clear, natural(900, 900)).clippedFraction).toBe(1);
    const half = pixels(4, 4, () => [0, 0, 0, 128]);
    expect(analyze(half, natural(900, 900)).clippedFraction).toBe(0);
    // An opaque pixel is untouched: opaque black is luminance 0 (clipped).
    expect(analyze(pixels(4, 4, () => [0, 0, 0, 255]), natural(900, 900)).clippedFraction).toBe(1);
    // Alpha 254 of pure white is still white: (255 * 254 + 255 * 1 + 127) div 255 = 255.
    expect(analyze(pixels(4, 4, () => [255, 255, 255, 254]), natural(900, 900)).clippedFraction).toBe(1);
  });

  it('rounds a partly transparent pixel over white to the nearest integer, half up: a hand-worked checkerboard of [1,1,1,128] pixels', () => {
    // [1,1,1,128] over white is (1 * 128 + 255 * 127 + 127) div 255 = 32640 div 255 = 128 EXACTLY (without the + 127 it would be 32513 div 255 = 127), and the luminance of a
    // grey 128 is (1000 * 128 + 500) div 1000 = 128. In a 4 x 4 checkerboard against opaque black (luminance 0) the interior is the four pixels (1,1) (2,1) (1,2) (2,2): the
    // two on the diagonal ARE the alpha pixels, whose four neighbours are all black, so their response is 4 * 0 - 4 * 128 = -512; the other two have four alpha neighbours
    // and the response 4 * 128 - 4 * 0 = +512. The mean is 0 and the population variance is 512 * 512 = 262144, exactly. Eight of the sixteen pixels are black (clipped):
    // 0.5. (At luminance 127 the variance would be 508 * 508 = 258064.)
    const board = pixels(4, 4, (x, y) => ((x + y) % 2 === 0 ? [1, 1, 1, 128] : [0, 0, 0, 255]));
    expect(analyze(board, natural(4, 4))).toEqual({shortEdgePx: 4, blurVariance: 262144, clippedFraction: 0.5});
  });

  it('counts a partly transparent pixel as clipped only where the rounding makes it pure white: a hand-worked checkerboard of [254,254,254,127] pixels', () => {
    // [254,254,254,127] over white is (254 * 127 + 255 * 128 + 127) div 255 = (32258 + 32640 + 127) div 255 = 65025 div 255 = 255 EXACTLY: pure white, clipped (without the
    // + 127 it would be 64898 div 255 = 254, not clipped). Against opaque grey 100 the interior responses are 4 * 100 - 4 * 255 = -620 on the diagonal pixels (whose four
    // neighbours are grey) and +620 on the others: variance 620 * 620 = 384400. Eight of the sixteen pixels are clipped: 0.5. (At luminance 254 the variance would be
    // 616 * 616 = 379456 and nothing would be clipped.)
    const board = pixels(4, 4, (x, y) => ((x + y) % 2 === 0 ? [254, 254, 254, 127] : [100, 100, 100, 255]));
    expect(analyze(board, natural(4, 4))).toEqual({shortEdgePx: 4, blurVariance: 384400, clippedFraction: 0.5});
  });

  it('uses the luminance weights, not an average of the channels', () => {
    // Pure red and pure blue at full strength are luminance 76 and 29, neither clipped; a grey of the channel average (85) is not clipped either.
    expect(analyze(pixels(4, 4, () => [255, 0, 0, 255]), natural(900, 900)).clippedFraction).toBe(0);
    // But yellow is 255 * 0.886 = 226: not clipped. White is.
    expect(analyze(pixels(4, 4, () => [255, 255, 0, 255]), natural(900, 900)).clippedFraction).toBe(0);
    expect(analyze(pixels(4, 4, () => [255, 255, 255, 255]), natural(900, 900)).clippedFraction).toBe(1);
  });

  it('keeps every kept number inside its range for random pictures of many shapes', () => {
    const next = seeded(99);
    for (let round = 0; round < 40; round += 1) {
      const width = 1 + Math.floor(next() * 40);
      const height = 1 + Math.floor(next() * 40);
      const result = analyze(noise(width, height, round + 1), natural(width * 10, height * 10));
      expect(Number.isInteger(result.shortEdgePx)).toBe(true);
      expect(result.blurVariance).toBeGreaterThanOrEqual(0);
      expect(result.blurVariance).toBeLessThanOrEqual(1040400);
      expect(Math.round(result.blurVariance * 1000) / 1000).toBe(result.blurVariance);
      expect(result.clippedFraction).toBeGreaterThanOrEqual(0);
      expect(result.clippedFraction).toBeLessThanOrEqual(1);
      expect(Math.round(result.clippedFraction * 10000) / 10000).toBe(result.clippedFraction);
    }
  });

  it('agrees with a plain two-pass calculation of the same definitions, to the 3 decimals it keeps, on random pictures of many shapes', () => {
    const next = seeded(20261020);
    for (let round = 0; round < 60; round += 1) {
      const width = 3 + Math.floor(next() * 40);
      const height = 3 + Math.floor(next() * 40);
      const picture = noise(width, height, 1000 + round);
      // The definitions, spelled out the long way: luminance of every pixel, the kernel over the interior, the mean, then the mean of the squared deviations.
      const lumas: number[] = [];
      for (let index = 0; index < width * height; index += 1) lumas.push(luminance(picture.data[index * 4], picture.data[index * 4 + 1], picture.data[index * 4 + 2]));
      const responses: number[] = [];
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const at = y * width + x;
          responses.push(lumas[at - width] + lumas[at - 1] + lumas[at + 1] + lumas[at + width] - 4 * lumas[at]);
        }
      }
      const mean = responses.reduce((sum, value) => sum + value, 0) / responses.length;
      const variance = responses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / responses.length;
      const clipped = lumas.filter((value) => value === 0 || value === 255).length / lumas.length;
      const measuredPicture = analyze(picture, natural(width * 8, height * 8));
      expect(Math.abs(measuredPicture.blurVariance - variance), `${width}x${height}`).toBeLessThanOrEqual(0.0006);
      expect(Math.abs(measuredPicture.clippedFraction - clipped), `${width}x${height}`).toBeLessThanOrEqual(0.00006);
    }
  });

  it('refuses input that is not a copy: a wrong length, or a size that is not a whole number of pixels', () => {
    expect(() => analyze({width: 2, height: 2, data: new Uint8ClampedArray(15)}, natural(10, 10))).toThrow(RangeError);
    expect(() => analyze({width: 0, height: 2, data: new Uint8ClampedArray(0)}, natural(10, 10))).toThrow(RangeError);
    expect(() => analyze(flat(2, 2, 1), natural(0, 10))).toThrow(RangeError);
    expect(() => analyze(flat(2, 2, 1), natural(10.5, 10))).toThrow(RangeError);
  });
});

describe('the size a picture\'s file header states', () => {
  it('is read from a PNG\'s IHDR', () => {
    expect(imageDimensions(png(4032, 3024))).toEqual({width: 4032, height: 3024});
    expect(imageDimensions(png(1, 1, 100))).toEqual({width: 1, height: 1});
    // More than 16 bits: the whole 32-bit fields are read.
    expect(imageDimensions(png(70000, 90000))).toEqual({width: 70000, height: 90000});
  });

  it('is read from a JPEG\'s start of frame, past the segments before it, baseline or progressive, with fill bytes', () => {
    expect(imageDimensions(jpeg(4032, 3024))).toEqual({width: 4032, height: 3024});
    expect(imageDimensions(jpeg(3024, 4032, {marker: 0xc2}))).toEqual({width: 3024, height: 4032});
    // An EXIF segment of 20 KB and a comment come first (and a fill byte before the frame's marker).
    expect(imageDimensions(jpeg(65535, 1, {before: [segment(0xe1, 20000), segment(0xfe, 30)], fill: true}))).toEqual({width: 65535, height: 1});
    // SOF9 (arithmetic) and the other frame types state a size too.
    expect(imageDimensions(jpeg(800, 600, {marker: 0xc9}))).toEqual({width: 800, height: 600});
  });

  it('is read from a WebP: lossy (VP8), lossless (VP8L) and extended (VP8X)', () => {
    expect(imageDimensions(webpLossy(4000, 3000))).toEqual({width: 4000, height: 3000});
    // The two high bits of each field are a scale, not a size.
    expect(imageDimensions(webpLossy(1280, 720, 3))).toEqual({width: 1280, height: 720});
    expect(imageDimensions(webpLossless(4000, 3000))).toEqual({width: 4000, height: 3000});
    expect(imageDimensions(webpLossless(1, 16384))).toEqual({width: 1, height: 16384});
    expect(imageDimensions(webpExtended(30000, 20000))).toEqual({width: 30000, height: 20000});
    expect(imageDimensions(webpExtended(16777216, 1))).toEqual({width: 16777216, height: 1});
  });

  it('is null for a header cut short, for one that states no size, and for anything that is not one of the three', () => {
    for (const whole of [png(4032, 3024), jpeg(4032, 3024, {before: [segment(0xe1, 40)]}), webpLossy(4000, 3000), webpLossless(4000, 3000), webpExtended(4000, 3000)]) {
      expect(imageDimensions(whole)).not.toBeNull();
      // Every proper prefix that ends before the size is complete states none (a prefix never states a WRONG size).
      for (let end = 0; end < whole.length; end += 1) {
        const states = imageDimensions(whole.subarray(0, end));
        if (states) expect(states).toEqual(imageDimensions(whole));
      }
    }
    expect(imageDimensions(png(4032, 3024).subarray(0, 23))).toBeNull();
    expect(imageDimensions(jpeg(4032, 3024).subarray(0, 24))).toBeNull();
    expect(imageDimensions(webpLossy(4000, 3000).subarray(0, 28))).toBeNull();
    expect(imageDimensions(new Uint8Array())).toBeNull();
    expect(imageDimensions(new Uint8Array(100))).toBeNull();
    expect(imageDimensions(new TextEncoder().encode('GIF89a not a supported picture type, and long enough to be read'))).toBeNull();
    // A JPEG that starts its scan before it states a size, a PNG whose first chunk is not IHDR, and a size of zero.
    expect(imageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]))).toBeNull();
    const notIhdr = png(10, 10);
    notIhdr[12] = 0x58;
    expect(imageDimensions(notIhdr)).toBeNull();
    expect(imageDimensions(png(0, 10))).toBeNull();
    expect(imageDimensions(jpeg(10, 0))).toBeNull();
  });

  it('refuses a picture over 100 megapixels, and not one at exactly 100 megapixels', () => {
    expect(maxPixels).toBe(100_000_000);
    expect(overPixelCap({width: 10000, height: 10000})).toBe(false);
    expect(overPixelCap({width: 10000, height: 10001})).toBe(true);
    expect(overPixelCap({width: 1, height: 100_000_000})).toBe(false);
    expect(overPixelCap({width: 100_000_001, height: 1})).toBe(true);
    // A PNG may state 4 billion by 4 billion: the product stays exact enough to refuse.
    const stated = imageDimensions(png(4294967295, 4294967295));
    expect(stated).not.toBeNull();
    expect(overPixelCap(stated!)).toBe(true);
    expect(overPixelCap(imageDimensions(webpExtended(16777216, 16777216))!)).toBe(true);
    expect(overPixelCap(imageDimensions(jpeg(65535, 65535))!)).toBe(true);
    expect(overPixelCap(imageDimensions(jpeg(12000, 8000))!)).toBe(false);
  });
});

describe('judging the kept numbers', () => {
  it('calls a picture ok when every number is on the right side of its threshold', () => {
    expect(assess(measured())).toEqual({resolution: 'ok', blur: 'ok', exposure: 'ok', problems: []});
  });

  it('names the problem for each measurement, and lists them in the order resolution, blur, exposure', () => {
    expect(assess(measured({shortEdgePx: 700})).problems).toEqual(['resolution']);
    expect(assess(measured({blurVariance: 41})).problems).toEqual(['blur']);
    expect(assess(measured({clippedFraction: 0.4})).problems).toEqual(['exposure']);
    expect(assess({shortEdgePx: 100, blurVariance: 0, clippedFraction: 1})).toEqual({resolution: 'resolution', blur: 'blur', exposure: 'exposure', problems: ['resolution', 'blur', 'exposure']});
  });

  it('is ok exactly on a threshold and a problem one step beyond (short edge 800, blur 100, clipped 0.35)', () => {
    expect(assess(measured({shortEdgePx: 800})).resolution).toBe('ok');
    expect(assess(measured({shortEdgePx: 799})).resolution).toBe('resolution');
    expect(assess(measured({blurVariance: 100})).blur).toBe('ok');
    expect(assess(measured({blurVariance: 99.999})).blur).toBe('blur');
    expect(assess(measured({blurVariance: 100.001})).blur).toBe('ok');
    expect(assess(measured({clippedFraction: 0.35})).exposure).toBe('ok');
    expect(assess(measured({clippedFraction: 0.3501})).exposure).toBe('exposure');
    expect(assess(measured({clippedFraction: 0.3499})).exposure).toBe('ok');
  });

  it('measures a sharp, large, evenly lit picture as ok and a flat one as blurry (the matrix rows)', () => {
    const sharp = analyze(greyNoise(128, 96, 5), natural(1200, 900));
    expect(assess(sharp).problems).toEqual([]);
    const smooth = analyze(ramp(128, 96, 1, 40), natural(1200, 900));
    expect(assess(smooth).problems).toEqual(['blur']);
    const small = analyze(greyNoise(128, 96, 5), natural(700, 700));
    expect(assess(small).problems).toEqual(['resolution']);
    const over = analyze(rowsOfWhite(64, 64, 26), natural(1200, 900));
    expect(over.clippedFraction).toBeGreaterThan(0.35);
    expect(assess({...sharp, clippedFraction: over.clippedFraction}).problems).toEqual(['exposure']);
    const under = analyze(pixels(64, 64, (_x, y) => gray(y < 26 ? 0 : 128)), natural(1200, 900));
    expect(under.clippedFraction).toBeGreaterThan(0.35);
  });
});

describe('which views the pictures show', () => {
  const labels = (...values: (ViewLabel | null)[]) => values;

  it('counts the distinct angles among front to bottom, in the order front, back, left, right, top, bottom', () => {
    expect(coverage(labels('top', 'front', 'left'))).toEqual({views: ['front', 'left', 'top'], count: 3, needed: 3, met: true, missing: []});
    expect(coverage(labels('bottom', 'right', 'back', 'front', 'top', 'left'))).toMatchObject({views: ['front', 'back', 'left', 'right', 'top', 'bottom'], count: 6, met: true, missing: []});
  });

  it('recommends back and left for front, front, detail: one distinct view', () => {
    expect(coverage(labels('front', 'front', 'detail'))).toEqual({views: ['front'], count: 1, needed: 3, met: false, missing: ['back', 'left']});
  });

  it('does not count a detail close-up as an angle', () => {
    expect(coverage(labels('detail', 'detail', 'detail', 'detail'))).toMatchObject({count: 0, met: false, missing: ['front', 'back', 'left']});
    expect(coverage(labels('front', 'back', 'detail'))).toMatchObject({count: 2, met: false, missing: ['left']});
    expect(coverage(labels('front', 'back', 'left', 'detail')).met).toBe(true);
  });

  it('recommends as many views as are needed to reach 3, never more, skipping the ones it has', () => {
    expect(coverage(labels('front', 'back'))).toMatchObject({missing: ['left']});
    expect(coverage(labels('back', 'left'))).toMatchObject({missing: ['front']});
    expect(coverage(labels('left', 'right'))).toMatchObject({missing: ['front']});
    expect(coverage(labels('top'))).toMatchObject({missing: ['front', 'back']});
    expect(coverage(labels())).toMatchObject({count: 0, met: false, missing: ['front', 'back', 'left']});
    expect(coverage(labels('bottom', 'top'))).toMatchObject({missing: ['front']});
  });

  it('counts a picture with no label as showing nothing', () => {
    expect(coverage(labels(null, null, 'front'))).toMatchObject({views: ['front'], count: 1, met: false});
  });
});

describe('whether direct conversion has too little to go on', () => {
  const good = measured();
  const cases: [string, (ViewLabel | null)[], Measurements[], boolean][] = [
    ['three views, all ok', ['front', 'left', 'top'], [good, good, good], false],
    ['three views and a detail, all ok', ['front', 'left', 'top', 'detail'], [good, good, good, good], false],
    ['two views', ['front', 'left'], [good, good], true],
    ['front, front, detail', ['front', 'front', 'detail'], [good, good, good], true],
    ['three views, one blurry', ['front', 'left', 'top'], [good, measured({blurVariance: 41}), good], true],
    ['three views, one small', ['front', 'left', 'top'], [measured({shortEdgePx: 700}), good, good], true],
    ['three views, one over-exposed', ['front', 'left', 'top'], [good, good, measured({clippedFraction: 0.5})], true],
    ['three views at every edge', ['front', 'left', 'top'], [measured({shortEdgePx: 800, blurVariance: 100, clippedFraction: 0.35}), good, good], false],
    ['a detail that is blurry still counts as a problem', ['front', 'left', 'top', 'detail'], [good, good, good, measured({blurVariance: 3})], true],
    ['one picture', ['front'], [good], true],
  ];
  it.each(cases)('%s', (_name, labels, measurements, expected) => {
    expect(incomplete(labels, measurements)).toBe(expected);
  });
});

describe('the digest an acknowledgment is pinned to', () => {
  it('length-prefixes each field with its length in UTF-8 bytes and a colon', () => {
    expect(lengthPrefixed('')).toBe('0:');
    expect(lengthPrefixed('front')).toBe('5:front');
    expect(lengthPrefixed('é')).toBe('2:é');
    expect(lengthPrefixed('מזבח')).toBe('8:מזבח');
    expect(lengthPrefixed('😀')).toBe('4:😀');
  });

  it('is the length-prefixed scope and outcome, then each picture\'s position, upload, SHA-256 and label, in order', () => {
    const text = reviewDigestInput({
      scope: 'The altar',
      outcome: 'A model',
      images: [
        {uploadId: 'u-1', sha256: 'a'.repeat(64), label: 'front'},
        {uploadId: 'u-2', sha256: 'b'.repeat(64), label: 'detail'},
      ],
    });
    expect(text).toBe(`9:The altar7:A model1:1${lengthPrefixed('u-1')}64:${'a'.repeat(64)}5:front1:2${lengthPrefixed('u-2')}64:${'b'.repeat(64)}6:detail`);
  });

  it('is different for another order, another label, another picture and another scope, so it cannot be reused for them', () => {
    const base: Parameters<typeof reviewDigestInput>[0] = {scope: 's', outcome: 'o', images: [{uploadId: 'a', sha256: '1', label: 'front'}, {uploadId: 'b', sha256: '2', label: 'left'}]};
    const digest = (input: typeof base) => createHash('sha256').update(reviewDigestInput(input)).digest('hex');
    const original = digest(base);
    expect(digest({...base, images: [...base.images].reverse()})).not.toBe(original);
    expect(digest({...base, images: [{...base.images[0], label: 'back'}, base.images[1]]})).not.toBe(original);
    expect(digest({...base, images: [{...base.images[0], sha256: '3'}, base.images[1]]})).not.toBe(original);
    expect(digest({...base, scope: 't'})).not.toBe(original);
    expect(digest({...base, outcome: 'p'})).not.toBe(original);
    expect(digest(base)).toBe(original);
  });
});

describe('numbers in words', () => {
  it('writes a share exactly as it is kept: at most 2 decimals, none trailing', () => {
    expect(percentOf(0.4256)).toBe('42.56');
    expect(percentOf(0.35)).toBe('35');
    expect(percentOf(0.3501)).toBe('35.01');
    expect(percentOf(0.05)).toBe('5');
    expect(percentOf(0.0501)).toBe('5.01');
    expect(percentOf(0.0610)).toBe('6.1');
    expect(percentOf(0)).toBe('0');
    expect(percentOf(1)).toBe('100');
  });

  it('cuts a blur value to one decimal, never rounding it up to a threshold it has not reached', () => {
    expect(blurText(99.96)).toBe('99.9');
    expect(blurText(99.999)).toBe('99.9');
    expect(blurText(100)).toBe('100');
    expect(blurText(41.25)).toBe('41.2');
    expect(blurText(0)).toBe('0');
    expect(blurText(1040400)).toBe('1040400');
    expect(blurText(5.5)).toBe('5.5');
  });
});

describe('the module is pure', () => {
  const source = readFileSync(resolve(__dirname, '../../lib/picture-quality.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('imports nothing, and touches no clock, random source, network, process or crypto', () => {
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bprocess\b|\bfetch\(|XMLHttpRequest|node:|require\(|await import\(|\bDate\b|Math\.random|crypto\.|\bwindow\b|\bdocument\b|\bnavigator\b/);
  });
});
