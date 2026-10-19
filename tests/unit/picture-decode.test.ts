import {describe, expect, it, vi} from 'vitest';
import {canDecode, decodePicture, decodeTimeoutMs, thumbnailEdge, thumbnailQuality, type DecodeDeps, type DrawingCanvas, type DrawingContext} from '@/lib/picture-decode';
import {copyEdge, copySize} from '@/lib/picture-quality';
import {jpeg, png, webpExtended} from '../support/headers';
import {checkerboard, flat, greyNoise} from '../support/pixels';

// Decoding a picture to measure it (Story 2.3, lib/picture-decode.ts) with a fake browser: the orientation is asked for, the copy is drawn at high smoothing quality
// with its long edge at most 512 px and never enlarged, the pure analyzer measures the copy against the NATURAL size, the thumbnail is a small JPEG on white, the
// bitmap is closed, and anything that goes wrong is `{ok: false, problem}` and never a throw: `undecodable` (the browser could not open it), `too_large_pixels` (its
// header states more than 100 megapixels: no decoder is asked) or `busy` (the decode did not finish in 30 seconds).
type Source = {width: number; height: number; data: Uint8ClampedArray};

/** A fake browser that "decodes" a blob to a bitmap of a given size and paints the given pixels (at the size asked for) when the bitmap is drawn. */
function browser(options: {natural?: {width: number; height: number}; paint?: (width: number, height: number) => Source; contextMissing?: boolean; thumbnail?: Blob | null | 'throws'} = {}) {
  const natural = options.natural ?? {width: 1200, height: 900};
  const closed = vi.fn();
  const calls = {bitmapOptions: [] as unknown[], canvases: [] as FakeCanvas[]};
  let drawn: Source | null = null;

  class FakeContext implements DrawingContext {
    imageSmoothingEnabled = false;
    imageSmoothingQuality: 'low' | 'medium' | 'high' = 'low';
    fillStyle: string | CanvasGradient | CanvasPattern = '';
    fills: [number, number, number, number][] = [];
    draws: unknown[][] = [];
    fillRect(x: number, y: number, width: number, height: number) {
      this.fills.push([x, y, width, height]);
    }
    drawImage(image: never, dx: number, dy: number, dw: number, dh: number) {
      this.draws.push([image, dx, dy, dw, dh]);
      if (image === (bitmap as never)) drawn = (options.paint ?? ((w, h) => flat(w, h, 120)))(dw, dh) as Source;
    }
    getImageData(_x: number, _y: number, width: number, height: number) {
      if (!drawn || drawn.width !== width || drawn.height !== height) throw new Error('nothing was drawn at this size');
      return {width, height, data: drawn.data};
    }
  }
  class FakeCanvas implements DrawingCanvas {
    width = 300;
    height = 150;
    context: FakeContext | null = null;
    contextOptions: unknown;
    getContext(_type: '2d', contextOptions?: {willReadFrequently?: boolean}) {
      if (options.contextMissing) return null;
      this.contextOptions = contextOptions;
      this.context ??= new FakeContext();
      return this.context;
    }
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number) {
      this.encoded = {type, quality};
      if (options.thumbnail === 'throws') throw new Error('no encoder');
      callback(options.thumbnail === undefined ? new Blob([new Uint8Array(40)], {type: 'image/jpeg'}) : options.thumbnail);
    }
    encoded?: {type?: string; quality?: number};
  }
  const bitmap = {width: natural.width, height: natural.height, close: closed};
  const deps: DecodeDeps = {
    createImageBitmap: async (_blob, bitmapOptions) => {
      calls.bitmapOptions.push(bitmapOptions);
      return bitmap;
    },
    createCanvas: () => {
      const canvas = new FakeCanvas();
      calls.canvases.push(canvas);
      return canvas;
    },
  };
  return {deps, closed, calls, bitmap};
}

const blob = new Blob([new Uint8Array(8)], {type: 'image/png'});

