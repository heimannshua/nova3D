import {crc32, deflateSync} from 'node:zlib';

// Pictures that CARRY metadata (Story 2.12), for the tests of the metadata strip (workers/files/src/strip.ts) and of everything that sends a picture through
// the gateway's attach step: the unit tests of the strip and of the attach, the integration test that stores a stripped copy in real Storage, and the browser tests
// that confirm a picture with a location in it.
//
// Nothing here is read from a file: every picture is BUILT, byte by byte, from the structure of its format, so a test can say exactly what is in it and exactly what
// must be gone. The images are real (a browser decodes them): a baseline or progressive JPEG whose 8 x 8 blocks are flat colours (one DC coefficient each, so the
// encoder is a few dozen lines and needs no DCT), a truecolour PNG with a real zlib stream and real CRCs, and a lossless WebP. Only `node:zlib` is imported.
//
// Every piece of metadata carries a distinctive ASCII marker (`gpsMarker`, `makerNoteMarker`, ...). `metadataMarkers` lists them all: after a strip, none of them may
// be found anywhere in the bytes. The one thing that must survive is the EXIF orientation (`orientation`, 1 to 8).

// Markers --------------------------------------------------------------------------------------------------------------------

/** Text that sits in the GPS directory of every EXIF block built here (as the GPSProcessingMethod). If it is found in a picture, its location tags are still there. */
export const gpsMarker = 'NOVA3D-GPS-MARKER-7f3a9c';
/** Text in the EXIF maker note. */
export const makerNoteMarker = 'NOVA3D-MAKERNOTE-5b21d0';
/** Text in the XMP packet (which also names a place). */
export const xmpMarker = 'NOVA3D-XMP-MARKER-e8c417';
/** Text in the ICC profile. */
export const iccMarker = 'NOVA3D-ICC-MARKER-0d96a2';
/** Text in a comment (a JPEG COM segment, a PNG tEXt chunk). */
export const commentMarker = 'NOVA3D-COMMENT-MARKER-c40b7e';
/** Text in the Photoshop/IPTC segment. */
export const photoshopMarker = 'NOVA3D-IPTC-MARKER-a1f58d';
/** Text in the EXIF thumbnail's own comment. */
export const thumbnailMarker = 'NOVA3D-THUMBNAIL-MARKER-93e7c1';
/** Text in the bytes put after the end of the picture. */
export const trailerMarker = 'NOVA3D-TRAILER-MARKER-62d0fa';
/** Text in a chunk no decoder knows (an unknown WebP chunk, a private PNG chunk). */
export const privateMarker = 'NOVA3D-PRIVATE-MARKER-1b3c88';

/** Every marker above. A stripped picture contains none of them. */
export const metadataMarkers: readonly string[] = [gpsMarker, makerNoteMarker, xmpMarker, iccMarker, commentMarker, photoshopMarker, thumbnailMarker, trailerMarker, privateMarker];

/** The markers that are found in `bytes`. */
export const markersIn = (bytes: Uint8Array): string[] => metadataMarkers.filter((marker) => Buffer.from(bytes).includes(marker, 0, 'latin1'));

/** Whether `bytes` contain `text` (as Latin-1 text). */
export const contains = (bytes: Uint8Array, text: string): boolean => Buffer.from(bytes).includes(text, 0, 'latin1');

/** The orientation of the ready-made picture `gpsJpeg()`: rotated 90 degrees clockwise when shown. */
export const gpsJpegOrientation = 6;

// Bytes ---------------------------------------------------------------------------------------------------------------------------

export type ByteOrder = 'II' | 'MM';

const concat = (...parts: Uint8Array[]): Buffer => Buffer.concat(parts);
const text = (value: string): Buffer => Buffer.from(value, 'latin1');

function u16(order: ByteOrder, value: number): Buffer {
  const out = Buffer.alloc(2);
  if (order === 'II') out.writeUInt16LE(value);
  else out.writeUInt16BE(value);
  return out;
}

function u32(order: ByteOrder, value: number): Buffer {
  const out = Buffer.alloc(4);
  if (order === 'II') out.writeUInt32LE(value);
  else out.writeUInt32BE(value);
  return out;
}

// TIFF and EXIF ---------------------------------------------------------------------------------------------------------------

/** One entry of a TIFF directory: its tag, type (1 BYTE, 2 ASCII, 3 SHORT, 4 LONG, 5 RATIONAL, 7 UNDEFINED), count and value bytes (already in the stream's byte order). */
export type TiffEntry = {tag: number; type: number; count: number; data: Buffer; pointer?: 'exif' | 'gps' | 'thumbnail'};

