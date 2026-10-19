import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {crc32} from 'node:zlib';
import {describe, expect, it} from 'vitest';
import {readOrientation, StripError, stripPictureMetadata} from '../../workers/files/src/strip';
import {
  asciiEntry,
  baselineJpeg,
  chunksOfPng,
  chunksOfWebp,
  commentMarker,
  exifSegment,
  exifTiff,
  gpsJpeg,
  gpsJpegOrientation,
  gpsMarker,
  jpegNames,
  jpegWithMetadata,
  longEntry,
  markersIn,
  metadataMarkers,
  pngChunk,
  pngSignature,
  pngTypes,
  pngWithMetadata,
  privateMarker,
  riffWebp,
  segmentsOfJpeg,
  shortEntry,
  simpleWebp,
  tiffStream,
  trailerMarker,
  vp8lImage,
  webpChunk,
  webpTypes,
  webpWithMetadata,
  type ByteOrder,
} from '../support/metadata-pictures';

// The metadata strip (Story 2.12, workers/files/src/strip.ts) on pictures built byte by byte (tests/support/metadata-pictures.ts): every kind of metadata is
// removed, what decodes the picture is not touched, the EXIF orientation is the one thing that is written back, and a picture that cannot be read is refused.

const jpegType = 'image/jpeg';
const pngType = 'image/png';
const webpType = 'image/webp';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const strip = (type: string, bytes: Uint8Array) => stripPictureMetadata(type, bytes);

/** The TIFF stream the strip writes: little-endian, one directory with one entry, 26 bytes. */
const orientationTiffHex = (orientation: number) => `49492a0008000000${'0100'}${'1201'}${'0300'}${'01000000'}0${orientation}000000${'00000000'}`;
/** The APP1 segment the strip writes into a JPEG: 36 bytes. */
const jpegOrientationBlock = (orientation: number) => `ffe10022457869660000${orientationTiffHex(orientation)}`;

