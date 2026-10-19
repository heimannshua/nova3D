import {describe, expect, it, vi} from 'vitest';
import {createTranslator, translate, type Locale} from '@/lib/i18n';
import {assess, type Measurements, type ViewLabel} from '@/lib/picture-quality';
import {
  badgeKeys,
  coverageOf,
  firstStepIssue,
  incompleteFacts,
  incompleteKey,
  incompleteSentences,
  itemsIncomplete,
  labelKeys,
  labelsOf,
  listOf,
  measurementsFromFields,
  problemWords,
  problemsOf,
  reasonRetryable,
  reviewFields,
  reviewItems,
  reviewedImagesOf,
  unusableRemedy,
  updateReviewItem,
  type ReviewItem,
  type ReviewableImage,
} from '@/lib/picture-review';
import {anyUnkept} from '@/lib/picture-review';
import {attemptRetain, attemptReview, confirmReview, confirmStatusKey, retainForm, retainIdle, reviewIdle, reviewKey, reviewOfRetain, reviewParams, settleReview, type RetainState, type ReviewState} from '@/lib/picture-view';

// What the review screen works out about the pictures it shows (Story 2.3, lib/picture-review.ts) and how an answer to Confirm is read (lib/picture-view.ts), as pure
// rules: the first step's issue and its order, the facts a Generate anyway warning puts into words, the form the action reads, and the messages.
const upload = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (character: string) => character.repeat(64);
const image = (position: number, patch: Partial<ReviewableImage> = {}): ReviewableImage => ({
  position,
  uploadId: upload(position),
  sha256: sha(String.fromCharCode(96 + position)),
  length: 482113 * position,
  contentType: 'image/jpeg',
  available: true,
  label: null,
  ...patch,
});
const good: Measurements = {shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213};
/** A review item that is measured, with a label. */
const measured = (position: number, label: ViewLabel | null, measurements: Measurements = good): ReviewItem => ({
  ...reviewItems([image(position)])[0],
  position,
  key: `review-${position}`,
  uploadId: upload(position),
  label,
  state: 'measured',
  measurements,
});