export const shortEntry = (order: ByteOrder, tag: number, ...values: number[]): TiffEntry => ({tag, type: 3, count: values.length, data: concat(...values.map((value) => u16(order, value)))});
export const longEntry = (order: ByteOrder, tag: number, value: number): TiffEntry => ({tag, type: 4, count: 1, data: u32(order, value)});
export const asciiEntry = (tag: number, value: string): TiffEntry => ({tag, type: 2, count: value.length + 1, data: text(`${value}\0`)});
export const undefinedEntry = (tag: number, data: Uint8Array): TiffEntry => ({tag, type: 7, count: data.length, data: Buffer.from(data)});
export const byteEntry = (tag: number, ...values: number[]): TiffEntry => ({tag, type: 1, count: values.length, data: Buffer.from(values)});
export const rationalEntry = (order: ByteOrder, tag: number, ...pairs: [number, number][]): TiffEntry => ({
  tag,
  type: 5,
  count: pairs.length,
  data: concat(...pairs.flatMap(([numerator, denominator]) => [u32(order, numerator), u32(order, denominator)])),
});

/**
 * A TIFF stream: the header, then IFD0 (with the pointers to the Exif and GPS directories added), the Exif directory, the GPS directory and IFD1 (the thumbnail's)
 * when given, each directory followed by its out-of-line values, then the thumbnail's bytes. Entries are written in tag order, as the format asks.
 */
export function tiffStream(order: ByteOrder, spec: {ifd0: TiffEntry[]; exif?: TiffEntry[]; gps?: TiffEntry[]; ifd1?: TiffEntry[]; thumbnail?: Uint8Array}): Buffer {
  const pointer = (tag: number, to: NonNullable<TiffEntry['pointer']>): TiffEntry => ({tag, type: 4, count: 1, data: u32(order, 0), pointer: to});
  const tables: {name: 'ifd0' | 'exif' | 'gps' | 'ifd1'; entries: TiffEntry[]}[] = [];
  const ifd0 = [...spec.ifd0];
  if (spec.exif) ifd0.push(pointer(0x8769, 'exif'));
  if (spec.gps) ifd0.push(pointer(0x8825, 'gps'));
  tables.push({name: 'ifd0', entries: ifd0});
  if (spec.exif) tables.push({name: 'exif', entries: [...spec.exif]});
  if (spec.gps) tables.push({name: 'gps', entries: [...spec.gps]});
  if (spec.ifd1) {
    const entries = [...spec.ifd1];
    if (spec.thumbnail) entries.push(pointer(0x0201, 'thumbnail'), longEntry(order, 0x0202, spec.thumbnail.length));
    tables.push({name: 'ifd1', entries});
  }
  const outOfLine = (entry: TiffEntry) => (entry.data.length > 4 ? entry.data.length + (entry.data.length & 1) : 0);
  const offsets: Partial<Record<'ifd0' | 'exif' | 'gps' | 'ifd1' | 'thumbnail', number>> = {};
  let at = 8;
  for (const table of tables) {
    offsets[table.name] = at;
    at += 2 + table.entries.length * 12 + 4 + table.entries.reduce((sum, entry) => sum + outOfLine(entry), 0);
  }
  offsets.thumbnail = at;

  const parts: Buffer[] = [text(order), u16(order, 42), u32(order, 8)];
  for (const table of tables) {
    const sorted = [...table.entries].sort((a, b) => a.tag - b.tag);
    let dataAt = (offsets[table.name] ?? 0) + 2 + sorted.length * 12 + 4;
    const head: Buffer[] = [u16(order, sorted.length)];
    const data: Buffer[] = [];
    for (const entry of sorted) {
      const bytes = entry.pointer ? u32(order, offsets[entry.pointer] ?? 0) : entry.data;
      let value: Buffer;
      if (bytes.length <= 4) {
        value = concat(bytes, Buffer.alloc(4 - bytes.length));
      } else {
        value = u32(order, dataAt);
        const padded = bytes.length & 1 ? concat(bytes, Buffer.alloc(1)) : bytes;
        data.push(padded);
        dataAt += padded.length;
      }
      head.push(u16(order, entry.tag), u16(order, entry.type), u32(order, entry.count), value);
    }
    head.push(u32(order, table.name === 'ifd0' ? (offsets.ifd1 ?? 0) : 0));
    parts.push(...head, ...data);
  }
  if (spec.thumbnail && spec.ifd1) parts.push(Buffer.from(spec.thumbnail));
  return concat(...parts);
}

export type ExifOptions = {
  order?: ByteOrder;
  /** The orientation tag's value: 1 to 8 is valid; anything else (0, 9, 65535) is written as given so a test can see it refused; null writes no orientation tag. */
  orientation?: number | null;
  /** A GPS directory with a latitude, a longitude, an altitude and `gpsMarker` (default true). */
  gps?: boolean;
  /** An IFD1 with a thumbnail JPEG (default true). */
  thumbnail?: boolean;
  /** A maker note holding `makerNoteMarker` (default true). */
  makerNote?: boolean;
};

