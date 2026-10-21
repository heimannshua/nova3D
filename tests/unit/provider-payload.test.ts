import {describe, expect, it} from 'vitest';
import sharp from 'sharp';
import {assertPayloadCategory, assertPayloadPermission, buildSearchPayload, buildSynthesisPayload} from '@/lib/providers/payload';
import type {ProviderImageDerivative} from '@/lib/provider-image';

describe('provider payload boundaries', () => {
  it('projects search input to a normalized public subject only', () => {
    expect(buildSearchPayload({confirmedPublicSubject: '  Middot\n  Altar '})).toEqual({query: 'Middot Altar', purpose: 'discover public sources'});
    expect(buildSearchPayload({confirmedPublicSubject: 'The public subject'})).not.toHaveProperty('credentials');
    expect(() => assertPayloadCategory('research_search', ['normalized_public_subject', 'project_evidence'])).toThrow();
  });

  it('includes only purpose-approved project fields and derivatives', async () => {
    const bytes = await sharp({create: {width: 20, height: 10, channels: 3, background: '#123456'}}).jpeg().toBuffer();
    const image: ProviderImageDerivative = {bytes, contentType: 'image/jpeg', width: 20, height: 10};
    const payload = buildSynthesisPayload({
      purpose: 'identify the architectural subject',
      confirmedScope: 'Outer altar and ramp',
      approvedEvidence: [{label: 'Source excerpt', text: 'A short approved excerpt.'}],
      derivatives: [image],
      allowedData: ['confirmed_project_scope', 'project_evidence', 'provider_image_derivatives'],
    });
    expect(payload).toEqual({
      purpose: 'identify the architectural subject',
      confirmedScope: 'Outer altar and ramp',
      approvedEvidence: [{label: 'Source excerpt', text: 'A short approved excerpt.'}],
      images: [{mediaType: 'image/jpeg', bytes: image.bytes, width: 20, height: 10}],
    });
    expect(payload).not.toHaveProperty('workspace');
    expect(payload).not.toHaveProperty('credentials');
  });

  it('refuses a mislabeled or oversized derivative at payload construction', () => {
    const bad: ProviderImageDerivative = {bytes: Buffer.from('not jpeg'), contentType: 'image/jpeg', width: 20, height: 10};
    expect(() => buildSynthesisPayload({purpose: 'inspect', confirmedScope: 'scope', approvedEvidence: [], derivatives: [bad], allowedData: ['provider_image_derivatives']})).toThrow();
    const tooLarge: ProviderImageDerivative = {bytes: Buffer.alloc(5 * 1024 * 1024 + 1), contentType: 'image/jpeg', width: 20, height: 10};
    expect(() => buildSynthesisPayload({purpose: 'inspect', confirmedScope: 'scope', approvedEvidence: [], derivatives: [tooLarge], allowedData: ['provider_image_derivatives']})).toThrow();
  });

  it('matches category, purpose and permitted data at the adapter payload boundary', () => {
    const payload = buildSearchPayload({confirmedPublicSubject: 'Middot Altar'});
    expect(() => assertPayloadPermission({category: 'synthesis_vision', purpose: 'discover', allowedData: ['normalized_public_subject'], payload})).toThrow();
    expect(() => assertPayloadPermission({category: 'research_search', purpose: 'another purpose', allowedData: ['normalized_public_subject'], payload})).toThrow();
    const synthesis = buildSynthesisPayload({purpose: 'identify subject', confirmedScope: 'scope', approvedEvidence: [], derivatives: [], allowedData: ['confirmed_project_scope']});
    expect(() => assertPayloadPermission({category: 'synthesis_vision', purpose: 'different purpose', allowedData: ['confirmed_project_scope'], payload: synthesis})).toThrow();
    expect(() => assertPayloadPermission({category: 'synthesis_vision', purpose: 'identify subject', allowedData: ['project_evidence'], payload: synthesis})).toThrow();
  });
});