describe('the pictures of a review', () => {
  it('start from the saved pictures, in order, waiting to be measured, with the label they were given before', () => {
    const items = reviewItems([image(3, {label: 'top'}), image(1), image(2, {label: 'left'})]);
    expect(items.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(items.map((item) => item.key)).toEqual(['review-1', 'review-2', 'review-3']);
    expect(items.map((item) => item.label)).toEqual([null, 'left', 'top']);
    for (const item of items) expect(item).toMatchObject({state: 'measuring', measurements: null, reason: null, thumbnailUrl: null});
    expect(items[0]).toMatchObject({uploadId: upload(1), sha256: sha('a'), length: 482113, contentType: 'image/jpeg'});
  });

  it('are unusable from the start when their private copy has lapsed: they cannot be read back', () => {
    const [lapsed, fine] = reviewItems([image(1, {available: false}), image(2)]);
    expect(lapsed).toMatchObject({state: 'unusable', reason: 'lapsed', measurements: null});
    expect(fine.state).toBe('measuring');
  });

  it('change one at a time by key, and the list is unchanged for a key that names none', () => {
    const items = reviewItems([image(1), image(2)]);
    const next = updateReviewItem(items, 'review-2', {label: 'back'});
    expect(next.map((item) => item.label)).toEqual([null, 'back']);
    expect(items[1].label).toBeNull();
    expect(updateReviewItem(items, 'review-9', {label: 'back'})).toEqual(items);
  });

  it('give the labels in order, the problems of each by name, and none for a picture that is not measured', () => {
    const items = [measured(1, 'front'), measured(2, null, {shortEdgePx: 700, blurVariance: 3, clippedFraction: 0.9}), reviewItems([image(3)])[0]];
    expect(labelsOf(items)).toEqual(['front', null, null]);
    expect(problemsOf(items[0])).toEqual([]);
    expect(problemsOf(items[1])).toEqual(['resolution', 'blur', 'exposure']);
    expect(problemsOf(items[2])).toEqual([]);
  });

  it('say which views they show', () => {
    expect(coverageOf([measured(1, 'front'), measured(2, 'front'), measured(3, 'detail')])).toMatchObject({count: 1, met: false, missing: ['back', 'left']});
    expect(coverageOf([measured(1, 'front'), measured(2, 'left'), measured(3, 'top')])).toMatchObject({count: 3, met: true, missing: []});
  });

  it('may be retried only when the download did not answer, took too long, or the decode did not finish', () => {
    for (const reason of ['unavailable', 'network', 'busy'] as const) expect(reasonRetryable(reason), reason).toBe(true);
    for (const reason of ['lapsed', 'changed', 'reload', 'refused', 'undecodable', 'too_large_pixels'] as const) expect(reasonRetryable(reason), reason).toBe(false);
  });

  it('are fixed by another copy (a copy that lapsed, changed or was refused), by a smaller picture (one that cannot be opened or is too large), or by trying again', () => {
    for (const reason of ['lapsed', 'changed', 'refused'] as const) expect(unusableRemedy(reason), reason).toBe('replace');
    for (const reason of ['undecodable', 'too_large_pixels'] as const) expect(unusableRemedy(reason), reason).toBe('smaller');
    for (const reason of ['reload', 'unavailable', 'network', 'busy'] as const) expect(unusableRemedy(reason), reason).toBeNull();
  });

  it('have an acknowledgment that is void as soon as a label, a measurement or the mix of views changes what the warning says', () => {
    const base = [measured(1, 'front'), measured(2, 'front'), measured(3, 'detail')];
    expect(incompleteKey(base)).toBe(incompleteKey([...base]));
    // A label that changes the views shown (and the ones to add).
    expect(incompleteKey(updateReviewItem(base, 'review-2', {label: 'left'}))).not.toBe(incompleteKey(base));
    // A detail close-up that becomes a top view: one more different view.
    expect(incompleteKey(updateReviewItem(base, 'review-3', {label: 'top'}))).not.toBe(incompleteKey(base));
    // A measurement that makes a problem.
    expect(incompleteKey(updateReviewItem(base, 'review-1', {measurements: {shortEdgePx: 700, blurVariance: 412.375, clippedFraction: 0.0213}}))).not.toBe(incompleteKey(base));
  });
});

describe('what stops the first step', () => {
  const ready = [measured(1, 'front'), measured(2, 'left'), measured(3, 'top')];

  it('is nothing for measured, labelled pictures once the person has confirmed that nothing blocks the subject', () => {
    expect(firstStepIssue(ready, true)).toBeNull();
  });

  it('is the unconfirmed obstruction question, in both modes, with no override', () => {
    expect(firstStepIssue(ready, false)).toBe('obstruction');
  });

  it('is a picture with no label', () => {
    expect(firstStepIssue([measured(1, 'front'), measured(2, null)], true)).toBe('labels');
  });

  it('is a picture that cannot be used: it cannot be acknowledged, so nothing lets the person go on', () => {
    const unusable: ReviewItem = {...measured(2, 'left'), state: 'unusable', measurements: null, reason: 'undecodable'};
    expect(firstStepIssue([measured(1, 'front'), unusable], true)).toBe('unusable');
  });

  it('is a picture that is still being measured', () => {
    expect(firstStepIssue([measured(1, 'front'), reviewItems([image(2)])[0]], true)).toBe('busy');
  });

  it('is told in the order busy, unusable, labels, obstruction', () => {
    const measuring = reviewItems([image(1)])[0];
    const unusable: ReviewItem = {...measured(2, 'left'), state: 'unusable', measurements: null, reason: 'lapsed'};
    const unlabelled = measured(3, null);
    expect(firstStepIssue([measuring, unusable, unlabelled], false)).toBe('busy');
    expect(firstStepIssue([unusable, unlabelled], false)).toBe('unusable');
    expect(firstStepIssue([unlabelled], false)).toBe('labels');
    expect(firstStepIssue([measured(1, 'front')], false)).toBe('obstruction');
  });

  it('is a quality problem for none of them: a blurry picture does not stop the step (it needs the acknowledgment later, for direct conversion only)', () => {
    expect(firstStepIssue([measured(1, 'front', {shortEdgePx: 100, blurVariance: 0, clippedFraction: 1})], true)).toBeNull();
  });
});

describe('whether direct conversion has too little to go on', () => {
  it('is false until every picture is labelled and measured', () => {
    expect(itemsIncomplete([measured(1, 'front'), measured(2, null)])).toBe(false);
    expect(itemsIncomplete(reviewItems([image(1)]))).toBe(false);
    expect(reviewedImagesOf([measured(1, 'front'), measured(2, null)])).toBeNull();
  });

  it('is the rule of the quality module over the labels and measurements', () => {
    expect(itemsIncomplete([measured(1, 'front'), measured(2, 'left'), measured(3, 'top')])).toBe(false);
    expect(itemsIncomplete([measured(1, 'front'), measured(2, 'left')])).toBe(true);
    expect(itemsIncomplete([measured(1, 'front'), measured(2, 'left'), measured(3, 'top', {...good, blurVariance: 41})])).toBe(true);
  });

  it('hands the pictures over in order with their labels and measurements', () => {
    expect(reviewedImagesOf([measured(1, 'front'), measured(2, 'detail')])).toEqual([
      {uploadId: upload(1), label: 'front', measurements: good},
      {uploadId: upload(2), label: 'detail', measurements: good},
    ]);
  });
});

describe('the facts a Generate anyway warning puts into words', () => {
  it('are how many different views, which to add, and each picture with a problem, in order, by name', () => {
    const facts = incompleteFacts([
      {label: 'front', measurements: good},
      {label: 'left', measurements: {shortEdgePx: 1200, blurVariance: 41, clippedFraction: 0.01}},
      {label: 'detail', measurements: {shortEdgePx: 900, blurVariance: 300, clippedFraction: 0.5}},
    ]);
    expect(facts).toEqual({
      views: 2,
      needed: 3,
      missing: ['back'],
      pictures: [
        {position: 2, label: 'left', problems: ['blur']},
        {position: 3, label: 'detail', problems: ['exposure']},
      ],
    });
  });

  it('are the views to add and no pictures when every picture is fine but the views are few', () => {
    expect(incompleteFacts([{label: 'front', measurements: good}, {label: 'front', measurements: good}, {label: 'detail', measurements: good}])).toEqual({views: 1, needed: 3, missing: ['back', 'left'], pictures: []});
  });

  it('are the problems and no views to add when there are views enough', () => {
    const facts = incompleteFacts([{label: 'front', measurements: good}, {label: 'left', measurements: good}, {label: 'top', measurements: {shortEdgePx: 100, blurVariance: 1, clippedFraction: 1}}]);
    expect(facts).toMatchObject({views: 3, missing: [], pictures: [{position: 3, label: 'top', problems: ['resolution', 'blur', 'exposure']}]});
  });

  it('agree with the quality module about what a problem is', () => {
    for (const measurements of [good, {...good, blurVariance: 99.999}, {...good, shortEdgePx: 799}, {...good, clippedFraction: 0.3501}]) {
      expect(incompleteFacts([{label: 'front', measurements}]).pictures.length > 0).toBe(assess(measurements).problems.length > 0);
    }
  });
});

describe.each(['en', 'he'] as Locale[])('the sentences of a warning, in %s', (locale) => {
  const t = createTranslator(locale);
  // A name in the middle of a sentence is in lower case by the rules of the UI's language (Hebrew has no case).
  const inSentence = (text: string) => text.toLocaleLowerCase(locale);

  it('joins names in the language\'s own way', () => {
    const [one, two, three] = ['A', 'B', 'C'];
    expect(listOf(t, [])).toBe('');
    expect(listOf(t, [one])).toBe(one);
    expect(listOf(t, [one, two])).toBe(translate(locale, 'review.list.two', {first: one, second: two}));
    expect(listOf(t, [one, two, three])).toBe(translate(locale, 'review.list.many', {list: `${one}${translate(locale, 'review.list.comma')}${two}`, last: three}));
  });

  it('names a picture\'s problems in words', () => {
    expect(problemWords(t, ['blur'], locale)).toBe(inSentence(translate(locale, badgeKeys.blur)));
    expect(problemWords(t, ['resolution', 'exposure'], locale)).toContain(inSentence(translate(locale, badgeKeys.resolution)));
  });

  it('puts a name in lower case by the rules of the UI\'s language, never of the machine\'s', () => {
    const spy = vi.spyOn(String.prototype, 'toLocaleLowerCase');
    try {
      problemWords(t, ['blur', 'exposure'], locale);
      incompleteSentences(t, [{label: 'front', measurements: good}, {label: 'detail', measurements: {...good, blurVariance: 3}}], locale);
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for (const call of spy.mock.calls) expect(call[0]).toBe(locale);
    } finally {
      spy.mockRestore();
    }
  });

  it('names the missing views, then each picture with its problems', () => {
    const sentences = incompleteSentences(t, [
      {label: 'front', measurements: good},
      {label: 'left', measurements: {shortEdgePx: 1200, blurVariance: 41, clippedFraction: 0.01}},
    ], locale);
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toBe(translate(locale, 'review.ack.missing', {count: 2, needed: 3, views: inSentence(translate(locale, labelKeys.back))}));
    expect(sentences[1]).toBe(translate(locale, 'review.ack.picture', {position: 2, view: inSentence(translate(locale, labelKeys.left)), problems: inSentence(translate(locale, badgeKeys.blur))}));
  });

  it('says only the problems when there are views enough, and only the views when every picture is fine', () => {
    expect(incompleteSentences(t, [{label: 'front', measurements: good}, {label: 'left', measurements: good}, {label: 'top', measurements: {...good, shortEdgePx: 700}}], locale)).toHaveLength(1);
    expect(incompleteSentences(t, [{label: 'front', measurements: good}, {label: 'front', measurements: good}], locale)).toEqual([
      translate(locale, 'review.ack.missing', {count: 1, needed: 3, views: `${translate(locale, 'review.list.two', {first: inSentence(translate(locale, labelKeys.back)), second: inSentence(translate(locale, labelKeys.left))})}`}),
    ]);
    expect(incompleteSentences(t, [{label: 'front', measurements: good}, {label: 'left', measurements: good}, {label: 'top', measurements: good}], locale)).toEqual([]);
  });

  it('says there are too few views when none can be recommended (every angle is already labelled but fewer than three are present is impossible, so it only happens with no pictures at all)', () => {
    expect(incompleteSentences(t, [], locale)).toEqual([translate(locale, 'review.ack.missing', {count: 0, needed: 3, views: translate(locale, 'review.list.many', {list: `${inSentence(translate(locale, labelKeys.front))}${translate(locale, 'review.list.comma')}${inSentence(translate(locale, labelKeys.back))}`, last: inSentence(translate(locale, labelKeys.left))})})]);
  });
});

describe('the plain words of a warning', () => {
  // The catalog isolates what it inserts in the middle of a sentence (U+2066 to U+2069): they are not read here.
  const plain = (text: string | undefined) => (text ?? '').replace(/[\u2066-\u2069]/g, '');
  const blurry: Measurements = {...good, blurVariance: 3};

  it('states the number of different views as a count, never as a bare plural ("1 different views")', () => {
    const [one] = incompleteSentences(createTranslator('en'), [{label: 'front', measurements: good}, {label: 'front', measurements: good}], 'en');
    expect(plain(one)).toBe('Different views: 1 (direct conversion needs at least 3). Missing: back and left.');
    const [few] = incompleteSentences(createTranslator('en'), [{label: 'front', measurements: good}, {label: 'left', measurements: good}, {label: 'left', measurements: good}], 'en');
    expect(plain(few)).toBe('Different views: 2 (direct conversion needs at least 3). Missing: back.');
    for (const sentence of [one, few]) expect(sentence).not.toMatch(/\d+ different/i);
  });

  it('names a detail picture without nesting parentheses ("Picture 3, detail close-up")', () => {
    const en = incompleteSentences(createTranslator('en'), [{label: 'front', measurements: good}, {label: 'left', measurements: good}, {label: 'detail', measurements: blurry}], 'en');
    expect(plain(en.at(-1))).toMatch(/^Picture 3, detail close-up: /);
    expect(plain(en.at(-1))).not.toContain('(');
    const he = incompleteSentences(createTranslator('he'), [{label: 'front', measurements: good}, {label: 'left', measurements: good}, {label: 'detail', measurements: blurry}], 'he');
    expect(plain(he.at(-1))).not.toContain('(');
    expect(plain(he.at(-1))).toContain(translate('he', labelKeys.detail));
    // The same name in a label list (the choices of a picture) keeps its capital and has no parentheses either.
    expect(translate('en', labelKeys.detail)).toBe('Detail close-up');
  });
});

describe('the form the action reads', () => {
  it('has, for each picture in order, its upload, label and three measurements as text, with no exponent', () => {
    const fields = reviewFields([measured(1, 'front', {shortEdgePx: 1200, blurVariance: 0.001, clippedFraction: 0.0001}), measured(2, 'detail', {shortEdgePx: 800, blurVariance: 1040400, clippedFraction: 1})]);
    expect(fields).toEqual([
      {uploadId: upload(1), label: 'front', shortEdge: '1200', blur: '0.001', clipped: '0.0001'},
      {uploadId: upload(2), label: 'detail', shortEdge: '800', blur: '1040400', clipped: '1'},
    ]);
    for (const field of fields) for (const value of [field.shortEdge, field.blur, field.clipped]) expect(value).not.toMatch(/e/i);
  });

  it('has nothing when a picture lacks a label or measurements: such a review is not sent', () => {
    expect(reviewFields([measured(1, 'front'), measured(2, null)])).toEqual([]);
  });

  it('reads the measurements back in range, and only in range', () => {
    expect(measurementsFromFields({shortEdge: '1200', blur: '412.375', clipped: '0.0213'})).toEqual(good);
    expect(measurementsFromFields({shortEdge: '1', blur: '0', clipped: '0'})).toEqual({shortEdgePx: 1, blurVariance: 0, clippedFraction: 0});
    expect(measurementsFromFields({shortEdge: '999999999', blur: '1040400', clipped: '1'})).toEqual({shortEdgePx: 999999999, blurVariance: 1040400, clippedFraction: 1});
    for (const bad of [
      {shortEdge: '0', blur: '1', clipped: '0'},
      {shortEdge: '01200', blur: '1', clipped: '0'},
      {shortEdge: '1200.0', blur: '1', clipped: '0'},
      {shortEdge: '1000000000', blur: '1', clipped: '0'},
      {shortEdge: '1200', blur: '1040400.001', clipped: '0'},
      {shortEdge: '1200', blur: '1.2345', clipped: '0'},
      {shortEdge: '1200', blur: '-1', clipped: '0'},
      {shortEdge: '1200', blur: '1e2', clipped: '0'},
      {shortEdge: '1200', blur: '1', clipped: '1.0001'},
      {shortEdge: '1200', blur: '1', clipped: '0.12345'},
      {shortEdge: '1200', blur: '1', clipped: '2'},
      {shortEdge: 1200, blur: '1', clipped: '0'},
      {shortEdge: null, blur: '1', clipped: '0'},
      {shortEdge: '1200', blur: undefined, clipped: '0'},
    ]) {
      expect(measurementsFromFields(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('what Confirm answers', () => {
  const states: [ReviewState, string | null][] = [
    [{outcome: 'idle'}, null],
    [{outcome: 'invalid', problems: [{field: 'scope', problem: 'empty'}]}, null],
    [{outcome: 'invalid', problems: []}, 'review.confirm.invalid'],
    [{outcome: 'stale'}, 'review.confirm.stale'],
    [{outcome: 'unknown_upload', position: 2}, 'review.confirm.unknownUpload'],
    [{outcome: 'not_ready', position: 2}, 'review.confirm.notReady'],
    [{outcome: 'expired_upload', position: 2}, 'review.confirm.expiredUpload'],
    [{outcome: 'obstruction_not_confirmed'}, 'review.confirm.obstruction'],
    [{outcome: 'acknowledgment_required'}, 'review.confirm.acknowledgment'],
    [{outcome: 'reused'}, 'review.confirm.reused'],
    [{outcome: 'gone'}, 'review.confirm.gone'],
    [{outcome: 'not_editable'}, 'review.confirm.notEditable'],
    [{outcome: 'unavailable', unknown: false}, 'review.confirm.unavailable'],
    [{outcome: 'unavailable', unknown: true}, 'review.confirm.unknown'],
    // Story 2.12: the pictures could not be kept.
    [{outcome: 'not_retained', position: 2}, 'review.confirm.notRetained'],
    [{outcome: 'bytes_changed', position: 2}, 'review.confirm.bytesChanged'],
    [{outcome: 'strip_failed', position: 2}, 'review.confirm.stripFailed'],
    [{outcome: 'lease_expired', position: 2}, 'review.confirm.leaseExpired'],
    [{outcome: 'not_complete', position: 2}, 'review.confirm.notComplete'],
    [{outcome: 'manifest_conflict', position: 2}, 'review.confirm.manifestConflict'],
    [{outcome: 'quota_exceeded', kept: 5, asked: 6}, 'review.confirm.quota'],
    [{outcome: 'quota_exceeded', kept: null, asked: null}, 'review.confirm.quotaFull'],
    [{outcome: 'retain_unavailable', position: 2}, 'review.confirm.retainUnavailablePicture'],
    [{outcome: 'retain_unavailable', position: null}, 'review.confirm.retainUnavailable'],
  ];

  it.each(states)('has a message of its own for %j', (state, key) => {
    expect(reviewKey(state)).toBe(key);
    if (key) for (const locale of ['en', 'he'] as const) expect(translate(locale, key as never, {position: 2})).not.toBe(key);
  });

  it('gives each refusal a different message', () => {
    const keys = states.map(([, key]) => key).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('forgets the command ID only when the database says it cannot be used again', () => {
    for (const [state] of states) {
      expect(settleReview(state).forgetCommand, state.outcome).toBe(state.outcome === 'reused' || state.outcome === 'gone');
      expect(settleReview(state).failed, state.outcome).toBe(state.outcome !== 'idle');
    }
  });

  it('reads a call that did not answer as "possibly recorded"', async () => {
    const failing = async () => {
      throw new Error('network');
    };
    expect(await attemptReview(failing, reviewIdle, new FormData())).toEqual({outcome: 'unavailable', unknown: true});
    expect(await attemptReview(async () => ({outcome: 'stale'}), reviewIdle, new FormData())).toEqual({outcome: 'stale'});
  });
});

describe('keeping the pictures before the review is recorded (Story 2.12)', () => {
  it('forgets no command ID for a refusal to keep: the same Confirm, sent again, carries the same command (nothing was recorded)', () => {
    for (const outcome of ['bytes_changed', 'strip_failed', 'lease_expired', 'not_complete', 'manifest_conflict'] as const) {
      expect(settleReview({outcome, position: 1})).toEqual({forgetCommand: false, failed: true});
    }
    expect(settleReview({outcome: 'quota_exceeded', kept: null, asked: null})).toEqual({forgetCommand: false, failed: true});
    expect(settleReview({outcome: 'retain_unavailable', position: null})).toEqual({forgetCommand: false, failed: true});
    expect(settleReview({outcome: 'not_retained', position: 3})).toEqual({forgetCommand: false, failed: true});
  });

  it('names the picture a refusal is about, and the sizes of the quota\'s, in the message\'s parameters', () => {
    expect(reviewParams({outcome: 'bytes_changed', position: 3})).toEqual({position: 3});
    expect(reviewParams({outcome: 'retain_unavailable', position: 2})).toEqual({position: 2});
    expect(reviewParams({outcome: 'not_retained', position: 1})).toEqual({position: 1});
    // The limit is a parameter, so no language has to spell it; the sizes are written as the picture screen writes them.
    expect(reviewParams({outcome: 'quota_exceeded', kept: 2_137_000_000, asked: 12_582_912})).toEqual({limit: '2 GiB', kept: '2038 MiB', asked: '12 MiB'});
    expect(reviewParams({outcome: 'quota_exceeded', kept: null, asked: null})).toEqual({limit: '2 GiB'});
    expect(reviewParams({outcome: 'quota_exceeded', kept: 5, asked: null})).toEqual({limit: '2 GiB'});
    // An answer about no picture still gives a position, so a message that names one never prints its own placeholder.
    expect(reviewParams({outcome: 'retain_unavailable', position: null})).toEqual({position: 0});
    expect(reviewParams({outcome: 'stale'})).toEqual({position: 0});
  });

  it('has every message in both languages with the placeholders its parameters fill', () => {
    const states: ReviewState[] = [
      {outcome: 'bytes_changed', position: 2},
      {outcome: 'strip_failed', position: 2},
      {outcome: 'lease_expired', position: 2},
      {outcome: 'not_complete', position: 2},
      {outcome: 'manifest_conflict', position: 2},
      {outcome: 'not_retained', position: 2},
      {outcome: 'retain_unavailable', position: 2},
      {outcome: 'retain_unavailable', position: null},
      {outcome: 'quota_exceeded', kept: 2_137_000_000, asked: 12_582_912},
      {outcome: 'quota_exceeded', kept: null, asked: null},
    ];
    for (const state of states) {
      const key = reviewKey(state)!;
      for (const locale of ['en', 'he'] as const) {
        const words = translate(locale, key, reviewParams(state));
        expect(words, `${locale} ${key}`).not.toMatch(/\{\w+\}/);
        expect(words.length, key).toBeGreaterThan(20);
      }
    }
    // Each says nothing was confirmed or recorded, and what to do (English).
    for (const state of states) expect(translate('en', reviewKey(state)!, reviewParams(state)), reviewKey(state)!).toMatch(/nothing was (?:confirmed|recorded)|Nothing was confirmed/);
  });

  it('turns an answer of the retain action that is not "kept" into the Confirm\'s own state, so one rule shows, announces and focuses every refusal', () => {
    expect(reviewOfRetain({outcome: 'invalid'})).toEqual({outcome: 'invalid', problems: []});
    expect(reviewOfRetain({outcome: 'idle'})).toEqual({outcome: 'retain_unavailable', position: null});
    for (const state of [
      {outcome: 'stale'},
      {outcome: 'gone'},
      {outcome: 'not_editable'},
      {outcome: 'unknown_upload', position: 2},
      {outcome: 'not_ready', position: 2},
      {outcome: 'expired_upload', position: 2},
      {outcome: 'bytes_changed', position: 2},
      {outcome: 'quota_exceeded', kept: 1, asked: 2},
      {outcome: 'retain_unavailable', position: null},
    ] as Exclude<RetainState, {outcome: 'retained'}>[]) {
      expect(reviewOfRetain(state)).toEqual(state);
      expect(reviewKey(reviewOfRetain(state))).not.toBeNull();
    }
  });

  it('reads a retain call that did not answer as "the private store did not answer": nothing was confirmed, and trying again is safe', async () => {
    const failing = async () => {
      throw new Error('network');
    };
    expect(await attemptRetain(failing, retainIdle, new FormData())).toEqual({outcome: 'retain_unavailable', position: null});
    expect(await attemptRetain(async () => ({outcome: 'retained', count: 3}), retainIdle, new FormData())).toEqual({outcome: 'retained', count: 3});
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {digest: 'NEXT_REDIRECT;replace;/;307;'});
    await expect(attemptRetain(async () => Promise.reject(redirect), retainIdle, new FormData())).rejects.toBe(redirect);
  });

  it('makes the retain form from the Confirm form: the Project, the revision and the uploads in order, and nothing of the review', () => {
    const confirm = new FormData();
    for (const [name, value] of [
      ['commandId', 'c'], ['projectId', 'p'], ['expectedSeq', '2'], ['mode', 'image_direct'], ['scope', 'S'], ['outcome', 'O'], ['obstruction', 'on'], ['acknowledge', 'on'],
      ['uploadId', 'u1'], ['label', 'front'], ['shortEdge', '900'], ['blur', '120'], ['clipped', '0'],
      ['uploadId', 'u2'], ['label', 'left'], ['shortEdge', '901'], ['blur', '121'], ['clipped', '0.1'],
    ]) confirm.append(name, value);
    const form = retainForm(confirm);
    expect([...form.entries()]).toEqual([['projectId', 'p'], ['expectedSeq', '2'], ['uploadId', 'u1'], ['uploadId', 'u2']]);
    expect([...retainForm(new FormData()).entries()]).toEqual([]);
  });

  describe('confirmReview: keep the pictures first, and record the review only when every one is kept', () => {
    const confirmForm = (count = 3) => {
      const form = new FormData();
      form.append('commandId', 'c');
      form.append('projectId', 'p');
      form.append('expectedSeq', '2');
      form.append('mode', 'evidence_images');
      for (let index = 0; index < count; index += 1) form.append('uploadId', `u${index + 1}`);
      return form;
    };
    const recorded: ReviewState = {outcome: 'stale'};
    function steps(retained: unknown) {
      const log: string[] = [];
      const retain = vi.fn(async (_previous: RetainState, form: FormData) => {
        log.push(`retain:${[...form.getAll('uploadId')].join(',')}`);
        if (retained instanceof Error) throw retained;
        return retained as RetainState;
      });
      const record = vi.fn(async (_previous: ReviewState, form: FormData) => {
        log.push(`record:${form.get('commandId')}`);
        return recorded;
      });
      const phases: string[] = [];
      return {retain, record, log, phases, deps: {retain, record, phase: (phase: string) => phases.push(phase)}};
    }

    it('keeps first with the Project, the revision and the uploads in order, then records the review with the whole form, when the answer is that all three are kept', async () => {
      const world = steps({outcome: 'retained', count: 3});
      const form = confirmForm();
      expect(await confirmReview(world.deps, reviewIdle, form)).toBe(recorded);
      expect(world.log).toEqual(['retain:u1,u2,u3', 'record:c']);
      expect(world.record).toHaveBeenCalledWith(reviewIdle, form);
      expect(world.phases).toEqual(['retaining', 'recording']);
      // The retain action is handed only what it reads.
      expect([...(world.retain.mock.calls[0][1] as FormData).keys()].sort()).toEqual(['expectedSeq', 'projectId', 'uploadId', 'uploadId', 'uploadId']);
    });

    it.each([
      [{outcome: 'bytes_changed', position: 2}],
      [{outcome: 'strip_failed', position: 1}],
      [{outcome: 'lease_expired', position: 3}],
      [{outcome: 'not_complete', position: 3}],
      [{outcome: 'manifest_conflict', position: 2}],
      [{outcome: 'unknown_upload', position: 2}],
      [{outcome: 'quota_exceeded', kept: 5, asked: 6}],
      [{outcome: 'retain_unavailable', position: 2}],
      [{outcome: 'stale'}],
      [{outcome: 'gone'}],
      [{outcome: 'not_editable'}],
    ])('records NOTHING when the answer is %j: it is Confirm\'s own answer, and the screen stays where it is', async (answer) => {
      const world = steps(answer);
      expect(await confirmReview(world.deps, reviewIdle, confirmForm())).toEqual(answer);
      expect(world.record).not.toHaveBeenCalled();
      expect(world.phases).toEqual(['retaining']);
    });

    it('is a form the screen did not make when the answer is invalid: nothing to point at, nothing recorded', async () => {
      const world = steps({outcome: 'invalid'});
      expect(await confirmReview(world.deps, reviewIdle, confirmForm())).toEqual({outcome: 'invalid', problems: []});
      expect(world.record).not.toHaveBeenCalled();
    });

    it.each([
      ['fewer pictures kept than the form has', {outcome: 'retained', count: 2}],
      ['more pictures kept than the form has', {outcome: 'retained', count: 4}],
      ['no answer at all (a call that redirected)', undefined],
      ['an answer that is not one', 'kept'],
      ['an answer with no outcome', {count: 3}],
    ])('records nothing for %s: only "every picture is kept" opens the record call', async (_name, answer) => {
      const world = steps(answer);
      expect(await confirmReview(world.deps, reviewIdle, confirmForm())).toEqual({outcome: 'retain_unavailable', position: null});
      expect(world.record).not.toHaveBeenCalled();
    });

    it('reads a retain call that did not answer as the private store not answering, and records nothing: nothing was confirmed', async () => {
      const world = steps(new Error('network'));
      expect(await confirmReview(world.deps, reviewIdle, confirmForm())).toEqual({outcome: 'retain_unavailable', position: null});
      expect(world.record).not.toHaveBeenCalled();
    });

    it('reads a record call that did not answer as possibly recorded, as before: the pictures are kept, and the review may have been recorded', async () => {
      const world = steps({outcome: 'retained', count: 3});
      world.record.mockRejectedValue(new Error('network'));
      expect(await confirmReview(world.deps, reviewIdle, confirmForm())).toEqual({outcome: 'unavailable', unknown: true});
    });

    it('lets a redirect through, from either call, for Next.js to follow', async () => {
      const redirect = Object.assign(new Error('NEXT_REDIRECT'), {digest: 'NEXT_REDIRECT;replace;/;307;'});
      await expect(confirmReview(steps(redirect).deps, reviewIdle, confirmForm())).rejects.toBe(redirect);
      const world = steps({outcome: 'retained', count: 3});
      world.record.mockRejectedValue(redirect);
      await expect(confirmReview(world.deps, reviewIdle, confirmForm())).rejects.toBe(redirect);
    });

    it('is the same Confirm again after a refusal: the form, and so the command ID, is the one given, and a second run keeps and records exactly as the first', async () => {
      const world = steps({outcome: 'retained', count: 3});
      const form = confirmForm();
      await confirmReview(world.deps, reviewIdle, form);
      await confirmReview(world.deps, reviewIdle, form);
      expect(world.log).toEqual(['retain:u1,u2,u3', 'record:c', 'retain:u1,u2,u3', 'record:c']);
    });

    it('works without a phase listener', async () => {
      const world = steps({outcome: 'retained', count: 3});
      expect(await confirmReview({retain: world.retain, record: world.record}, reviewIdle, confirmForm())).toBe(recorded);
    });
  });

  it('says "Keeping your pictures privately…" with the count while the pictures are being kept, then that the review is being saved, and nothing when no Confirm is running', () => {
    expect(confirmStatusKey(false, 'idle')).toBeNull();
    expect(confirmStatusKey(false, 'retaining')).toBeNull();
    expect(confirmStatusKey(true, 'retaining')).toBe('review.confirm.retaining');
    expect(confirmStatusKey(true, 'recording')).toBe('review.confirm.pending');
    expect(confirmStatusKey(true, 'idle')).toBe('review.confirm.pending');
    expect(translate('en', 'review.confirm.retaining', {count: 3})).toBe('Keeping your pictures privately… (3 pictures)');
    expect(translate('en', 'review.confirm.retaining', {count: 1})).toBe('Keeping your pictures privately… (1 picture)');
    for (const count of [1, 2, 3, 12]) expect(translate('he', 'review.confirm.retaining', {count}), String(count)).toContain(String(count));
    expect(translate('he', 'review.confirm.retaining', {count: 2})).not.toBe(translate('he', 'review.confirm.retaining', {count: 3}) as string);
  });

  it('keeps the facts of a retained copy beside a picture the revision pins, and none for one that is only in staging', () => {
    const kept = {sha256: sha('k'), length: 400001};
    const [pinned, staged, plain] = reviewItems([image(1, {retained: kept}), image(2, {retained: null}), image(3)]);
    expect(pinned.retained).toEqual(kept);
    expect(staged.retained).toBeNull();
    expect(plain.retained).toBeNull();
    // The staged digest and length stay the saved picture's own.
    expect(pinned).toMatchObject({sha256: sha('a'), length: 482113});
    expect(anyUnkept([pinned, staged, plain])).toBe(true);
    expect(anyUnkept([pinned])).toBe(false);
    expect(anyUnkept([])).toBe(false);
    // A pinned picture is available whatever its staged copy is: the review decides that by `available`, which the database makes true for it.
    expect(reviewItems([image(1, {available: true, retained: kept})])[0].state).toBe('measuring');
  });
});