describe('decoding a picture', () => {
  it('asks the browser to apply the picture\'s orientation, and measures the copy against the natural size', async () => {
    const world = browser({natural: {width: 1200, height: 900}, paint: (w, h) => greyNoise(w, h, 4) as Source});
    const decoded = await decodePicture(blob, world.deps);
    expect(world.calls.bitmapOptions).toEqual([{imageOrientation: 'from-image'}]);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.naturalWidth).toBe(1200);
    expect(decoded.naturalHeight).toBe(900);
    expect(decoded.measurements.shortEdgePx).toBe(900);
    expect(decoded.measurements.blurVariance).toBeGreaterThan(100);
    expect(decoded.measurements.clippedFraction).toBe(0);
  });

  it('asks again without options when the browser does not know the orientation option, and the default is that orientation', async () => {
    const world = browser({natural: {width: 800, height: 600}});
    const calls: unknown[] = [];
    const strict = world.deps.createImageBitmap!;
    world.deps.createImageBitmap = async (source, options) => {
      calls.push(options);
      if (options) throw new TypeError("The provided value 'from-image' is not a valid enum value of type ImageOrientation.");
      return strict(source, options);
    };
    const decoded = await decodePicture(blob, world.deps);
    expect(decoded.ok).toBe(true);
    expect(calls).toEqual([{imageOrientation: 'from-image'}, undefined]);
  });

  it('draws the copy with its long edge at 512 px at most, smoothly, in a canvas that is read often, from the whole bitmap', async () => {
    const world = browser({natural: {width: 4032, height: 3024}});
    await decodePicture(blob, world.deps);
    const [copy] = world.calls.canvases;
    expect({width: copy.width, height: copy.height}).toEqual(copySize(4032, 3024));
    expect(copy.width).toBe(copyEdge);
    expect(copy.height).toBe(384);
    expect(copy.contextOptions).toEqual({willReadFrequently: true});
    expect(copy.context?.imageSmoothingEnabled).toBe(true);
    expect(copy.context?.imageSmoothingQuality).toBe('high');
    expect(copy.context?.draws).toEqual([[world.bitmap, 0, 0, 512, 384]]);
  });

  it('uses the orientation the bitmap reports: a portrait picture\'s short edge is its width', async () => {
    const world = browser({natural: {width: 900, height: 1600}});
    const decoded = await decodePicture(blob, world.deps);
    expect(decoded.ok && decoded.measurements.shortEdgePx).toBe(900);
    expect({width: world.calls.canvases[0].width, height: world.calls.canvases[0].height}).toEqual({width: 288, height: 512});
  });

  it('never enlarges a picture that is already small', async () => {
    const world = browser({natural: {width: 300, height: 200}});
    const decoded = await decodePicture(blob, world.deps);
    expect({width: world.calls.canvases[0].width, height: world.calls.canvases[0].height}).toEqual({width: 300, height: 200});
    expect(decoded.ok && decoded.measurements.shortEdgePx).toBe(200);
  });

  it('measures a checkerboard of the copy\'s size as the sharpest and fully clipped picture', async () => {
    const world = browser({natural: {width: 512, height: 512}, paint: (w, h) => checkerboard(w, h) as Source});
    const decoded = await decodePicture(blob, world.deps);
    expect(decoded).toMatchObject({ok: true, measurements: {shortEdgePx: 512, blurVariance: 1040400, clippedFraction: 1}});
  });

  it('makes a small JPEG thumbnail of the copy on a white ground, at most 240 px, quality 0.8', async () => {
    const world = browser({natural: {width: 4032, height: 3024}});
    const decoded = await decodePicture(blob, world.deps);
    expect(decoded.ok && decoded.thumbnail).toBeInstanceOf(Blob);
    expect(world.calls.canvases).toHaveLength(2);
    const [copy, thumbnail] = world.calls.canvases;
    expect({width: thumbnail.width, height: thumbnail.height}).toEqual({width: 240, height: 180});
    expect(thumbnail.context?.fillStyle).toBe('#ffffff');
    expect(thumbnail.context?.fills).toEqual([[0, 0, 240, 180]]);
    expect(thumbnail.context?.draws).toEqual([[copy, 0, 0, 240, 180]]);
    expect(thumbnail.encoded).toEqual({type: 'image/jpeg', quality: thumbnailQuality});
    expect(thumbnailEdge).toBe(240);
    expect(thumbnailQuality).toBe(0.8);
  });

  it('does not enlarge the thumbnail of a small copy', async () => {
    const world = browser({natural: {width: 100, height: 50}});
    await decodePicture(blob, world.deps);
    expect({width: world.calls.canvases[1].width, height: world.calls.canvases[1].height}).toEqual({width: 100, height: 50});
  });

  it('keeps the measurements when the browser cannot make a thumbnail: the thumbnail is null', async () => {
    for (const thumbnail of [null, new Blob([]), 'throws'] as const) {
      const decoded = await decodePicture(blob, browser({thumbnail}).deps);
      expect(decoded.ok, String(thumbnail)).toBe(true);
      expect(decoded.ok && decoded.thumbnail, String(thumbnail)).toBeNull();
    }
  });

  it('closes the bitmap as soon as the copy is read, and also when something fails', async () => {
    const world = browser();
    await decodePicture(blob, world.deps);
    expect(world.closed).toHaveBeenCalledTimes(1);
    const failing = browser({paint: () => ({width: 1, height: 1, data: new Uint8ClampedArray(4)})});
    expect(await decodePicture(blob, failing.deps)).toEqual({ok: false, problem: 'undecodable'});
    expect(failing.closed).toHaveBeenCalled();
  });
});

