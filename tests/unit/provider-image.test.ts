import {describe, expect, it} from 'vitest';
import sharp from 'sharp';
import {
  buildProviderImageDerivative,
  ProviderImageError,
  providerImageMaxBytes,
  providerImageMaxEdge,
} from '@/lib/provider-image';

describe('provider-bound picture derivatives', () => {
  it('re-encodes retained image pixels as a bounded metadata-free JPEG', async () => {
    const original = await sharp({create: {width: 2200, height: 900, channels: 3, background: '#4789cc'}})
      .jpeg()
      .withMetadata({exif: {IFD0: {ImageDescription: 'private marker'}}})
      .toBuffer();
    const before = Buffer.from(original);
    const derivative = await buildProviderImageDerivative(original);
    const metadata = await sharp(derivative.bytes).metadata();
    expect(derivative.contentType).toBe('image/jpeg');
    expect(derivative.bytes.byteLength).toBeLessThanOrEqual(providerImageMaxBytes);
    expect(Math.max(derivative.width, derivative.height)).toBeLessThanOrEqual(providerImageMaxEdge);
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(derivative.bytes.includes(Buffer.from('private marker'))).toBe(false);
    expect(original).toEqual(before);
  });

  it('rejects damaged, unsupported, and empty inputs without returning bytes', async () => {
    await expect(buildProviderImageDerivative(new Uint8Array())).rejects.toMatchObject({code: 'invalid_image'} satisfies Partial<ProviderImageError>);
    await expect(buildProviderImageDerivative(Buffer.from('not an image'))).rejects.toMatchObject({code: 'invalid_image'});
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
    await expect(buildProviderImageDerivative(svg)).rejects.toMatchObject({code: 'unsupported_image'});
  });
});