/** The TIFF stream of an EXIF block, with the camera's make and model, the dates, the maker note, the GPS directory and a thumbnail, as the options say. */
export function exifTiff(options: ExifOptions = {}): Buffer {
  const order = options.order ?? 'II';
  const orientation = options.orientation === undefined ? 6 : options.orientation;
  const ifd0 = [asciiEntry(0x010f, 'NovaCam'), asciiEntry(0x0110, 'Fixture 9000'), asciiEntry(0x0131, 'nova3D fixtures'), asciiEntry(0x0132, '2026:10:19 12:00:00')];
  if (orientation !== null) ifd0.push(shortEntry(order, 0x0112, orientation));
  const exif = [undefinedEntry(0x9000, text('0231')), asciiEntry(0x9003, '2026:10:19 12:00:00')];
  if (options.makerNote !== false) exif.push(undefinedEntry(0x927c, text(`NovaCam\0${makerNoteMarker}\0`)));
  const gps =
    options.gps === false
      ? undefined
      : [
          byteEntry(0x0000, 2, 3, 0, 0),
          asciiEntry(0x0001, 'N'),
          rationalEntry(order, 0x0002, [40, 1], [26, 1], [4600, 100]),
          asciiEntry(0x0003, 'W'),
          rationalEntry(order, 0x0004, [79, 1], [58, 1], [5600, 100]),
          byteEntry(0x0005, 0),
          rationalEntry(order, 0x0006, [12345, 10]),
          undefinedEntry(0x001b, text(`ASCII\0\0\0${gpsMarker}`)),
        ];
  const thumbnail = options.thumbnail === false ? undefined : baselineJpeg({width: 8, height: 8, seed: 99, commentText: thumbnailMarker});
  return tiffStream(order, {
    ifd0,
    exif,
    gps,
    ifd1: thumbnail ? [shortEntry(order, 0x0103, 6)] : undefined,
    thumbnail,
  });
}

// JPEG ----------------------------------------------------------------------------------------------------------------------

const segment = (marker: number, payload: Uint8Array): Buffer => {
  const out = Buffer.alloc(4 + payload.length);
  out[0] = 0xff;
  out[1] = marker;
  out.writeUInt16BE(payload.length + 2, 2);
  out.set(payload, 4);
  return out;
};

/** An APP1 segment holding an EXIF TIFF stream: the 'Exif\0\0' header and the stream. */
export const exifSegment = (tiff: Uint8Array): Buffer => segment(0xe1, concat(text('Exif\0\0'), tiff));

const standardDcLengths = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];

/** The canonical Huffman codes of a table: for each symbol, its code and bit length (JPEG Annex C). */
function huffmanCodes(lengths: readonly number[], symbols: readonly number[]): Map<number, {code: number; bits: number}> {
  const codes = new Map<number, {code: number; bits: number}>();
  let code = 0;
  let index = 0;
  for (let bits = 1; bits <= 16; bits += 1) {
    for (let count = 0; count < lengths[bits - 1]; count += 1) {
      codes.set(symbols[index], {code, bits});
      index += 1;
      code += 1;
    }
    code <<= 1;
  }
  return codes;
}

/** A writer of bits, most significant first, that stuffs a zero after every 0xFF byte and pads the last byte with ones. */
function bitWriter() {
  const bytes: number[] = [];
  let accumulator = 0;
  let count = 0;
  const push = (byte: number) => {
    bytes.push(byte);
    if (byte === 0xff) bytes.push(0x00);
  };
  return {
    put(value: number, bits: number) {
      for (let bit = bits - 1; bit >= 0; bit -= 1) {
        accumulator = (accumulator << 1) | ((value >> bit) & 1);
        count += 1;
        if (count === 8) {
          push(accumulator);
          accumulator = 0;
          count = 0;
        }
      }
    },
    pad() {
      while (count !== 0) this.put(1, 1);
    },
    marker(code: number) {
      bytes.push(0xff, code);
    },
    bytes: () => Buffer.from(bytes),
  };
}

export type BaselineOptions = {
  /** Pixels; rounded up to a whole number of 8 x 8 blocks in the data (the header says the exact size). 16 by default. */
  width?: number;
  height?: number;
  /** A different seed is a different picture. */
  seed?: number;
  /** A restart interval, in blocks of the scan (DRI and the RSTn markers). None by default. Ignored for a progressive picture. */
  restartInterval?: number;
  /** A progressive picture: a DC scan and one AC scan for each component (SOF2, four scans). */
  progressive?: boolean;
  /** Bytes put before the DQT and DHT markers as 0xFF fill (a decoder skips them). */
  fillBytes?: boolean;
  /** A COM segment right after the start marker (of `baselineJpeg`). */
  commentText?: string;
};

