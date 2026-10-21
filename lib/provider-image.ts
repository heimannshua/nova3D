// Story 2.5. Server-only, transient image derivative for a provider request.
// Sharp decodes the retained original, applies orientation, re-encodes JPEG and
// omits all source metadata. This module never reads or writes the original.
import sharp, {type Metadata, type Sharp} from 'sharp';

export const providerImageMaxEdge = 1568;
export const providerImageMaxBytes = 5 * 1024 * 1024;
const supportedFormats = new Set(['jpeg', 'png', 'webp']);

export type ProviderImageDerivative = {
  bytes: Buffer;
  contentType: 'image/jpeg';
  width: number;
  height: number;
};

export class ProviderImageError extends Error {
  readonly code: 'invalid_image' | 'unsupported_image' | 'image_too_large';

  constructor(code: 'invalid_image' | 'unsupported_image' | 'image_too_large') {
    super(code);
    this.name = 'ProviderImageError';
    this.code = code;
  }
}

/** Build a bounded JPEG without mutating or retaining the provided picture. */
export async function buildProviderImageDerivative(input: Uint8Array): Promise<ProviderImageDerivative> {
  if (!(input instanceof Uint8Array) || input.byteLength === 0) throw new ProviderImageError('invalid_image');
  let source: Sharp;
  let metadata: Metadata;
  try {
    source = sharp(Buffer.from(input), {failOn: 'error', limitInputPixels: 100_000_000, animated: false});
    metadata = await source.metadata();
  } catch {
    throw new ProviderImageError('invalid_image');
  }
  if (!metadata.format || !supportedFormats.has(metadata.format) || metadata.pages && metadata.pages > 1) {
    throw new ProviderImageError('unsupported_image');
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 100_000_000) {
    throw new ProviderImageError('invalid_image');
  }

  // Sharp's rotate() applies EXIF orientation; metadata is not copied into the
  // new pipeline. Reduce quality first, then dimensions, retaining the edge cap.
  let scale = Math.min(1, providerImageMaxEdge / Math.max(metadata.width, metadata.height));
  for (let pass = 0; pass < 12; pass += 1) {
    const width = Math.max(1, Math.round(metadata.width * scale));
    const height = Math.max(1, Math.round(metadata.height * scale));
    const quality = pass < 6 ? 86 - pass * 8 : 46;
    try {
      const bytes = await sharp(Buffer.from(input), {failOn: 'error', limitInputPixels: 100_000_000, animated: false})
        .rotate()
        .resize({width, height, fit: 'inside', withoutEnlargement: true})
        .jpeg({quality, mozjpeg: true, chromaSubsampling: '4:2:0'})
        .toBuffer();
      const output = await sharp(bytes).metadata();
      if (bytes.byteLength <= providerImageMaxBytes && output.width && output.height && Math.max(output.width, output.height) <= providerImageMaxEdge) {
        return {bytes, contentType: 'image/jpeg', width: output.width, height: output.height};
      }
    } catch {
      throw new ProviderImageError('invalid_image');
    }
    scale *= 0.8;
  }
  throw new ProviderImageError('image_too_large');
}