const expectStripError = (type: string, bytes: Uint8Array) => {
  let caught: unknown;
  try {
    strip(type, bytes);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(StripError);
  expect((caught as StripError).name).toBe('StripError');
  // A fixed sentence: nothing of the picture is in it.
  expect((caught as StripError).message).toMatch(/^[A-Z][A-Za-z ,.'()-]+\.$/);
};

// JPEG ---------------------------------------------------------------------------------------------------------------------

describe('stripping a JPEG', () => {
  const decoding = new Set(['DQT', 'SOF0', 'DHT', 'SOS', 'DRI', 'APP14']);
  const decodingBytes = (bytes: Uint8Array) => segmentsOfJpeg(bytes).filter((entry) => decoding.has(entry.name)).map((entry) => hex(entry.bytes));

  it('leaves only the orientation block and the segments that decode the image, whatever metadata the picture carried', () => {
    const source = jpegWithMetadata({orientation: 6});
    expect(jpegNames(source)).toEqual(['SOI', 'APP0', 'APP1', 'APP1', 'APP2', 'APP2', 'APP2', 'APP13', 'COM', 'DQT', 'SOF0', 'DHT', 'SOS', 'EOI']);
    expect(markersIn(source).sort()).toEqual(metadataMarkers.filter((marker) => marker !== privateMarker).sort());
    const out = strip(jpegType, source);
    expect(jpegNames(out)).toEqual(['SOI', 'APP1', 'DQT', 'SOF0', 'DHT', 'SOS', 'EOI']);
    // None of the metadata is anywhere in the bytes: not in a segment, not after the end marker.
    expect(markersIn(out)).toEqual([]);
    expect(out.includes('Exif', 0, 'latin1')).toBe(true);
    expect(out.includes('JFIF', 0, 'latin1')).toBe(false);
    expect(out.includes('NovaCam', 0, 'latin1')).toBe(false);
    expect(out.includes('Photoshop', 0, 'latin1')).toBe(false);
    expect(out.includes('ICC_PROFILE', 0, 'latin1')).toBe(false);
    expect(out.includes('xmpmeta', 0, 'latin1')).toBe(false);
    expect(out.subarray(out.length - 2).toString('hex')).toBe('ffd9');
  });

  it('keeps DQT, SOF, DHT and the scan byte for byte and in order: the pixels are the original ones', () => {
    const source = jpegWithMetadata({width: 56, height: 40, seed: 5});
    const out = strip(jpegType, source);
    expect(decodingBytes(out)).toEqual(decodingBytes(source));
    expect(decodingBytes(out)).toHaveLength(4);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('writes orientation %i as exactly the 36 bytes of a minimal orientation-only APP1, right after the start marker', (orientation) => {
    const out = strip(jpegType, jpegWithMetadata({orientation}));
    expect(out.subarray(2, 38)).toHaveLength(36);
    expect(hex(out.subarray(2, 38))).toBe(jpegOrientationBlock(orientation));
    expect(segmentsOfJpeg(out).filter((entry) => entry.name === 'APP1')).toHaveLength(1);
    expect(readOrientation(jpegType, out)).toBe(orientation);
  });

  it('writes the full expected bytes for orientation 6 (a literal)', () => {
    const out = strip(jpegType, jpegWithMetadata({orientation: 6}));
    expect(hex(out.subarray(0, 38))).toBe('ffd8ffe1002245786966000049492a0008000000010012010300010000000600000000000000');
  });

  it.each<ByteOrder>(['II', 'MM'])('reads an orientation from a %s EXIF block and writes the same little-endian block either way', (order) => {
    const source = jpegWithMetadata({order, orientation: 8, seed: 2});
    expect(readOrientation(jpegType, source)).toBe(8);
    expect(hex(strip(jpegType, source).subarray(2, 38))).toBe(jpegOrientationBlock(8));
    expect(hex(strip(jpegType, source))).toBe(hex(strip(jpegType, jpegWithMetadata({order: 'II', orientation: 8, seed: 2}))));
  });

  it('writes no EXIF block at all when the picture has no orientation, none that is valid, or no EXIF', () => {
    const plain = ['ffd8', 'ffdb'];
    for (const source of [
      jpegWithMetadata({orientation: null}),
      jpegWithMetadata({exif: false}),
      jpegWithMetadata({orientation: 0}),
      jpegWithMetadata({orientation: 9}),
      jpegWithMetadata({orientation: 65535}),
    ]) {
      const out = strip(jpegType, source);
      expect(jpegNames(out)).toEqual(['SOI', 'DQT', 'SOF0', 'DHT', 'SOS', 'EOI']);
      expect(hex(out.subarray(0, 2))).toBe(plain[0]);
      expect(hex(out.subarray(2, 4))).toBe(plain[1]);
      expect(markersIn(out)).toEqual([]);
      expect(readOrientation(jpegType, source)).toBeNull();
    }
  });

  it('keeps no tag but the orientation: no GPS, no thumbnail, no maker note, no date, no camera', () => {
    const out = strip(jpegType, jpegWithMetadata({orientation: 3, gps: true, thumbnail: true, makerNote: true}));
    expect(markersIn(out)).toEqual([]);
    const app1 = segmentsOfJpeg(out).filter((entry) => entry.name === 'APP1');
    expect(app1).toHaveLength(1);
    expect(app1[0].bytes).toHaveLength(36);
    // There is no second JPEG (a thumbnail) inside the output: one start marker and one end marker.
    expect(out.toString('hex').match(/ffd8/g)).toHaveLength(1);
    expect(out.toString('hex').match(/ffd9/g)).toHaveLength(1);
  });

  it('keeps the Adobe APP14 segment and drops any other APP14 and APP1 that is not EXIF', () => {
    const source = jpegWithMetadata({adobe: true, otherApps: true, orientation: 6});
    expect(jpegNames(source).filter((name) => name === 'APP14')).toHaveLength(2);
    const out = strip(jpegType, source);
    expect(jpegNames(out)).toEqual(['SOI', 'APP1', 'APP14', 'DQT', 'SOF0', 'DHT', 'SOS', 'EOI']);
    const adobe = segmentsOfJpeg(source).filter((entry) => entry.name === 'APP14' && entry.bytes.includes('Adobe', 0, 'latin1'));
    expect(hex(segmentsOfJpeg(out).find((entry) => entry.name === 'APP14')!.bytes)).toBe(hex(adobe[0].bytes));
    expect(out.includes('Other14', 0, 'latin1')).toBe(false);
    expect(out.includes('not-exif', 0, 'latin1')).toBe(false);
  });

  it('cuts an Adobe APP14 segment to the 12 bytes a decoder reads, so it can hold nothing else, and drops one that says less', () => {
    const source = jpegWithMetadata({adobe: true, orientation: null});
    const standard = segmentsOfJpeg(source).find((entry) => entry.name === 'APP14' && entry.bytes.includes('Adobe', 0, 'latin1'))!;
    expect(standard.bytes).toHaveLength(16);
    const payload = standard.bytes.subarray(4);
    const swollen = Buffer.concat([Buffer.from([0xff, 0xee, 0x00, 0x02 + payload.length + 40]), payload, Buffer.from(`${gpsMarker}${'x'.repeat(40 - gpsMarker.length)}`, 'latin1')]);
    const withSwollen = Buffer.concat([source.subarray(0, source.indexOf(standard.bytes)), swollen, source.subarray(source.indexOf(standard.bytes) + standard.bytes.length)]);
    expect(withSwollen.includes(gpsMarker, 0, 'latin1')).toBe(true);
    const out = strip(jpegType, withSwollen);
    expect(out.includes(gpsMarker, 0, 'latin1')).toBe(false);
    const kept = segmentsOfJpeg(out).find((entry) => entry.name === 'APP14')!;
    expect(hex(kept.bytes)).toBe(hex(standard.bytes));
    // An 'Adobe' segment shorter than a decoder reads is none: dropped.
    const short = Buffer.concat([Buffer.from([0xff, 0xee, 0x00, 0x08]), Buffer.from('Adobe\0', 'latin1')]);
    const withShort = Buffer.concat([source.subarray(0, source.indexOf(standard.bytes)), short, source.subarray(source.indexOf(standard.bytes) + standard.bytes.length)]);
    expect(jpegNames(strip(jpegType, withShort))).not.toContain('APP14');
  });

  it('drops anything after the end marker', () => {
    const source = jpegWithMetadata({trailer: true});
    expect(source.includes(trailerMarker, 0, 'latin1')).toBe(true);
    const out = strip(jpegType, source);
    expect(out.includes(trailerMarker, 0, 'latin1')).toBe(false);
    expect(hex(out.subarray(out.length - 2))).toBe('ffd9');
    expect(out.length).toBeLessThan(source.length);
  });

  it('keeps a progressive picture whole: a frame and four scans, with their entropy-coded data', () => {
    const source = jpegWithMetadata({progressive: true, width: 40, height: 24, seed: 3});
    expect(jpegNames(source).filter((name) => name === 'SOS')).toHaveLength(4);
    const out = strip(jpegType, source);
    expect(jpegNames(out)).toEqual(['SOI', 'APP1', 'DQT', 'SOF2', 'DHT', 'SOS', 'SOS', 'SOS', 'SOS', 'EOI']);
    const keepProgressive = (bytes: Uint8Array) => segmentsOfJpeg(bytes).filter((entry) => ['DQT', 'SOF2', 'DHT', 'SOS'].includes(entry.name)).map((entry) => hex(entry.bytes));
    expect(keepProgressive(out)).toEqual(keepProgressive(source));
  });

  it('keeps the restart interval and every restart marker and stuffed byte of the scan', () => {
    const source = jpegWithMetadata({restartInterval: 3, width: 64, height: 40, seed: 7});
    const scan = segmentsOfJpeg(source).find((entry) => entry.name === 'SOS')!.bytes;
    expect(scan.toString('hex')).toMatch(/ffd0/);
    expect(scan.toString('hex')).toMatch(/ffd1/);
    const out = strip(jpegType, source);
    expect(jpegNames(out)).toEqual(['SOI', 'APP1', 'DQT', 'DRI', 'SOF0', 'DHT', 'SOS', 'EOI']);
    const keepRestart = (bytes: Uint8Array) => segmentsOfJpeg(bytes).filter((entry) => ['DQT', 'DRI', 'SOF0', 'DHT', 'SOS'].includes(entry.name)).map((entry) => hex(entry.bytes));
    expect(keepRestart(out)).toEqual(keepRestart(source));
  });

  it('skips 0xFF fill bytes before markers, and does not keep them', () => {
    const filled = jpegWithMetadata({fillBytes: true, seed: 4});
    const tight = jpegWithMetadata({fillBytes: false, seed: 4});
    expect(filled.length).toBeGreaterThan(tight.length);
    expect(hex(strip(jpegType, filled))).toBe(hex(strip(jpegType, tight)));
  });

  it('is a pure function: the same picture gives the same bytes and digest, and stripping again changes nothing', () => {
    const source = jpegWithMetadata({orientation: 5, seed: 9});
    const first = strip(jpegType, source);
    const second = strip(jpegType, Buffer.from(source));
    expect(hex(second)).toBe(hex(first));
    expect(sha256(second)).toBe(sha256(first));
    expect(hex(strip(jpegType, first))).toBe(hex(first));
    // It does not touch its input, and takes a plain Uint8Array.
    const copy = Buffer.from(source);
    strip(jpegType, new Uint8Array(source));
    expect(hex(source)).toBe(hex(copy));
    expect(first).toBeInstanceOf(Buffer);
  });

  it('gives the ready-made GPS picture an orientation and no location', () => {
    const source = gpsJpeg();
    expect(source.includes(gpsMarker, 0, 'latin1')).toBe(true);
    expect(readOrientation(jpegType, source)).toBe(gpsJpegOrientation);
    expect(source.length).toBeLessThan(200 * 1024);
    const out = strip(jpegType, source);
    expect(out.includes(gpsMarker, 0, 'latin1')).toBe(false);
    expect(hex(out.subarray(2, 38))).toBe(jpegOrientationBlock(gpsJpegOrientation));
    expect(gpsJpeg({width: 1200, height: 900}).length).toBeLessThan(200 * 1024);
  });

  it('refuses a picture it cannot read to its end, and publishes nothing of it', () => {
    const source = jpegWithMetadata({orientation: 6});
    // Truncated at every kind of place: in the header, in a segment, in the scan, just before the end marker.
    const pictureEnd = segmentsOfJpeg(source).at(-1)!.offset + 2;
    const cuts = [0, 1, 2, 3, 5, 20, 100, 300, pictureEnd - 200, pictureEnd - 70, pictureEnd - 3, pictureEnd - 2, pictureEnd - 1];
    for (const cut of cuts) expectStripError(jpegType, source.subarray(0, cut));
    // A cut inside the trailer still ends at the end marker, which is a whole picture.
    expect(hex(strip(jpegType, source.subarray(0, pictureEnd + 3)))).toBe(hex(strip(jpegType, source)));
    const noEnd = baselineJpeg();
    expectStripError(jpegType, noEnd.subarray(0, noEnd.length - 2));
    expectStripError(jpegType, noEnd.subarray(0, noEnd.length - 1));
    expectStripError(jpegType, new Uint8Array(0));
    expectStripError(jpegType, Buffer.from('GIF89a not a picture'));
  });

  it('refuses a segment whose length runs past the end of the file, a length under 2, garbage between segments and a marker it does not know', () => {
    const source = Buffer.from(baselineJpeg({seed: 2}));
    const dqt = source.indexOf(Buffer.from([0xff, 0xdb]));
    const sof = source.indexOf(Buffer.from([0xff, 0xc0]));

    const huge = Buffer.from(source);
    huge.writeUInt16BE(0xffff, dqt + 2);
    expectStripError(jpegType, huge);

    const tiny = Buffer.from(source);
    tiny.writeUInt16BE(1, dqt + 2);
    expectStripError(jpegType, tiny);

    const garbage = Buffer.concat([source.subarray(0, dqt), Buffer.from([0x00]), source.subarray(dqt)]);
    expectStripError(jpegType, garbage);

    const unknown = Buffer.from(source);
    unknown[sof + 1] = 0xf3;
    expectStripError(jpegType, unknown);

    const twice = Buffer.concat([source.subarray(0, 2), Buffer.from([0xff, 0xd8]), source.subarray(2)]);
    expectStripError(jpegType, twice);

    // No frame before the scan, and no scan at all.
    const noFrame = Buffer.concat([source.subarray(0, sof), source.subarray(source.indexOf(Buffer.from([0xff, 0xc4])))]);
    expectStripError(jpegType, noFrame);
    expectStripError(jpegType, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expectStripError(jpegType, Buffer.concat([source.subarray(0, source.indexOf(Buffer.from([0xff, 0xda]))), Buffer.from([0xff, 0xd9])]));
  });

  it('refuses a picture that is not a JPEG, and a JPEG declared as another type', () => {
    expectStripError(jpegType, pngWithMetadata());
    expectStripError(jpegType, webpWithMetadata());
    expectStripError(pngType, jpegWithMetadata());
    expectStripError(webpType, jpegWithMetadata());
  });
});

// PNG ----------------------------------------------------------------------------------------------------------------------

describe('stripping a PNG', () => {
  const keptTypes = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'acTL', 'fcTL', 'fdAT']);
  const keptChunks = (bytes: Uint8Array) => chunksOfPng(bytes).filter((chunk) => keptTypes.has(chunk.type)).map((chunk) => hex(chunk.bytes));
  const exifChunk = (orientation: number) => hex(pngChunk('eXIf', Buffer.from(orientationTiffHex(orientation), 'hex')));

  it('leaves only the critical and the listed chunks and an orientation-only eXIf before the first IDAT', () => {
    const source = pngWithMetadata({orientation: 6});
    expect(pngTypes(source)).toEqual(['IHDR', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'iCCP', 'bKGD', 'pHYs', 'tIME', 'tEXt', 'zTXt', 'iTXt', 'eXIf', 'IDAT', 'IDAT', 'tEXt', 'IEND']);
    expect(markersIn(source).length).toBeGreaterThan(4);
    const out = strip(pngType, source);
    expect(pngTypes(out)).toEqual(['IHDR', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'eXIf', 'IDAT', 'IDAT', 'IEND']);
    expect(markersIn(out)).toEqual([]);
    for (const word of ['tEXt', 'zTXt', 'iTXt', 'tIME', 'iCCP', 'pHYs', 'sPLT', 'hIST']) expect(out.includes(word, 0, 'latin1'), word).toBe(false);
  });

  it('keeps every listed chunk byte for byte (the CRC too), so the IDAT data is the original', () => {
    const source = pngWithMetadata({width: 40, height: 30, seed: 3});
    const out = strip(pngType, source);
    expect(keptChunks(out)).toEqual(keptChunks(source));
    const idat = (bytes: Uint8Array) => Buffer.concat(chunksOfPng(bytes).filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
    expect(hex(idat(out))).toBe(hex(idat(source)));
    expect(idat(out).length).toBeGreaterThan(0);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('writes orientation %i as an eXIf chunk of 26 bytes of TIFF with a correct CRC', (orientation) => {
    const out = strip(pngType, pngWithMetadata({orientation}));
    const exif = chunksOfPng(out).filter((chunk) => chunk.type === 'eXIf');
    expect(exif).toHaveLength(1);
    expect(exif[0].data).toHaveLength(26);
    expect(hex(exif[0].data)).toBe(orientationTiffHex(orientation));
    expect(hex(exif[0].bytes)).toBe(exifChunk(orientation));
    expect(exif[0].bytes.readUInt32BE(0)).toBe(26);
    expect(exif[0].bytes.readUInt32BE(exif[0].bytes.length - 4)).toBe(crc32(exif[0].bytes.subarray(4, exif[0].bytes.length - 4)) >>> 0);
    // Right before the first IDAT.
    const types = pngTypes(out);
    expect(types[types.indexOf('IDAT') - 1]).toBe('eXIf');
    expect(readOrientation(pngType, out)).toBe(orientation);
  });

  it('writes these exact bytes for orientation 6 (a literal, with its CRC)', () => {
    const out = strip(pngType, pngWithMetadata({orientation: 6}));
    expect(hex(chunksOfPng(out).find((chunk) => chunk.type === 'eXIf')!.bytes)).toBe('0000001a65584966' + '49492a0008000000010012010300010000000600000000000000' + 'b7481129');
  });

  it.each<ByteOrder>(['II', 'MM'])('reads an orientation from a %s eXIf chunk, with or without the Exif header in front, and from one after the image data', (order) => {
    const reference = hex(strip(pngType, pngWithMetadata({orientation: 3, seed: 8})));
    for (const options of [{}, {exifHeader: true}, {exifAfterImage: true}]) {
      const source = pngWithMetadata({order, orientation: 3, seed: 8, ...options});
      expect(readOrientation(pngType, source), JSON.stringify(options)).toBe(3);
      expect(hex(strip(pngType, source)), JSON.stringify(options)).toBe(reference);
    }
  });

  it('writes no eXIf chunk when the picture has no orientation, none that is valid, or no EXIF', () => {
    for (const source of [pngWithMetadata({orientation: null}), pngWithMetadata({exif: false}), pngWithMetadata({orientation: 0}), pngWithMetadata({orientation: 9})]) {
      const out = strip(pngType, source);
      expect(pngTypes(out)).toEqual(['IHDR', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'IDAT', 'IDAT', 'IEND']);
      expect(markersIn(out)).toEqual([]);
      expect(readOrientation(pngType, source)).toBeNull();
    }
  });

  it('drops the exotic ancillary chunks (sPLT, hIST, private ones) and keeps tRNS', () => {
    const source = pngWithMetadata({exotic: true, transparency: true, orientation: null});
    expect(pngTypes(source)).toEqual(expect.arrayContaining(['sPLT', 'hIST', 'prVt', 'tRNS']));
    const out = strip(pngType, source);
    expect(pngTypes(out)).toEqual(['IHDR', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'tRNS', 'IDAT', 'IDAT', 'IEND']);
    expect(out.includes(privateMarker, 0, 'latin1')).toBe(false);
  });

  it('keeps the animation chunks acTL, fcTL and fdAT, in order', () => {
    const source = pngWithMetadata({animated: true, orientation: 4});
    const out = strip(pngType, source);
    expect(pngTypes(out)).toEqual(['IHDR', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'acTL', 'fcTL', 'eXIf', 'IDAT', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
    expect(keptChunks(out)).toEqual(keptChunks(source));
  });

  it('drops the bytes after IEND', () => {
    const source = pngWithMetadata({trailer: true});
    expect(source.includes(trailerMarker, 0, 'latin1')).toBe(true);
    const out = strip(pngType, source);
    expect(out.includes(trailerMarker, 0, 'latin1')).toBe(false);
    expect(hex(out.subarray(out.length - 12))).toBe('0000000049454e44ae426082');
  });

  it('is a pure function: the same picture gives the same bytes and digest, and stripping again changes nothing', () => {
    const source = pngWithMetadata({orientation: 7, seed: 5});
    const first = strip(pngType, source);
    expect(sha256(strip(pngType, Buffer.from(source)))).toBe(sha256(first));
    expect(hex(strip(pngType, first))).toBe(hex(first));
    const copy = Buffer.from(source);
    strip(pngType, new Uint8Array(source));
    expect(hex(source)).toBe(hex(copy));
  });

  it('refuses a broken chunk length, a picture without IEND or IDAT, a wrong signature, a first chunk that is not IHDR and a chunk type that is not letters', () => {
    const source = Buffer.from(pngWithMetadata({trailer: false}));
    const chunks = chunksOfPng(source);
    const at = (type: string) => chunks.find((chunk) => chunk.type === type)!.offset;

    const longer = Buffer.from(source);
    longer.writeUInt32BE(source.length, at('gAMA'));
    expectStripError(pngType, longer);

    const enormous = Buffer.from(source);
    enormous.writeUInt32BE(0x80000000, at('gAMA'));
    expectStripError(pngType, enormous);
    enormous.writeUInt32BE(0xffffffff, at('gAMA'));
    expectStripError(pngType, enormous);

    expectStripError(pngType, source.subarray(0, source.length - 12));
    expectStripError(pngType, source.subarray(0, source.length - 1));
    expectStripError(pngType, source.subarray(0, 8));
    expectStripError(pngType, source.subarray(0, 20));
    expectStripError(pngType, new Uint8Array(0));

    const signature = Buffer.from(source);
    signature[1] = 0x51;
    expectStripError(pngType, signature);

    const notFirst = Buffer.concat([pngSignature, ...chunks.filter((chunk) => chunk.type !== 'IHDR').map((chunk) => chunk.bytes)]);
    expectStripError(pngType, notFirst);

    const letters = Buffer.from(source);
    letters[at('gAMA') + 4] = 0x31;
    expectStripError(pngType, letters);

    const noImage = Buffer.concat([pngSignature, ...chunks.filter((chunk) => chunk.type !== 'IDAT').map((chunk) => chunk.bytes)]);
    expectStripError(pngType, noImage);

    const endWithData = Buffer.concat([pngSignature, ...chunks.filter((chunk) => chunk.type !== 'IEND').map((chunk) => chunk.bytes), pngChunk('IEND', Buffer.from([1]))]);
    expectStripError(pngType, endWithData);

    const twoHeaders = Buffer.concat([pngSignature, chunks[0].bytes, chunks[0].bytes, ...chunks.slice(1).map((chunk) => chunk.bytes)]);
    expectStripError(pngType, twoHeaders);
  });

  it('refuses a picture that is not a PNG', () => {
    expectStripError(pngType, jpegWithMetadata());
    expectStripError(pngType, webpWithMetadata());
    expectStripError(jpegType, pngWithMetadata());
    expectStripError(webpType, pngWithMetadata());
  });
});

// WebP ---------------------------------------------------------------------------------------------------------------------

describe('stripping a WebP', () => {
  const keptTypes = new Set(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF']);
  const keptChunks = (bytes: Uint8Array) => chunksOfWebp(bytes).filter((chunk) => keptTypes.has(chunk.type) && chunk.type !== 'VP8X').map((chunk) => hex(chunk.bytes));
  const flagsOf = (bytes: Uint8Array) => chunksOfWebp(bytes)[0].data[0];
  const riffSizeRight = (bytes: Uint8Array) => Buffer.from(bytes).readUInt32LE(4) + 8 === bytes.length;
  const exifChunk = (orientation: number) => `45584946${'1a000000'}${orientationTiffHex(orientation)}`;

  it.each(['lossless', 'lossy'] as const)('passes a simple %s file unchanged: it holds no metadata', (kind) => {
    const source = simpleWebp(kind);
    const out = strip(webpType, source);
    expect(hex(out)).toBe(hex(source));
    expect(out).not.toBe(source);
    expect(readOrientation(webpType, source)).toBeNull();
    // What follows the RIFF extent is not part of the picture.
    expect(hex(strip(webpType, Buffer.concat([source, Buffer.from(trailerMarker)])))).toBe(hex(source));
  });

  it('removes ICCP, EXIF, XMP and unknown chunks, clears their flags, rewrites the RIFF size and keeps the orientation', () => {
    const source = webpWithMetadata({orientation: 6});
    expect(webpTypes(source)).toEqual(['VP8X', 'ICCP', 'VP8L', 'EXIF', 'XMP ', 'XYZW']);
    expect(flagsOf(source)).toBe(0x20 | 0x08 | 0x04);
    const out = strip(webpType, source);
    expect(webpTypes(out)).toEqual(['VP8X', 'VP8L', 'EXIF']);
    expect(markersIn(out)).toEqual([]);
    expect(flagsOf(out)).toBe(0x08);
    expect(riffSizeRight(out)).toBe(true);
    expect(out.length % 2).toBe(0);
    expect(hex(chunksOfWebp(out)[2].bytes)).toBe(exifChunk(6));
    expect(readOrientation(webpType, out)).toBe(6);
    // The image chunk and the canvas (all but the flags byte) are the original's.
    expect(keptChunks(out)).toEqual(keptChunks(source));
    expect(hex(chunksOfWebp(out)[0].data.subarray(1))).toBe(hex(chunksOfWebp(source)[0].data.subarray(1)));
    expect(hex(out.subarray(0, 4))).toBe('52494646');
    expect(hex(out.subarray(8, 12))).toBe('57454250');
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('writes orientation %i as an EXIF chunk of 26 bytes after the image data, with the EXIF flag', (orientation) => {
    const out = strip(webpType, webpWithMetadata({orientation}));
    const exif = chunksOfWebp(out).filter((chunk) => chunk.type === 'EXIF');
    expect(exif).toHaveLength(1);
    expect(hex(exif[0].bytes)).toBe(exifChunk(orientation));
    expect(webpTypes(out).at(-1)).toBe('EXIF');
    expect(flagsOf(out) & 0x08).toBe(0x08);
    expect(riffSizeRight(out)).toBe(true);
  });

  it.each<ByteOrder>(['II', 'MM'])('reads an orientation from a %s EXIF chunk, with or without the Exif header in front', (order) => {
    const reference = hex(strip(webpType, webpWithMetadata({orientation: 2})));
    for (const options of [{}, {exifHeader: true}]) {
      const source = webpWithMetadata({order, orientation: 2, ...options});
      expect(readOrientation(webpType, source), JSON.stringify(options)).toBe(2);
      expect(hex(strip(webpType, source)), JSON.stringify(options)).toBe(reference);
    }
  });

  it('sets the EXIF flag only when an orientation is kept, and clears the ICC and XMP flags always', () => {
    for (const source of [webpWithMetadata({orientation: null}), webpWithMetadata({exif: false}), webpWithMetadata({orientation: 0}), webpWithMetadata({orientation: 9})]) {
      const out = strip(webpType, source);
      expect(webpTypes(out)).toEqual(['VP8X', 'VP8L']);
      expect(flagsOf(out)).toBe(0);
      expect(riffSizeRight(out)).toBe(true);
      expect(markersIn(out)).toEqual([]);
      expect(readOrientation(webpType, source)).toBeNull();
    }
  });

  it('keeps a lossy image with its alpha chunk, and the alpha flag', () => {
    const source = webpWithMetadata({lossy: true, alpha: true, orientation: null});
    expect(flagsOf(source)).toBe(0x20 | 0x10 | 0x08 | 0x04);
    const out = strip(webpType, source);
    expect(webpTypes(out)).toEqual(['VP8X', 'ALPH', 'VP8 ']);
    expect(flagsOf(out)).toBe(0x10);
    expect(keptChunks(out)).toEqual(keptChunks(source));
    expect(riffSizeRight(out)).toBe(true);
  });

  it('keeps an animation: ANIM and every ANMF frame, and the animation flag', () => {
    const source = webpWithMetadata({animated: true, orientation: 5});
    expect(webpTypes(source)).toEqual(['VP8X', 'ICCP', 'ANIM', 'ANMF', 'ANMF', 'EXIF', 'XMP ', 'XYZW']);
    const out = strip(webpType, source);
    expect(webpTypes(out)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF', 'EXIF']);
    expect(flagsOf(out)).toBe(0x02 | 0x08);
    expect(keptChunks(out)).toEqual(keptChunks(source));
    expect(riffSizeRight(out)).toBe(true);
  });

  it('keeps the padding of an odd-sized chunk it keeps and drops that of one it drops', () => {
    const canvas = Buffer.alloc(10);
    canvas[0] = 0x10 | 0x20;
    const source = riffWebp(webpChunk('VP8X', canvas), webpChunk('ICCP', Buffer.from('abc')), webpChunk('ALPH', Buffer.from([0, 1, 2])), webpChunk('VP8L', vp8lImage));
    const out = strip(webpType, source);
    expect(webpTypes(out)).toEqual(['VP8X', 'ALPH', 'VP8L']);
    expect(hex(chunksOfWebp(out)[1].bytes)).toBe('414c504803000000000102' + '00');
    expect(riffSizeRight(out)).toBe(true);
    expect(flagsOf(out)).toBe(0x10);
  });

  it('is a pure function: the same picture gives the same bytes and digest, and stripping again changes nothing', () => {
    const source = webpWithMetadata({orientation: 8});
    const first = strip(webpType, source);
    expect(sha256(strip(webpType, Buffer.from(source)))).toBe(sha256(first));
    expect(hex(strip(webpType, first))).toBe(hex(first));
    const copy = Buffer.from(source);
    strip(webpType, new Uint8Array(source));
    expect(hex(source)).toBe(hex(copy));
  });

  it('refuses a RIFF size larger than the file, a chunk that runs past the end, a truncated file, a file that is not a WebP and one with no image', () => {
    const source = Buffer.from(webpWithMetadata({trailer: false}));

    const size = Buffer.from(source);
    size.writeUInt32LE(source.length, 4);
    expectStripError(webpType, size);

    const chunk = Buffer.from(source);
    // The size of the second chunk: the first (VP8X) is 8 + 10 bytes from offset 12, so the second chunk's header is at 30 and its size at 34.
    chunk.writeUInt32LE(0x00ffffff, 34);
    expectStripError(webpType, chunk);
    const first = Buffer.from(source);
    first.writeUInt32LE(0xffffffff, 16);
    expectStripError(webpType, first);

    expectStripError(webpType, source.subarray(0, source.length - 1));
    expectStripError(webpType, source.subarray(0, 12));
    expectStripError(webpType, source.subarray(0, 20));
    expectStripError(webpType, new Uint8Array(0));

    const wrong = Buffer.from(source);
    wrong.write('WEBX', 8, 'latin1');
    expectStripError(webpType, wrong);

    const canvas = Buffer.alloc(10);
    expectStripError(webpType, riffWebp(webpChunk('VP8X', canvas), webpChunk('ICCP', Buffer.from('abcd'))));
    expectStripError(webpType, riffWebp(webpChunk('EXIF', Buffer.from('abcd')), webpChunk('VP8L', vp8lImage)));
    expectStripError(webpType, riffWebp(webpChunk('VP8X', Buffer.alloc(4)), webpChunk('VP8L', vp8lImage)));
    expectStripError(webpType, riffWebp(webpChunk('VP8X', canvas), webpChunk('VP8L', vp8lImage), webpChunk('VP8X', canvas)));
    expectStripError(webpType, riffWebp());
  });

  it('does not keep a chunk that follows the image in a file with no VP8X header', () => {
    const source = riffWebp(webpChunk('VP8L', vp8lImage), webpChunk('EXIF', exifTiff({})));
    const out = strip(webpType, source);
    expect(webpTypes(out)).toEqual(['VP8L']);
    expect(markersIn(out)).toEqual([]);
    expect(hex(out)).toBe(hex(simpleWebp()));
  });

  it('refuses a picture that is not a WebP', () => {
    expectStripError(webpType, jpegWithMetadata());
    expectStripError(webpType, pngWithMetadata());
    expectStripError(jpegType, webpWithMetadata());
    expectStripError(pngType, webpWithMetadata());
  });
});

// The orientation, in every format ---------------------------------------------------------------------------------------

describe('reading the orientation', () => {
  const plainJpeg = baselineJpeg({seed: 1});
  const plainPng = pngWithMetadata({exif: false, text: false, icc: false, physical: false, appearance: false, trailer: false});
  const canvas = Buffer.alloc(10);
  canvas[0] = 0x08;

  /** A picture of each format whose only metadata is this TIFF stream. */
  const carrying = {
    [jpegType]: (tiff: Uint8Array) => Buffer.concat([plainJpeg.subarray(0, 2), exifSegment(tiff), plainJpeg.subarray(2)]),
    [pngType]: (tiff: Uint8Array) => {
      const chunks = chunksOfPng(plainPng);
      const at = chunks.findIndex((chunk) => chunk.type === 'IDAT');
      return Buffer.concat([pngSignature, ...chunks.slice(0, at).map((chunk) => chunk.bytes), pngChunk('eXIf', tiff), ...chunks.slice(at).map((chunk) => chunk.bytes)]);
    },
    [webpType]: (tiff: Uint8Array) => riffWebp(webpChunk('VP8X', canvas), webpChunk('VP8L', vp8lImage), webpChunk('EXIF', tiff)),
  };
  const hasBlock = (type: string, bytes: Uint8Array) => (type === jpegType ? jpegNames(bytes).includes('APP1') : type === pngType ? pngTypes(bytes).includes('eXIf') : webpTypes(bytes).includes('EXIF'));

  const valid = exifTiff({orientation: 6, gps: false, thumbnail: false});
  const withEntries = (...entries: ReturnType<typeof shortEntry>[]) => tiffStream('II', {ifd0: entries});
  const cases: [string, Buffer, number | null][] = [
    ['a valid block', valid, 6],
    ['big-endian', exifTiff({order: 'MM', orientation: 4}), 4],
    ['orientation 0', exifTiff({orientation: 0}), null],
    ['orientation 9', exifTiff({orientation: 9}), null],
    ['orientation 255', exifTiff({orientation: 255}), null],
    ['orientation 65535', exifTiff({orientation: 65535}), null],
    ['no orientation tag', exifTiff({orientation: null}), null],
    ['a type that is not SHORT', tiffStream('II', {ifd0: [longEntry('II', 0x0112, 6)]}), null],
    ['a count of two', tiffStream('II', {ifd0: [{...shortEntry('II', 0x0112, 6, 3)}]}), null],
    ['text where a number goes', tiffStream('II', {ifd0: [asciiEntry(0x0112, 'ab')]}), null],
    ['the tag in the second directory only', tiffStream('II', {ifd0: [asciiEntry(0x010f, 'x')], ifd1: [shortEntry('II', 0x0112, 3)]}), null],
    ['the tag among others', withEntries(asciiEntry(0x010f, 'NovaCam'), shortEntry('II', 0x0112, 2), asciiEntry(0x0131, 'x')), 2],
    ['a directory offset past the end', Buffer.concat([valid.subarray(0, 4), Buffer.from([0xf0, 0xff, 0xff, 0x7f]), valid.subarray(8)]), null],
    ['a directory offset of 0xFFFFFFFF', Buffer.concat([valid.subarray(0, 4), Buffer.from([0xff, 0xff, 0xff, 0xff]), valid.subarray(8)]), null],
    ['a directory offset inside the header', Buffer.concat([valid.subarray(0, 4), Buffer.from([0x04, 0, 0, 0]), valid.subarray(8)]), null],
    ['a directory offset that leaves no room for its count', Buffer.concat([valid.subarray(0, 4), Buffer.from([valid.length - 1, 0, 0, 0]), valid.subarray(8)]), null],
    ['a huge entry count', Buffer.concat([valid.subarray(0, 8), Buffer.from([0xff, 0xff]), valid.subarray(10)]), null],
    ['a count of zero', Buffer.concat([valid.subarray(0, 8), Buffer.from([0x00, 0x00]), valid.subarray(10)]), null],
    ['a stream cut in the middle of its entries', valid.subarray(0, 20), null],
    ['a stream cut in the header', valid.subarray(0, 6), null],
    ['an empty stream', Buffer.alloc(0), null],
    ['a wrong byte-order mark', Buffer.concat([Buffer.from('XX'), valid.subarray(2)]), null],
    ['a wrong magic number', Buffer.concat([valid.subarray(0, 2), Buffer.from([0x2b, 0x00]), valid.subarray(4)]), null],
  ];

  for (const [type, carry] of Object.entries(carrying)) {
    it.each(cases)(`${type}: %s`, (_name, tiff, expected) => {
      const source = carry(tiff);
      expect(readOrientation(type, source)).toBe(expected);
      const out = strip(type, source);
      expect(hasBlock(type, out)).toBe(expected !== null);
      expect(readOrientation(type, out)).toBe(expected);
      expect(markersIn(out)).toEqual([]);
    });
  }

  it('takes the first EXIF segment that holds a valid orientation', () => {
    const plain = baselineJpeg();
    const source = Buffer.concat([plain.subarray(0, 2), exifSegment(exifTiff({orientation: 0})), exifSegment(exifTiff({orientation: 3})), exifSegment(exifTiff({orientation: 5})), plain.subarray(2)]);
    expect(readOrientation(jpegType, source)).toBe(3);
    expect(hex(strip(jpegType, source).subarray(2, 38))).toBe(jpegOrientationBlock(3));
  });

  it('is null, and throws nothing, for a picture that is damaged, of the wrong type, or not a picture', () => {
    expect(readOrientation(jpegType, new Uint8Array(0))).toBeNull();
    expect(readOrientation(pngType, new Uint8Array(0))).toBeNull();
    expect(readOrientation(webpType, new Uint8Array(0))).toBeNull();
    expect(readOrientation('image/gif', jpegWithMetadata())).toBeNull();
    expect(readOrientation('', jpegWithMetadata())).toBeNull();
    expect(readOrientation(pngType, jpegWithMetadata())).toBeNull();
    expect(readOrientation(jpegType, Buffer.from('not a picture at all'))).toBeNull();
    // A picture cut off after its EXIF still says what the EXIF said (the damage comes later), and cut inside it says nothing.
    expect(readOrientation(jpegType, jpegWithMetadata({orientation: 6}).subarray(0, 120))).toBeNull();
  });
});

// Every format -----------------------------------------------------------------------------------------------------------

describe('the strip as a whole', () => {
  it('refuses a content type that is not a JPEG, a PNG or a WebP', () => {
    for (const type of ['image/gif', 'image/heic', 'application/octet-stream', 'image/JPEG', '', 'image/jpeg; charset=x']) {
      expectStripError(type, jpegWithMetadata());
      expectStripError(type, pngWithMetadata());
    }
  });

  it('never makes a picture longer than a few dozen bytes more than it was, and never keeps a marker', () => {
    const pictures: [string, Buffer][] = [
      [jpegType, baselineJpeg()],
      [pngType, pngWithMetadata({exif: false, text: false, icc: false, physical: false, appearance: false, trailer: false})],
      [webpType, simpleWebp()],
    ];
    for (const [type, plain] of pictures) {
      // A picture with nothing to remove and an orientation of its own is the worst case: the block that was removed is the block that is written.
      expect(strip(type, plain).length).toBeLessThanOrEqual(plain.length + 40);
    }
    for (const [type, loaded] of [[jpegType, jpegWithMetadata()], [pngType, pngWithMetadata({exotic: true})], [webpType, webpWithMetadata()]] as const) {
      const out = strip(type, loaded);
      expect(out.length).toBeLessThan(loaded.length);
      expect(markersIn(out)).toEqual([]);
    }
  });

  it('keeps the gateway honest: strip.ts imports node:zlib and nothing else, reads no environment and logs nothing', () => {
    const source = readFileSync(new URL('../../workers/files/src/strip.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect([...code.matchAll(/^import\s[^;]*?from '([^']+)';/gm)].map((match) => match[1])).toEqual(['node:zlib']);
    expect(code).not.toMatch(/\brequire\(|\bimport\(|process\.|console\.|\blog\(|\benum\s+\w+\s*\{|constructor\s*\([^)]*\b(?:private|public|readonly)\s|Date\.now|Math\.random|\bfetch\(/);
  });
});

// A seeded fuzz ----------------------------------------------------------------------------------------------------------

/** A small deterministic generator (mulberry32): the same seed gives the same mutations on every machine. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('damaged pictures', () => {
  const sources: [string, Buffer][] = [
    [jpegType, jpegWithMetadata({orientation: 6, seed: 1})],
    [pngType, pngWithMetadata({orientation: 6, seed: 1, exotic: true})],
    [webpType, webpWithMetadata({orientation: 6})],
  ];

  /** What stripping does with these bytes: a result, or a StripError. Any other failure is a bug and is rethrown. */
  const attempt = (type: string, bytes: Uint8Array) => {
    try {
      return strip(type, bytes);
    } catch (error) {
      if (error instanceof StripError) return null;
      throw error;
    }
  };

  it.each(sources)('%s: 2,000 mutated and truncated copies are stripped or refused, never anything else, and what is stripped is stable', (type, source) => {
    const random = generator(2012);
    let stripped = 0;
    let refused = 0;
    for (let round = 0; round < 2000; round += 1) {
      const copy = Buffer.from(source);
      let candidate: Buffer = copy;
      const kind = round % 4;
      if (kind === 0) {
        copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
      } else if (kind === 1) {
        for (let flips = 1 + Math.floor(random() * 3); flips > 0; flips -= 1) copy[Math.floor(random() * copy.length)] ^= 1 << Math.floor(random() * 8);
      } else if (kind === 2) {
        candidate = copy.subarray(0, Math.floor(random() * copy.length));
      } else {
        // A burst of random bytes over a stretch.
        const start = Math.floor(random() * copy.length);
        for (let at = start; at < Math.min(copy.length, start + 1 + Math.floor(random() * 24)); at += 1) copy[at] = Math.floor(random() * 256);
      }
      const before = hex(candidate);
      const out = attempt(type, candidate);
      // Reading the orientation never throws either.
      expect(() => readOrientation(type, candidate)).not.toThrow();
      expect(hex(candidate)).toBe(before);
      if (out === null) {
        refused += 1;
        continue;
      }
      stripped += 1;
      expect(out.length).toBeLessThanOrEqual(candidate.length + 40);
      // What was stripped is its own strip: the output is in the form the strip writes.
      const again = attempt(type, out);
      expect(again === null ? null : hex(again)).toBe(hex(out));
    }
    expect(stripped).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });

  it('never keeps a marker when only what the strip drops is damaged: the payload of every metadata segment, chunk and trailer, 2,000 times each', () => {
    const random = generator(77);
    const regions = {
      [jpegType]: (bytes: Buffer) => segmentsOfJpeg(bytes).filter((entry) => /^APP([0-9]|1[0-35]|14)$/.test(entry.name) && entry.name !== 'APP14').concat(segmentsOfJpeg(bytes).filter((entry) => entry.name === 'COM')).map((entry) => [entry.offset + 4, entry.offset + entry.bytes.length] as const),
      [pngType]: (bytes: Buffer) => chunksOfPng(bytes).filter((chunk) => !['IHDR', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'IDAT', 'IEND', 'tRNS', 'PLTE', 'acTL', 'fcTL', 'fdAT'].includes(chunk.type)).map((chunk) => [chunk.offset + 8, chunk.offset + 8 + chunk.data.length] as const),
      [webpType]: (bytes: Buffer) => chunksOfWebp(bytes).filter((chunk) => !['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF'].includes(chunk.type)).map((chunk) => [chunk.offset + 8, chunk.offset + 8 + chunk.data.length] as const),
    };
    for (const [type, source] of sources) {
      const spans = regions[type as keyof typeof regions](source).filter(([from, to]) => to > from);
      expect(spans.length).toBeGreaterThan(2);
      for (let round = 0; round < 2000; round += 1) {
        const copy = Buffer.from(source);
        const [from, to] = spans[Math.floor(random() * spans.length)];
        for (let hits = 1 + Math.floor(random() * 4); hits > 0; hits -= 1) copy[from + Math.floor(random() * (to - from))] = Math.floor(random() * 256);
        const out = strip(type, copy);
        expect(markersIn(out), `${type} round ${round}`).toEqual([]);
        expect(out.length).toBeLessThanOrEqual(copy.length + 40);
      }
    }
  });

  it('refuses a picture made of nothing but random bytes, quickly', () => {
    const random = generator(5);
    const noise = Buffer.alloc(64 * 1024);
    for (let at = 0; at < noise.length; at += 1) noise[at] = Math.floor(random() * 256);
    for (const [type] of sources) expectStripError(type, noise);
    // A start marker and then endless fill, and a scan that never ends: no loop that does not advance.
    expectStripError(jpegType, Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(100_000, 0xff)]));
    expectStripError(jpegType, Buffer.concat([baselineJpeg().subarray(0, 100), Buffer.alloc(100_000, 0xff)]));
    expectStripError(jpegType, Buffer.concat([baselineJpeg().subarray(0, baselineJpeg().indexOf(Buffer.from([0xff, 0xda])) + 14), Buffer.alloc(100_000, 0x41)]));
  });

  it('mentions the comment marker only in the sources', () => {
    for (const [type, source] of sources) {
      expect(source.includes(commentMarker, 0, 'latin1') || source.includes(gpsMarker, 0, 'latin1')).toBe(true);
      expect(strip(type, source).includes(commentMarker, 0, 'latin1')).toBe(false);
    }
  });
});