/** The three parts of a JPEG that decode it, and where its scan data starts. A flat colour for each 8 x 8 block: one DC coefficient and an end of block. */
function jpegCore(options: BaselineOptions) {
  const width = options.width ?? 16;
  const height = options.height ?? 16;
  const seed = options.seed ?? 0;
  const blocksX = Math.ceil(width / 8);
  const blocksY = Math.ceil(height / 8);
  const dc = huffmanCodes(standardDcLengths, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  // The AC table has one symbol, 0x00 (the end of the block), whose code is the single bit 0.
  const value = (component: number, bx: number, by: number) =>
    component === 0 ? 32 + ((bx * 29 + by * 53 + seed * 17) % 192) : component === 1 ? 96 + ((bx * 7 + seed * 5) % 64) : 96 + ((by * 11 + seed * 3) % 64);

  const fill = options.fillBytes ? Buffer.from([0xff, 0xff]) : Buffer.alloc(0);
  const dqt = concat(fill, segment(0xdb, concat(Buffer.from([0x00]), Buffer.alloc(64, 8))));
  const sof = segment(options.progressive ? 0xc2 : 0xc0, Buffer.from([8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]));
  const dht = concat(
    fill,
    segment(
      0xc4,
      concat(Buffer.from([0x00, ...standardDcLengths, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), Buffer.from([0x10, 1, ...new Array<number>(15).fill(0), 0x00])),
    ),
  );
  const interval = options.progressive ? 0 : (options.restartInterval ?? 0);
  const dri = interval > 0 ? segment(0xdd, Buffer.from([interval >> 8, interval & 0xff])) : Buffer.alloc(0);

  const writeDc = (writer: ReturnType<typeof bitWriter>, difference: number) => {
    const size = difference === 0 ? 0 : Math.floor(Math.log2(Math.abs(difference))) + 1;
    const entry = dc.get(size)!;
    writer.put(entry.code, entry.bits);
    if (size > 0) writer.put(difference >= 0 ? difference : difference + (1 << size) - 1, size);
  };
  const header = (components: number[], ss: number, se: number) =>
    segment(0xda, Buffer.from([components.length, ...components.flatMap((id) => [id, 0x00]), ss, se, 0x00]));

  const scans: Buffer[] = [];
  if (!options.progressive) {
    const writer = bitWriter();
    const predictors = [0, 0, 0];
    let counted = 0;
    let restarts = 0;
    for (let by = 0; by < blocksY; by += 1) {
      for (let bx = 0; bx < blocksX; bx += 1) {
        if (interval > 0 && counted > 0 && counted % interval === 0) {
          writer.pad();
          writer.marker(0xd0 + (restarts % 8));
          restarts += 1;
          predictors.fill(0);
        }
        for (let component = 0; component < 3; component += 1) {
          const level = value(component, bx, by) - 128;
          writeDc(writer, level - predictors[component]);
          predictors[component] = level;
          writer.put(0, 1);
        }
        counted += 1;
      }
    }
    writer.pad();
    scans.push(concat(header([1, 2, 3], 0, 63), writer.bytes()));
  } else {
    const writer = bitWriter();
    const predictors = [0, 0, 0];
    for (let by = 0; by < blocksY; by += 1) {
      for (let bx = 0; bx < blocksX; bx += 1) {
        for (let component = 0; component < 3; component += 1) {
          const level = value(component, bx, by) - 128;
          writeDc(writer, level - predictors[component]);
          predictors[component] = level;
        }
      }
    }
    writer.pad();
    scans.push(concat(header([1, 2, 3], 0, 0), writer.bytes()));
    for (let component = 1; component <= 3; component += 1) {
      const acWriter = bitWriter();
      for (let block = 0; block < blocksX * blocksY; block += 1) acWriter.put(0, 1);
      acWriter.pad();
      scans.push(concat(header([component], 1, 63), acWriter.bytes()));
    }
  }
  return {dqt, dri, sof, dht, scans: concat(...scans)};
}

/** A JPEG with no metadata at all: SOI, (a comment,) the tables, the frame, the scan(s) and EOI. A real picture a browser decodes. */
export function baselineJpeg(options: BaselineOptions = {}): Buffer {
  const core = jpegCore(options);
  return concat(Buffer.from([0xff, 0xd8]), options.commentText ? segment(0xfe, text(options.commentText)) : Buffer.alloc(0), core.dqt, core.dri, core.sof, core.dht, core.scans, Buffer.from([0xff, 0xd9]));
}

export type JpegOptions = BaselineOptions &
  ExifOptions & {
    /** An EXIF APP1 segment at all (default true). `false` leaves the orientation and the GPS out with it. */
    exif?: boolean;
    jfif?: boolean;
    xmp?: boolean;
    icc?: boolean;
    /** A multi-picture (MPF) APP2 segment. */
    mpf?: boolean;
    /** A FlashPix APP2 segment. */
    flashpix?: boolean;
    /** A Photoshop/IPTC APP13 segment. */
    photoshop?: boolean;
    /** The Adobe APP14 segment (colour transform 1: YCbCr), which must be KEPT. */
    adobe?: boolean;
    /** A COM segment holding `commentMarker` (default true). */
    comment?: boolean;
    /** A second EXIF-like APP1 that is not EXIF, and a non-Adobe APP14. */
    otherApps?: boolean;
    /** Bytes after the end marker (default true): a trailer holding `trailerMarker`. */
    trailer?: boolean;
  };

/**
 * A real JPEG with every kind of metadata a camera or an editor writes, each of them on by default and switched off by `false`: a JFIF header, an EXIF block (the
 * camera, the dates, `orientation` 6, a maker note, a GPS directory with a location and `gpsMarker`, and a thumbnail), an XMP packet, an ICC profile, a multi-picture
 * segment, a FlashPix segment, a Photoshop/IPTC segment, a comment and a trailer after the end marker. Adobe's APP14 is off by default: it is part of the picture.
 */
export function jpegWithMetadata(options: JpegOptions = {}): Buffer {
  const on = (flag: boolean | undefined) => flag !== false;
  const core = jpegCore(options);
  const parts: Uint8Array[] = [Buffer.from([0xff, 0xd8])];
  if (on(options.jfif)) parts.push(segment(0xe0, concat(text('JFIF\0'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]))));
  if (on(options.exif)) parts.push(exifSegment(exifTiff(options)));
  if (on(options.xmp)) {
    parts.push(
      segment(
        0xe1,
        text(
          `http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="40,26.7667N" dc:title="${xmpMarker}"/></rdf:RDF></x:xmpmeta>`,
        ),
      ),
    );
  }
  if (options.otherApps) parts.push(segment(0xe1, text('http://example.invalid/not-exif\0not metadata that matters')), segment(0xee, text('Other14\0data')));
  if (on(options.icc)) parts.push(segment(0xe2, concat(text('ICC_PROFILE\0'), Buffer.from([1, 1]), Buffer.alloc(128, 0x20), text(iccMarker), Buffer.alloc(32, 0x41))));
  if (on(options.mpf)) parts.push(segment(0xe2, concat(text('MPF\0'), Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]))));
  if (on(options.flashpix)) parts.push(segment(0xe2, concat(text('FPXR\0'), Buffer.alloc(24, 0x07))));
  if (on(options.photoshop)) parts.push(segment(0xed, concat(text('Photoshop 3.0\0'), text('8BIM'), Buffer.from([0x04, 0x04, 0, 0, 0, 0, 0, 40]), text(photoshopMarker), Buffer.alloc(16, 0x30))));
  if (options.adobe) parts.push(segment(0xee, concat(text('Adobe'), Buffer.from([0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x01]))));
  if (on(options.comment)) parts.push(segment(0xfe, text(commentMarker)));
  parts.push(core.dqt, core.dri, core.sof, core.dht, core.scans, Buffer.from([0xff, 0xd9]));
  if (on(options.trailer)) parts.push(text(trailerMarker), Buffer.alloc(32, 0x55));
  return concat(...parts);
}

