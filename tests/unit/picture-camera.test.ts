import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cameraConstraints, cameraSupported, captureFrame, captureQuality, openCamera, stopStream, watchTracks, type CameraDeps} from '@/lib/picture-camera';

// Taking a photo (Story 2.2, lib/picture-camera.ts) with a fake camera and a fake canvas: the camera is asked for only when openCamera is called (and
// cameraSupported asks for nothing), a refusal of any kind is `{ok: false}` and never a throw, every track is stopped, and a captured frame is a JPEG file.
afterEach(() => {
  vi.unstubAllGlobals();
});

const track = () => ({stop: vi.fn()});
const streamOf = (...tracks: {stop: () => void}[]) => ({getTracks: () => tracks}) as unknown as MediaStream;

describe('whether the browser can take photos', () => {
  it('is whether getUserMedia exists, and it never asks for the camera', () => {
    const getUserMedia = vi.fn();
    expect(cameraSupported({mediaDevices: {getUserMedia}})).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(cameraSupported({mediaDevices: {}})).toBe(false);
    expect(cameraSupported({mediaDevices: undefined})).toBe(false);
    expect(cameraSupported({mediaDevices: {getUserMedia: 'yes' as never}})).toBe(false);
  });

  it('reads navigator.mediaDevices when it is not given one, and is false where there is no navigator', () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
    expect(cameraSupported()).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', {});
    expect(cameraSupported()).toBe(false);
    vi.stubGlobal('navigator', undefined);
    expect(cameraSupported()).toBe(false);
  });
});

describe('asking for the camera', () => {
  it('asks exactly once, for video and no audio, preferring the rear camera at 1920 by 1080, and hands back the stream', async () => {
    const stream = streamOf(track());
    const getUserMedia = vi.fn(async () => stream);
    expect(await openCamera({mediaDevices: {getUserMedia}})).toEqual({ok: true, stream});
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // On purpose changed (review patch B6): the constraints also ask, as a hint and never a requirement, for 1920 by 1080 (the rear camera and no audio stand).
    expect(getUserMedia).toHaveBeenCalledWith({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false});
    expect(cameraConstraints).toEqual({video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false});
  });

  it('asks for nothing that is required: every constraint is an ideal, so no camera is refused for its size or its side', () => {
    const video = (cameraConstraints as {video: Record<string, unknown>}).video;
    for (const [name, value] of Object.entries(video)) expect(value, name).toEqual({ideal: expect.anything()});
    expect(JSON.stringify(cameraConstraints)).not.toMatch(/exact|min|max/);
    expect((cameraConstraints as {audio: boolean}).audio).toBe(false);
  });

  it.each([
    ['the person said no', () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))],
    ['there is no camera', () => Promise.reject(new DOMException('Requested device not found', 'NotFoundError'))],
    ['the camera is busy', () => Promise.reject(new DOMException('Could not start video source', 'NotReadableError'))],
    ['the browser threw at once', () => { throw new TypeError('not a secure context'); }],
  ])('is { ok: false } when %s, and never throws', async (_name, fail) => {
    expect(await openCamera({mediaDevices: {getUserMedia: fail as never}})).toEqual({ok: false});
  });

  it('is { ok: false } where the browser has no camera API, without asking anything', async () => {
    expect(await openCamera({mediaDevices: undefined})).toEqual({ok: false});
    expect(await openCamera({mediaDevices: {}})).toEqual({ok: false});
    vi.stubGlobal('navigator', {});
    expect(await openCamera()).toEqual({ok: false});
  });

  it('records nothing about the camera: the module writes no storage and no cookie', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../lib/picture-camera.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|fetch\(|permissions\.query/);
    expect([...source.matchAll(/getUserMedia\(/g)]).toHaveLength(1);
  });
});