describe('a picture that cannot be decoded', () => {
  it('is undecodable when the browser refuses it, and never a throw', async () => {
    const deps: DecodeDeps = {createImageBitmap: async () => { throw new DOMException('The source image cannot be decoded.', 'InvalidStateError'); }, createCanvas: () => { throw new Error('unused'); }};
    expect(await decodePicture(blob, deps)).toEqual({ok: false, problem: 'undecodable'});
  });

  it('is undecodable when there is no createImageBitmap, no canvas context, or no way to read the pixels', async () => {
    expect(await decodePicture(blob, {createImageBitmap: undefined})).toEqual({ok: false, problem: 'undecodable'});
    expect(await decodePicture(blob, browser({contextMissing: true}).deps)).toEqual({ok: false, problem: 'undecodable'});
    const noPixels = browser();
    const makeCanvas = noPixels.deps.createCanvas!;
    noPixels.deps.createCanvas = () => {
      const canvas = makeCanvas();
      canvas.getContext = () => ({
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillStyle: '',
        fillRect() {},
        drawImage() {},
        getImageData() {
          throw new DOMException('The canvas has been tainted.', 'SecurityError');
        },
      });
      return canvas;
    };
    expect(await decodePicture(blob, noPixels.deps)).toEqual({ok: false, problem: 'undecodable'});
  });

  it('is {ok: false} for a bitmap with no size when the file\'s header states none either', async () => {
    expect(await decodePicture(blob, browser({natural: {width: 0, height: 0}}).deps)).toEqual({ok: false, problem: 'undecodable'});
  });

  it('says whether the browser can decode at all, without decoding anything', () => {
    expect(canDecode({createImageBitmap: async () => ({width: 1, height: 1})})).toBe(true);
    expect(canDecode({createImageBitmap: undefined})).toBe(false);
  });

  it('uses the browser\'s own createImageBitmap when it is not given one', async () => {
    const real = vi.fn(async () => ({width: 640, height: 480, close: () => undefined}));
    vi.stubGlobal('createImageBitmap', real);
    try {
      expect(canDecode()).toBe(true);
      const canvas = browser({natural: {width: 640, height: 480}}).deps.createCanvas;
      const decoded = await decodePicture(blob, {createCanvas: canvas});
      // The fake canvas paints only what its own bitmap draws, so the real fake bitmap leaves nothing to read: the call was made with the orientation, and the result is a result.
      expect(real).toHaveBeenCalledWith(blob, {imageOrientation: 'from-image'});
      expect(decoded.ok).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(canDecode()).toBe(false);
  });
});

describe('a picture that is too large to open', () => {
  /** A browser whose decoder is counted, and whose file header (what the first bytes state) is given. */
  function counted(header: Uint8Array | null, natural = {width: 1200, height: 900}) {
    const world = browser({natural});
    const opened = vi.fn(world.deps.createImageBitmap!);
    world.deps.createImageBitmap = opened;
    world.deps.readHeader = async () => header ?? new Uint8Array(0);
    return {...world, opened};
  }

  it('is refused for what its header states BEFORE any decoder is asked, for each format', async () => {
    for (const [name, header] of [
      ['PNG', png(20000, 6000)],
      ['JPEG', jpeg(12001, 8333)],
      ['WebP', webpExtended(30000, 20000)],
    ] as const) {
      const world = counted(header);
      expect(await decodePicture(blob, world.deps), name).toEqual({ok: false, problem: 'too_large_pixels'});
      expect(world.opened, name).not.toHaveBeenCalled();
      expect(world.calls.canvases, name).toHaveLength(0);
    }
  });

  it('is refused just over 100 megapixels and measured at exactly 100 megapixels', async () => {
    const over = counted(png(10000, 10001));
    expect(await decodePicture(blob, over.deps)).toEqual({ok: false, problem: 'too_large_pixels'});
    expect(over.opened).not.toHaveBeenCalled();
    const exactly = counted(png(10000, 10000));
    const decoded = await decodePicture(blob, exactly.deps);
    expect(exactly.opened).toHaveBeenCalledTimes(1);
    expect(decoded.ok).toBe(true);
  });

  it('reads the start of the blob for its header when no reader is given', async () => {
    const world = browser();
    const opened = vi.fn(world.deps.createImageBitmap!);
    world.deps.createImageBitmap = opened;
    const big = new Blob([png(20000, 6000), new Uint8Array(1000)], {type: 'image/png'});
    expect(await decodePicture(big, world.deps)).toEqual({ok: false, problem: 'too_large_pixels'});
    expect(opened).not.toHaveBeenCalled();
    // A header that cannot be read is no reason to refuse: the decoder is asked.
    const failing = browser();
    failing.deps.readHeader = async () => {
      throw new Error('cannot read');
    };
    expect((await decodePicture(blob, failing.deps)).ok).toBe(true);
  });

  it('is refused for the size the decoder reports when the header stated none, and the bitmap is closed', async () => {
    const world = counted(null, {width: 20000, height: 6000});
    expect(await decodePicture(blob, world.deps)).toEqual({ok: false, problem: 'too_large_pixels'});
    expect(world.closed).toHaveBeenCalled();
    expect(world.calls.canvases).toHaveLength(0);
  });

  it('uses the header\'s size for the short edge when the decoder supplies none', async () => {
    const world = counted(jpeg(4032, 3024), {width: 0, height: 0});
    const decoded = await decodePicture(blob, world.deps);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.naturalWidth).toBe(4032);
    expect(decoded.naturalHeight).toBe(3024);
    expect(decoded.measurements.shortEdgePx).toBe(3024);
    expect({width: world.calls.canvases[0].width, height: world.calls.canvases[0].height}).toEqual(copySize(4032, 3024));
  });

  it('prefers the decoder\'s size (the oriented one the person sees) to the header\'s', async () => {
    const world = counted(jpeg(4032, 3024), {width: 3024, height: 4032});
    const decoded = await decodePicture(blob, world.deps);
    expect(decoded.ok && [decoded.naturalWidth, decoded.naturalHeight]).toEqual([3024, 4032]);
  });
});