/**
 * The ready-made picture of the browser and gateway tests: a small real JPEG (64 x 48 by default, well under 200 KB at any size a test asks for) that carries a GPS
 * location, EXIF orientation 6 (`gpsJpegOrientation`) and every other kind of metadata, and that a browser decodes. A different `seed` is a different file.
 */
export function gpsJpeg(options: {width?: number; height?: number; seed?: number} = {}): Buffer {
  return jpegWithMetadata({width: options.width ?? 64, height: options.height ?? 48, seed: options.seed ?? 1, orientation: gpsJpegOrientation});
}

export type JpegSegment = {
  /** `SOI`, `APP0` to `APP15`, `COM`, `DQT`, `DHT`, `DAC`, `DRI`, `DNL`, `SOF0` to `SOF15`, `SOS` (header and entropy-coded data), `TEM`, `RST0` to `RST7`, `EOI`. */
  name: string;
  marker: number;
  offset: number;
  /** The segment's bytes from its marker; for SOS, the header AND the entropy-coded data that follows it. */
  bytes: Buffer;
};

const jpegName = (marker: number): string => {
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return `SOF${marker - 0xc0}`;
  if (marker >= 0xd0 && marker <= 0xd7) return `RST${marker - 0xd0}`;
  const names: Record<number, string> = {0xd8: 'SOI', 0xd9: 'EOI', 0xfe: 'COM', 0xdb: 'DQT', 0xc4: 'DHT', 0xcc: 'DAC', 0xdd: 'DRI', 0xdc: 'DNL', 0xda: 'SOS', 0x01: 'TEM'};
  return names[marker] ?? `M${marker.toString(16)}`;
};

/** The segments of a JPEG up to and including EOI (what follows it is not listed), in order. An independent reader: it throws on anything it does not follow. */
export function segmentsOfJpeg(bytes: Uint8Array): JpegSegment[] {
  const buffer = Buffer.from(bytes);
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error('not a JPEG');
  const out: JpegSegment[] = [{name: 'SOI', marker: 0xd8, offset: 0, bytes: buffer.subarray(0, 2)}];
  let position = 2;
  while (position < buffer.length) {
    if (buffer[position] !== 0xff) throw new Error(`no marker at ${position}`);
    let code = position + 1;
    while (buffer[code] === 0xff) code += 1;
    const marker = buffer[code];
    const start = code - 1;
    if (marker === 0xd9) {
      out.push({name: 'EOI', marker, offset: start, bytes: buffer.subarray(start, code + 1)});
      return out;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push({name: jpegName(marker), marker, offset: start, bytes: buffer.subarray(start, code + 1)});
      position = code + 1;
      continue;
    }
    let end = code + 1 + buffer.readUInt16BE(code + 1);
    if (end > buffer.length) throw new Error(`segment at ${start} runs past the end`);
    if (marker === 0xda) {
      // The entropy-coded data: up to the next marker that is not a stuffed zero or a restart.
      for (;;) {
        const next = buffer.indexOf(0xff, end);
        if (next < 0) throw new Error('scan without an end');
        let follower = next + 1;
        while (buffer[follower] === 0xff) follower += 1;
        if (buffer[follower] === 0x00 || (buffer[follower] >= 0xd0 && buffer[follower] <= 0xd7)) {
          end = follower + 1;
          continue;
        }
        end = follower - 1;
        break;
      }
    }
    out.push({name: jpegName(marker), marker, offset: start, bytes: buffer.subarray(start, end)});
    position = end;
  }
  throw new Error('no end marker');
}