describe('stopping the camera', () => {
  it('stops every track of the stream', () => {
    const tracks = [track(), track(), track()];
    stopStream(streamOf(...tracks));
    for (const one of tracks) expect(one.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps going when a track throws, and does nothing for no stream', () => {
    const throwing = {stop: vi.fn(() => { throw new Error('already stopped'); })};
    const after = track();
    expect(() => stopStream(streamOf(throwing, after))).not.toThrow();
    expect(after.stop).toHaveBeenCalledTimes(1);
    expect(() => stopStream(null)).not.toThrow();
    expect(() => stopStream(undefined)).not.toThrow();
    expect(() => stopStream(streamOf())).not.toThrow();
  });

  it('is safe to call twice', () => {
    const one = track();
    const stream = streamOf(one);
    stopStream(stream);
    stopStream(stream);
    expect(one.stop).toHaveBeenCalledTimes(2);
  });
});

describe('hearing that the camera went (review patch B6)', () => {
  /** A track that lets the test fire its `ended` event, as the browser does when the camera is unplugged or the permission is taken back. */
  function endingTrack() {
    const listeners = new Set<() => void>();
    return {
      stop: vi.fn(),
      addEventListener: vi.fn((_type: 'ended', listener: () => void) => void listeners.add(listener)),
      removeEventListener: vi.fn((_type: 'ended', listener: () => void) => void listeners.delete(listener)),
      end: () => [...listeners].forEach((listener) => listener()),
      count: () => listeners.size,
    };
  }

  it('listens for `ended` on every track, and tells the listener when any of them ends', () => {
    const tracks = [endingTrack(), endingTrack()];
    const listener = vi.fn();
    watchTracks(streamOf(...tracks), listener);
    for (const one of tracks) expect(one.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    tracks[1].end();
    expect(listener).toHaveBeenCalledTimes(1);
    tracks[0].end();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('takes the listeners off again with the function it returns', () => {
    const tracks = [endingTrack(), endingTrack()];
    const listener = vi.fn();
    const unwatch = watchTracks(streamOf(...tracks), listener);
    expect(tracks.map((one) => one.count())).toEqual([1, 1]);
    unwatch();
    expect(tracks.map((one) => one.count())).toEqual([0, 0]);
    for (const one of tracks) one.end();
    expect(listener).not.toHaveBeenCalled();
  });

  it('is fine with tracks that have no event listeners at all, and with a stream that has no tracks', () => {
    const plain = [track(), track()];
    const unwatch = watchTracks(streamOf(...plain), vi.fn());
    expect(() => unwatch()).not.toThrow();
    expect(() => watchTracks(streamOf(), vi.fn())()).not.toThrow();
  });

  it('is not told by stopping a track ourselves: stopStream does not call the listener', () => {
    // A real track fires no `ended` for its own stop(); the fake here fires nothing either, and stopStream must never call the listener itself.
    const tracks = [endingTrack()];
    const listener = vi.fn();
    watchTracks(streamOf(...tracks), listener);
    stopStream(streamOf(...tracks));
    expect(tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('capturing a frame', () => {
  /** A fake canvas that records what is drawn on it and gives a blob of the size it is told. */
  function canvas(options: {context?: unknown; blob?: Blob | null} = {}) {
    const drawn: unknown[][] = [];
    const calls: {type?: string; quality?: number}[] = [];
    const made = {
      width: 0,
      height: 0,
      getContext: vi.fn((kind: string) => (kind === '2d' ? ('context' in options ? options.context : {drawImage: (...args: unknown[]) => drawn.push(args)}) : null)),
      toBlob: vi.fn((callback: (blob: Blob | null) => void, type?: string, quality?: number) => {
        calls.push({type, quality});
        callback('blob' in options ? (options.blob ?? null) : new Blob([new Uint8Array(1200)], {type: 'image/jpeg'}));
      }),
    };
    return {made, drawn, calls, deps: {createCanvas: () => made} as unknown as CameraDeps};
  }
  const video = {videoWidth: 640, videoHeight: 480};

  it('is a JPEG file named photo.jpg, drawn at the frame\'s own size, at quality 0.92', async () => {
    const {made, drawn, calls, deps} = canvas();
    const file = await captureFrame(video, deps);
    expect(file).toBeInstanceOf(File);
    expect(file?.name).toBe('photo.jpg');
    expect(file?.type).toBe('image/jpeg');
    expect(file?.size).toBe(1200);
    expect([made.width, made.height]).toEqual([640, 480]);
    expect(drawn).toEqual([[video, 0, 0, 640, 480]]);
    expect(calls).toEqual([{type: 'image/jpeg', quality: 0.92}]);
    expect(captureQuality).toBe(0.92);
    expect(made.getContext).toHaveBeenCalledWith('2d');
  });

  it('is null when the video has no frame yet', async () => {
    for (const size of [{videoWidth: 0, videoHeight: 480}, {videoWidth: 640, videoHeight: 0}, {videoWidth: 0, videoHeight: 0}, {videoWidth: Number.NaN, videoHeight: 480}]) {
      const {made, deps} = canvas();
      expect(await captureFrame(size, deps), JSON.stringify(size)).toBeNull();
      expect(made.toBlob).not.toHaveBeenCalled();
    }
  });

  it('is null, never a throw, when the canvas work throws: no context, drawing, encoding or even making the canvas (review patch B6)', async () => {
    const throwing = (where: 'getContext' | 'drawImage' | 'toBlob' | 'createCanvas'): CameraDeps => {
      const fail = () => {
        throw new Error(`${where} failed`);
      };
      if (where === 'createCanvas') return {createCanvas: fail} as unknown as CameraDeps;
      return {
        createCanvas: () => ({
          width: 0,
          height: 0,
          getContext: where === 'getContext' ? fail : () => ({drawImage: where === 'drawImage' ? fail : () => undefined}),
          toBlob: where === 'toBlob' ? fail : (callback: (blob: Blob | null) => void) => callback(null),
        }),
      } as unknown as CameraDeps;
    };
    for (const where of ['getContext', 'drawImage', 'toBlob', 'createCanvas'] as const) await expect(captureFrame(video, throwing(where)), where).resolves.toBeNull();
  });

  it('is null when there is no 2d context, and when the browser could not make the picture', async () => {
    expect(await captureFrame(video, canvas({context: null}).deps)).toBeNull();
    expect(await captureFrame(video, canvas({blob: null}).deps)).toBeNull();
    expect(await captureFrame(video, canvas({blob: new Blob([])}).deps)).toBeNull();
  });
});