describe('a decode that takes too long', () => {
  it('is given up after 30 seconds as busy, and not before', async () => {
    vi.useFakeTimers();
    try {
      const world = browser();
      world.deps.createImageBitmap = () => new Promise(() => undefined);
      let answer: unknown;
      void decodePicture(blob, world.deps).then((result) => {
        answer = result;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(answer).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toEqual({ok: false, problem: 'busy'});
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes a bitmap that arrives after the limit, and measures nothing for it', async () => {
    vi.useFakeTimers();
    try {
      const world = browser();
      let arrive: (bitmap: typeof world.bitmap) => void = () => undefined;
      world.deps.createImageBitmap = () => new Promise((resolve) => { arrive = resolve; });
      let answer: unknown;
      void decodePicture(blob, world.deps).then((result) => {
        answer = result;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(answer).toEqual({ok: false, problem: 'busy'});
      arrive(world.bitmap);
      await vi.advanceTimersByTimeAsync(0);
      expect(world.closed).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('has a limit that can be given, a default of 30 seconds, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    try {
      const world = browser();
      world.deps.timeoutMs = 5000;
      world.deps.createImageBitmap = () => new Promise(() => undefined);
      const pending = decodePicture(blob, world.deps);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual({ok: false, problem: 'busy'});
      expect(decodeTimeoutMs).toBe(30_000);
      expect(vi.getTimerCount()).toBe(0);
      // A decode that finishes in time clears its timer too.
      expect((await decodePicture(blob, browser().deps)).ok).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