/** The names of the segments of a JPEG, in order, restart markers inside a scan not counted: `['SOI', 'APP1', 'DQT', ..., 'EOI']`. */
export const jpegNames = (bytes: Uint8Array): string[] => segmentsOfJpeg(bytes).map((entry) => entry.name);

// PNG -----------------------------------------------------------------------------------------------------------------------

export const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG chunk with its length and a real CRC. */
export function pngChunk(type: string, data: Uint8Array = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export type PngOptions = {
  width?: number;
  height?: number;
  /** A different seed is a different picture. */
  seed?: number;
  order?: ByteOrder;
  /** The orientation in the eXIf chunk (1 to 8 valid; others written as given; null writes none). 6 by default. */
  orientation?: number | null;
  /** The eXIf chunk (with the GPS directory and a thumbnail) at all; default true. */
  exif?: boolean;
  /** Put the eXIf chunk after the IDAT chunks instead of before them. */
  exifAfterImage?: boolean;
  /** An 'Exif\0\0' header in front of the TIFF stream in the eXIf chunk (not the format, but written by some tools). */
  exifHeader?: boolean;
  gps?: boolean;
  /** tEXt (with `commentMarker`), zTXt, iTXt and tIME (default true). */
  text?: boolean;
  /** pHYs (default true). */
  physical?: boolean;
  /** iCCP with a profile holding `iccMarker` (default true). */
  icc?: boolean;
  /** gAMA, cHRM, sRGB, sBIT and bKGD, which describe how to show the picture and are KEPT (default true). */
  appearance?: boolean;
  /** tRNS (kept). */
  transparency?: boolean;
  /** Two IDAT chunks (default true). */
  splitImage?: boolean;
  /** Bytes after IEND (default true): a trailer holding `trailerMarker`. */
  trailer?: boolean;
  /** sPLT, hIST and a private chunk holding `privateMarker` (not valid in every picture; off by default). */
  exotic?: boolean;
  /** An animated PNG: acTL and fcTL before the image, an fcTL and an fdAT after it. */
  animated?: boolean;
};

/**
 * A real truecolour PNG (a browser decodes it) with the chunks a camera, an editor or a screenshot tool adds, each on by default and switched off by `false`: tEXt,
 * zTXt, iTXt, tIME, pHYs, iCCP and an eXIf chunk with orientation 6, a GPS location and a thumbnail, and the chunks that must stay (gAMA, cHRM, sRGB, sBIT, bKGD).
 */
export function pngWithMetadata(options: PngOptions = {}): Buffer {
  const on = (flag: boolean | undefined) => flag !== false;
  const width = options.width ?? 24;
  const height = options.height ?? 24;
  const seed = options.seed ?? 0;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * (1 + width * 3) + 1 + x * 3;
      raw[at] = (x * 9 + seed * 37) % 256;
      raw[at + 1] = (y * 7 + seed * 11) % 256;
      raw[at + 2] = ((x + y) * 5 + seed * 3) % 256;
    }
  }
  const compressed = deflateSync(raw);
  const half = Math.max(1, compressed.length >> 1);
  const image = on(options.splitImage) ? [compressed.subarray(0, half), compressed.subarray(half)] : [compressed];

  const order = options.order ?? 'II';
  const tiff = exifTiff({order, orientation: options.orientation, gps: options.gps});
  const exifChunk = pngChunk('eXIf', options.exifHeader ? concat(text('Exif\0\0'), tiff) : tiff);

  const before: Buffer[] = [pngChunk('IHDR', header)];
  if (on(options.appearance)) {
    const gamma = Buffer.alloc(4);
    gamma.writeUInt32BE(45455);
    const chromaticities = Buffer.alloc(32);
    [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000].forEach((value, index) => chromaticities.writeUInt32BE(value, index * 4));
    before.push(pngChunk('gAMA', gamma), pngChunk('cHRM', chromaticities), pngChunk('sRGB', Buffer.from([0])), pngChunk('sBIT', Buffer.from([8, 8, 8])));
  }
  if (on(options.icc)) before.push(pngChunk('iCCP', concat(text('fixture\0'), Buffer.from([0]), deflateSync(concat(Buffer.alloc(128, 0x20), text(iccMarker), Buffer.alloc(32, 0x41))))));
  if (on(options.appearance)) before.push(pngChunk('bKGD', Buffer.from([0, 255, 0, 255, 0, 255])));
  if (options.transparency) before.push(pngChunk('tRNS', Buffer.from([0, 1, 0, 2, 0, 3])));
  if (on(options.physical)) before.push(pngChunk('pHYs', Buffer.from([0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])));
  if (on(options.text)) {
    before.push(
      pngChunk('tIME', Buffer.from([0x07, 0xea, 10, 19, 12, 0, 0])),
      pngChunk('tEXt', text(`Comment\0${commentMarker}`)),
      pngChunk('zTXt', concat(text('Description\0'), Buffer.from([0]), deflateSync(text(`${commentMarker} compressed`)))),
      pngChunk('iTXt', concat(text('XML:com.adobe.xmp\0'), Buffer.from([0, 0]), text(`\0\0<x:xmpmeta>${xmpMarker}</x:xmpmeta>`))),
    );
  }
  if (options.exotic) {
    before.push(
      pngChunk('sPLT', concat(text('palette\0'), Buffer.from([8, 10, 20, 30, 255, 0, 1]))),
      pngChunk('hIST', Buffer.from([0, 1, 0, 2])),
      pngChunk('prVt', text(privateMarker)),
    );
  }
  if (options.animated) {
    const control = (sequence: number) => {
      const out = Buffer.alloc(26);
      out.writeUInt32BE(sequence, 0);
      out.writeUInt32BE(width, 4);
      out.writeUInt32BE(height, 8);
      out.writeUInt16BE(1, 20);
      out.writeUInt16BE(10, 22);
      return pngChunk('fcTL', out);
    };
    const times = Buffer.alloc(8);
    times.writeUInt32BE(2, 0);
    before.push(pngChunk('acTL', times), control(0));
  }
  if (on(options.exif) && !options.exifAfterImage) before.push(exifChunk);

  const after: Buffer[] = [];
  if (options.animated) {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(1, 0);
    control.writeUInt32BE(width, 4);
    control.writeUInt32BE(height, 8);
    control.writeUInt16BE(1, 20);
    control.writeUInt16BE(10, 22);
    const sequence = Buffer.alloc(4);
    sequence.writeUInt32BE(2, 0);
    after.push(pngChunk('fcTL', control), pngChunk('fdAT', concat(sequence, compressed)));
  }
  if (on(options.exif) && options.exifAfterImage) after.push(exifChunk);
  if (on(options.text)) after.push(pngChunk('tEXt', text(`Software\0${commentMarker}`)));
  return concat(pngSignature, ...before, ...image.map((data) => pngChunk('IDAT', data)), ...after, pngChunk('IEND'), on(options.trailer) ? concat(text(trailerMarker), Buffer.alloc(16, 0x55)) : Buffer.alloc(0));
}

