import {normalizePublicSubject, type OutboundDataCategory, type PaidCategory} from './policy';
import type {ProviderImageDerivative} from '../provider-image';

export type SearchPayload = {query: string; purpose: string};
export type SynthesisPayload = {
  purpose: string;
  confirmedScope: string;
  approvedEvidence: readonly {label: string; text: string}[];
  images: readonly {mediaType: 'image/jpeg'; bytes: Buffer; width: number; height: number}[];
};

/** Search receives only the normalized public subject; arbitrary caller fields cannot cross this boundary. */
export function buildSearchPayload(input: {confirmedPublicSubject: string; purpose?: string}): SearchPayload {
  return {query: normalizePublicSubject(input.confirmedPublicSubject), purpose: clean(input.purpose ?? 'discover public sources', 240, 'purpose')};
}

/** Vision/synthesis payload constructor with an explicit field allowlist and only already-approved derivatives. */
export function buildSynthesisPayload(input: {
  purpose: string;
  confirmedScope: string;
  approvedEvidence: readonly {label: string; text: string}[];
  derivatives: readonly ProviderImageDerivative[];
  allowedData: readonly OutboundDataCategory[];
}): SynthesisPayload {
  const purpose = clean(input.purpose, 240, 'purpose');
  const confirmedScope = input.allowedData.includes('confirmed_project_scope') ? clean(input.confirmedScope, 8_000, 'confirmed scope') : '';
  const approvedEvidence = input.allowedData.includes('project_evidence')
    ? input.approvedEvidence.slice(0, 100).map((entry) => ({label: clean(entry.label, 160, 'evidence label'), text: clean(entry.text, 20_000, 'evidence')}))
    : [];
  const images = input.allowedData.includes('provider_image_derivatives')
    ? input.derivatives.slice(0, 12).map((image) => {
      const dimensions = jpegDimensions(image.bytes);
      if (image.contentType !== 'image/jpeg' || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 1568 || image.height > 1568 || image.bytes.byteLength > 5 * 1024 * 1024 || !dimensions || dimensions.width !== image.width || dimensions.height !== image.height) throw new TypeError('Image derivative is outside provider bounds.');
      return {mediaType: 'image/jpeg' as const, bytes: image.bytes, width: image.width, height: image.height};
    }) : [];
  return {purpose, confirmedScope, approvedEvidence, images};
}

function jpegDimensions(bytes: Buffer): {width: number; height: number} | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  let dimensions: {width: number; height: number} | null = null;
  for (let i = 2; i + 4 < bytes.length && bytes[i] === 0xff;) {
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(i + 2);
    if ([0xe1, 0xe2, 0xed, 0xfe].includes(marker) || length < 2 || i + 2 + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return null;
      dimensions = {height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7)};
    }
    i += 2 + length;
  }
  return dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions : null;
}

function clean(value: unknown, maximum: number, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be text.`);
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').trim();
  if (!normalized || [...normalized].length > maximum) throw new TypeError(`${name} must contain 1 to ${maximum} characters.`);
  return normalized;
}

/** Reject incoherent permission and payload combinations at the trust boundary. */
export function assertPayloadPermission(input: {category: PaidCategory; purpose: string; allowedData: readonly OutboundDataCategory[]; payload: SearchPayload | SynthesisPayload}): void {
  assertPayloadCategory(input.category, input.allowedData);
  if (input.category === 'research_search') {
    if (!('query' in input.payload) || input.payload.purpose !== clean(input.purpose, 240, 'purpose') || input.allowedData.length !== 1 || input.allowedData[0] !== 'normalized_public_subject') throw new TypeError('Search payload does not match permission.');
    return;
  }
  if (!('confirmedScope' in input.payload) || input.payload.purpose !== clean(input.purpose, 240, 'purpose')) throw new TypeError('Synthesis purpose does not match permission.');
  const payload = input.payload;
  if (!input.allowedData.includes('confirmed_project_scope') && payload.confirmedScope) throw new TypeError('Scope is not permissioned.');
  if (!input.allowedData.includes('project_evidence') && payload.approvedEvidence.length) throw new TypeError('Evidence is not permissioned.');
  if (!input.allowedData.includes('provider_image_derivatives') && payload.images.length) throw new TypeError('Images are not permissioned.');
  for (const image of payload.images) {
    const dimensions = jpegDimensions(image.bytes);
    if (image.mediaType !== 'image/jpeg' || image.bytes.byteLength > 5 * 1024 * 1024 || image.width > 1568 || image.height > 1568 || !dimensions || dimensions.width !== image.width || dimensions.height !== image.height) throw new TypeError('Image derivative is outside provider bounds.');
  }
}

/** Search cannot carry any other outbound category; synthesis cannot smuggle the discovery subject. */
export function assertPayloadCategory(category: PaidCategory, data: readonly OutboundDataCategory[]): void {
  if (category === 'research_search' && (data.length !== 1 || data[0] !== 'normalized_public_subject')) throw new TypeError('Search may receive only a normalized public subject.');
  if (category === 'synthesis_vision' && data.includes('normalized_public_subject')) throw new TypeError('A raw search subject is not a synthesis payload category.');
}
