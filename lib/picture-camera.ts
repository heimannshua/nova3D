// Story 2.2. Taking a photo on a device with a camera: ask for the camera (only when the person presses Take photo, and not a moment before),
// show what it sees, and turn one frame into a JPEG file that joins the set like a chosen file. Nothing about the camera is recorded anywhere: not
// the permission, not the device, not that it was used.
//
// BROWSER-SAFE; every dependency is injectable so the tests run it in Node. It touches `navigator` and `document` only inside a function.

/** The part of a media stream this uses (every track is stopped when the person captures, cancels or leaves, and its `ended` event is heard when the camera goes). */
export type CameraTrack = {stop(): void; addEventListener?(type: 'ended', listener: () => void): void; removeEventListener?(type: 'ended', listener: () => void): void};
export type CameraStream = {getTracks(): CameraTrack[]};

export type CameraDeps = {
  /** `navigator.mediaDevices`; undefined where the browser has none. */
  mediaDevices?: {getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>} | undefined;
  /** Makes the canvas a frame is drawn on. */
  createCanvas?: () => Pick<HTMLCanvasElement, 'getContext' | 'toBlob' | 'width' | 'height'>;
};

/** The JPEG quality of a captured frame. */
export const captureQuality = 0.92;

/** What the camera is asked for: the rear camera where there is one, at 1920 by 1080 if it can (a hint, never a requirement), and no sound. */
export const cameraConstraints: MediaStreamConstraints = {video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false};

const devicesOf = (deps: CameraDeps) => ('mediaDevices' in deps ? deps.mediaDevices : typeof navigator === 'undefined' ? undefined : navigator.mediaDevices);

/** Whether this browser can ask for a camera at all (`navigator.mediaDevices.getUserMedia` exists). It asks for nothing. */
export function cameraSupported(deps: CameraDeps = {}): boolean {
  return typeof devicesOf(deps)?.getUserMedia === 'function';
}

/**
 * Asks for the camera. This is the one place the permission is requested, and it is called only when Take photo is pressed. `denied` covers everything
 * that is not a stream: the person said no, there is no camera, the camera is busy, or the browser failed; the screen says so in words and the file
 * picker keeps working. The rear camera is preferred where there is one.
 */
export async function openCamera(deps: CameraDeps = {}): Promise<{ok: true; stream: MediaStream} | {ok: false}> {
  const devices = devicesOf(deps);
  if (typeof devices?.getUserMedia !== 'function') return {ok: false};
  try {
    const stream = await devices.getUserMedia(cameraConstraints);
    return {ok: true, stream};
  } catch {
    return {ok: false};
  }
}

/**
 * Calls `listener` when any track of the stream ends by itself (the camera was unplugged, or the browser or the person took the permission back). Stopping a track
 * ourselves does not fire it. Returns what takes the listeners off again.
 */
export function watchTracks(stream: CameraStream, listener: () => void): () => void {
  const tracks = stream.getTracks();
  for (const track of tracks) track.addEventListener?.('ended', listener);
  return () => {
    for (const track of tracks) track.removeEventListener?.('ended', listener);
  };
}

/** Stops every track of a stream, so the camera's light goes out. Safe to call twice. */
export function stopStream(stream: CameraStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A track that is already stopped.
    }
  }
}

/**
 * One frame of the live preview as a JPEG file (quality 0.92, drawn on a canvas of the frame's own size). Null when there is no frame yet (the video has
 * no size), no canvas, or the browser could not make the picture. The file's name is `photo.jpg`: a frame has no name of its own, and none is stored.
 */
export async function captureFrame(video: {videoWidth: number; videoHeight: number}, deps: CameraDeps = {}): Promise<File | null> {
  if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) return null;
  // Drawing and encoding can fail (no memory for a large frame, a canvas the browser refuses): that is no picture, not an error the screen has to catch.
  try {
    const canvas = deps.createCanvas ? deps.createCanvas() : document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', captureQuality));
    return blob && blob.size > 0 ? new File([blob], 'photo.jpg', {type: 'image/jpeg'}) : null;
  } catch {
    return null;
  }
}