export type PngChunkInfo = {type: string; offset: number; /** The chunk's data. */ data: Buffer; /** The whole chunk: length, type, data and CRC. */ bytes: Buffer};

/** The chunks of a PNG up to and including IEND, in order. An independent reader: it throws on anything it does not follow. */
export function chunksOfPng(bytes: Uint8Array): PngChunkInfo[] {
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).equals(pngSignature)) throw new Error('not a PNG');
  const out: PngChunkInfo[] = [];
  let position = 8;
  for (;;) {
    if (position + 12 > buffer.length) throw new Error('truncated PNG');
    const length = buffer.readUInt32BE(position);
    if (position + 12 + length > buffer.length) throw new Error('chunk runs past the end');
    const type = buffer.toString('latin1', position + 4, position + 8);
    out.push({type, offset: position, data: buffer.subarray(position + 8, position + 8 + length), bytes: buffer.subarray(position, position + 12 + length)});
    position += 12 + length;
    if (type === 'IEND') return out;
  }
}

/** The types of the chunks of a PNG, in order: `['IHDR', 'gAMA', ..., 'IDAT', 'IEND']`. */
export const pngTypes = (bytes: Uint8Array): string[] => chunksOfPng(bytes).map((chunk) => chunk.type);

// WebP ----------------------------------------------------------------------------------------------------------------------

/** The 13 bytes of a lossless (VP8L) 1 x 1 image. */
export const vp8lImage = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07]);
/** The 22 bytes of a lossy (VP8) 1 x 1 key frame. */
export const vp8Image = Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x0e, 0xc0, 0xfe, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0x00, 0x00, 0x00]);

/** A WebP chunk: its type, little-endian size, data and the padding byte of an odd size. */
export function webpChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(8 + data.length + (data.length & 1));
  out.write(type, 0, 'latin1');
  out.writeUInt32LE(data.length, 4);
  out.set(data, 8);
  return out;
}

/** A RIFF/WEBP file around the chunks, with the right size. */
export function riffWebp(...chunks: Uint8Array[]): Buffer {
  const out = concat(text('RIFF\0\0\0\0WEBP'), ...chunks);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}

/** A simple WebP: one image chunk and nothing else, so it holds no metadata. */
export const simpleWebp = (kind: 'lossless' | 'lossy' = 'lossless'): Buffer => riffWebp(kind === 'lossless' ? webpChunk('VP8L', vp8lImage) : webpChunk('VP8 ', vp8Image));

export type WebpOptions = {
  order?: ByteOrder;
  /** The orientation in the EXIF chunk (1 to 8 valid; others written as given; null writes none). 6 by default. */
  orientation?: number | null;
  /** The EXIF chunk at all, and whether its stream starts with 'Exif\0\0' (some writers do). */
  exif?: boolean;
  exifHeader?: boolean;
  gps?: boolean;
  /** ICCP, XMP and an unknown chunk holding `privateMarker`, and the VP8X flags that announce them (default true). */
  icc?: boolean;
  xmp?: boolean;
  unknown?: boolean;
  /** A lossy VP8 image (with an ALPH chunk when `alpha`) instead of the lossless VP8L one. */
  lossy?: boolean;
  alpha?: boolean;
  /** An animation: ANIM and two ANMF frames instead of a still image. */
  animated?: boolean;
  /** Bytes after the end of the RIFF extent (default true). */
  trailer?: boolean;
};

/**
 * A WebP with a VP8X header and every kind of metadata, each on by default and switched off by `false`: ICCP, EXIF (orientation 6, a GPS location and a thumbnail), XMP
 * and an unknown chunk, with the VP8X flags that announce them, around a 1 x 1 image. The image chunks are the ones that must stay.
 */
export function webpWithMetadata(options: WebpOptions = {}): Buffer {
  const on = (flag: boolean | undefined) => flag !== false;
  const exifOn = on(options.exif);
  const iccOn = on(options.icc);
  const xmpOn = on(options.xmp);
  let flags = 0;
  if (iccOn) flags |= 0x20;
  if (options.alpha) flags |= 0x10;
  if (exifOn) flags |= 0x08;
  if (xmpOn) flags |= 0x04;
  if (options.animated) flags |= 0x02;
  const canvas = Buffer.alloc(10);
  canvas[0] = flags;
  const tiff = exifTiff({order: options.order, orientation: options.orientation, gps: options.gps});

  const chunks: Buffer[] = [webpChunk('VP8X', canvas)];
  if (iccOn) chunks.push(webpChunk('ICCP', concat(Buffer.alloc(128, 0x20), text(iccMarker), Buffer.alloc(32, 0x41))));
  if (options.animated) {
    const frame = (x: number) => {
      const header = Buffer.alloc(16);
      header.writeUIntLE(x, 0, 3);
      header.writeUIntLE(100, 12, 3);
      return webpChunk('ANMF', concat(header, webpChunk('VP8L', vp8lImage)));
    };
    chunks.push(webpChunk('ANIM', Buffer.from([0xff, 0xff, 0xff, 0xff, 0, 0])), frame(0), frame(0));
  } else {
    if (options.alpha) chunks.push(webpChunk('ALPH', Buffer.from([0x00, 0xff])));
    chunks.push(options.lossy ? webpChunk('VP8 ', vp8Image) : webpChunk('VP8L', vp8lImage));
  }
  if (exifOn) chunks.push(webpChunk('EXIF', options.exifHeader ? concat(text('Exif\0\0'), tiff) : tiff));
  if (xmpOn) chunks.push(webpChunk('XMP ', text(`<x:xmpmeta>${xmpMarker}</x:xmpmeta>`)));
  if (on(options.unknown)) chunks.push(webpChunk('XYZW', text(privateMarker)));
  const file = riffWebp(...chunks);
  return on(options.trailer) ? concat(file, text(trailerMarker)) : file;
}

export type WebpChunkInfo = {type: string; offset: number; /** The chunk's data. */ data: Buffer; /** The whole chunk: type, size, data and the padding byte. */ bytes: Buffer};

/** The chunks of a WebP inside its RIFF extent, in order. An independent reader: it throws on anything it does not follow. */
export function chunksOfWebp(bytes: Uint8Array): WebpChunkInfo[] {
  const buffer = Buffer.from(bytes);
  if (buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP');
  const extent = buffer.readUInt32LE(4) + 8;
  if (extent > buffer.length) throw new Error('RIFF size past the end');
  const out: WebpChunkInfo[] = [];
  let position = 12;
  while (position < extent) {
    const size = buffer.readUInt32LE(position + 4);
    const end = position + 8 + size + (size & 1);
    if (end > extent) throw new Error('chunk runs past the end');
    out.push({type: buffer.toString('latin1', position, position + 4), offset: position, data: buffer.subarray(position + 8, position + 8 + size), bytes: buffer.subarray(position, end)});
    position = end;
  }
  return out;
}

/** The types of the chunks of a WebP, in order: `['VP8X', 'ICCP', 'VP8L', 'EXIF', 'XMP ']`. */
export const webpTypes = (bytes: Uint8Array): string[] => chunksOfWebp(bytes).map((chunk) => chunk.type);
