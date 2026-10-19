// Story 2.3. What the review screen (components/projects/picture-review.tsx: C-04, C-05 and the picture variant of C-06) works out about the pictures it shows, with
// nothing that reaches the server or the browser: each picture as the screen holds it (its label and what was measured, or why it could not be), what stops
// the person from going on, which views are missing and which pictures have problems (the facts the Generate anyway warning and the Project page put into words),
// and the fields the Server Action reads. PURE and CLIENT-SAFE: `import type` and the pure quality module only.
//
// Nothing here decides whether an acknowledgment is needed for the record: the browser's claim is measured and shown, and the DATABASE decides again from the
// labels and measurements it is sent (projects.picture_review_incomplete). The same rule (lib/picture-quality.ts `incomplete`) is used here only to show the
// warning.
import type {Locale, MessageKey, Translator} from './i18n/index.ts';
import type {FetchProblem} from './picture-fetch.ts';
import {assess, coverage, incomplete, type Coverage, type Measurements, type QualityProblem, type ViewLabel} from './picture-quality.ts';
import type {PictureType} from './picture-set.ts';

/**
 * Why a picture could not be measured: it could not be read back (`FetchProblem`), the browser could not decode it (`undecodable`), its header states more than 100
 * megapixels so no decoder was asked (`too_large_pixels`), or the decode took more than 30 seconds (`busy`).
 */
export type UnusableReason = FetchProblem | 'undecodable' | 'too_large_pixels' | 'busy';

/**
 * Whether trying again can help: for a download that did not answer (`unavailable`, `network`: a request that took more than 30 seconds is `network`) and for a decode
 * that did not finish (`busy`). A copy that lapsed or changed, a refusal, a picture that cannot be decoded and one that is too large need the picture screen.
 */
export function reasonRetryable(reason: UnusableReason): boolean {
  return reason === 'unavailable' || reason === 'network' || reason === 'busy';
}

/**
 * What fixes a picture that cannot be used: `replace` (another copy of it on the picture screen: its private copy lapsed, changed or was refused), `smaller` (a smaller
 * picture there: the browser could not open this one, or it is too large to) or null (nothing on the picture screen: trying again, or reloading the page, is the
 * remedy). A CONFIRMED request has the picture screen locked, so for it a picture with a remedy cannot be fixed here yet.
 */
export type UnusableRemedy = 'replace' | 'smaller' | null;

export function unusableRemedy(reason: UnusableReason): UnusableRemedy {
  if (reason === 'lapsed' || reason === 'changed' || reason === 'refused') return 'replace';
  if (reason === 'undecodable' || reason === 'too_large_pixels') return 'smaller';
  return null;
}

/**
 * A picture as the review holds it: from the saved revision (the upload, its staged SHA-256, length and type), the label the person has chosen (null until they do),
 * and what was found when it was measured: `measuring` (waiting its turn or being read and decoded), `measured` (it has measurements) or `unusable` (it has a
 * `reason`: it counts as a problem that cannot be acknowledged). `thumbnailUrl` is a local object URL of a small JPEG the screen made and revokes.
 */
export type ReviewItem = {
  key: string;
  position: number;
  uploadId: string;
  sha256: string;
  length: number;
  contentType: PictureType;
  label: ViewLabel | null;
  state: 'measuring' | 'measured' | 'unusable';
  measurements: Measurements | null;
  reason: UnusableReason | null;
  thumbnailUrl: string | null;
  /**
   * The SHA-256 and length of the picture's RETAINED copy when the revision pins it (Story 2.12), otherwise null. A pinned picture is read from its retained copy and
   * never from staging, and its staged copy lapsing is of no consequence; an unpinned one is only in private staging.
   */
  retained: {sha256: string; length: number} | null;
};

/** What a saved picture offers the review: where it is and what it is, and the label it was given if the set was reviewed before. */
export type ReviewableImage = {
  position: number;
  uploadId: string;
  sha256: string;
  length: number;
  contentType: PictureType;
  available: boolean;
  label: ViewLabel | null;
  /** The facts of the picture's retained copy when the revision pins it (Story 2.12); absent or null otherwise. */
  retained?: {sha256: string; length: number} | null;
};

/** The review's pictures from a saved revision's, in their order. A picture whose private copy has lapsed is unusable from the start (`lapsed`); the others wait to be measured. */
export function reviewItems(images: readonly ReviewableImage[]): ReviewItem[] {
  return [...images]
    .sort((a, b) => a.position - b.position)
    .map((image) => ({
      key: `review-${image.position}`,
      position: image.position,
      uploadId: image.uploadId,
      sha256: image.sha256,
      length: image.length,
      contentType: image.contentType,
      label: image.label,
      state: image.available ? ('measuring' as const) : ('unusable' as const),
      measurements: null,
      reason: image.available ? null : ('lapsed' as const),
      thumbnailUrl: null,
      retained: image.retained ?? null,
    }));
}

/** Whether any picture is only in private staging (not pinned as a retained picture): the staged copies' 24-hour lapse is still true of those. */
export const anyUnkept = (items: readonly ReviewItem[]): boolean => items.some((item) => item.retained === null);

/** Changes some fields of one item. The list is returned as it was when the key names none. */
export function updateReviewItem(items: readonly ReviewItem[], key: string, patch: Partial<Omit<ReviewItem, 'key' | 'position'>>): ReviewItem[] {
  return items.map((item) => (item.key === key ? {...item, ...patch} : item));
}

// What the pictures show ---------------------------------------------------------------------------------------------------

/** The labels the person has chosen so far, in order (null where none). */
export const labelsOf = (items: readonly ReviewItem[]): (ViewLabel | null)[] => items.map((item) => item.label);

/** Which views the labelled pictures show and which are missing. */
export const coverageOf = (items: readonly ReviewItem[]): Coverage => coverage(labelsOf(items));

/** The problems of one picture, by name: none while it is not measured (an unusable picture has its `reason` instead). */
export function problemsOf(item: ReviewItem): QualityProblem[] {
  return item.measurements ? assess(item.measurements).problems : [];
}

/**
 * What stops the person from leaving the first step, in the order they are told: `busy` (a picture is still being measured), `unusable` (a picture cannot be used:
 * it has no measurements to record, and it cannot be acknowledged), `labels` (a picture has no label), `obstruction` (the person has not confirmed that nothing
 * blocks the subject). Null when they can go on. There is no override for any of them.
 */
export type FirstStepIssue = 'busy' | 'unusable' | 'labels' | 'obstruction';

export function firstStepIssue(items: readonly ReviewItem[], obstructionConfirmed: boolean): FirstStepIssue | null {
  if (items.some((item) => item.state === 'measuring')) return 'busy';
  if (items.some((item) => item.state === 'unusable')) return 'unusable';
  if (items.some((item) => item.label === null)) return 'labels';
  if (!obstructionConfirmed) return 'obstruction';
  return null;
}

/**
 * The facts a Generate anyway acknowledgment covers, as one text (the views the pictures show and each picture's problems): the acknowledgment given for one text is
 * void for any other, so it is cleared whenever a label, a measurement or the path changes what the warning says.
 */
export const incompleteKey = (items: readonly ReviewItem[]): string => JSON.stringify(incompleteFacts(items));

/** The pictures of a review that have everything the record needs (measured and labelled), as the call takes them; null when any picture lacks something. */
export function reviewedImagesOf(items: readonly ReviewItem[]): {uploadId: string; label: ViewLabel; measurements: Measurements}[] | null {
  const images: {uploadId: string; label: ViewLabel; measurements: Measurements}[] = [];
  for (const item of items) {
    if (item.state !== 'measured' || !item.measurements || item.label === null) return null;
    images.push({uploadId: item.uploadId, label: item.label, measurements: item.measurements});
  }
  return images;
}

/** Whether direct conversion would have too little to go on, by the pure rule. False until every picture is labelled and measured. */
export function itemsIncomplete(items: readonly ReviewItem[]): boolean {
  const reviewed = reviewedImagesOf(items);
  if (!reviewed) return false;
  return incomplete(reviewed.map((image) => image.label), reviewed.map((image) => image.measurements));
}

/**
 * The facts a Generate anyway warning (and the Project page, for a recorded acknowledgment) puts into words: how many different views the pictures show, which views to
 * add, and for each picture with a problem its place, its label and the problems by name. `pictures` are in order; a picture that is not measured has none.
 */
export type IncompleteFacts = {
  views: number;
  needed: number;
  missing: ViewLabel[];
  pictures: {position: number; label: ViewLabel | null; problems: QualityProblem[]}[];
};

export function incompleteFacts(pictures: readonly {label: ViewLabel | null; measurements: Measurements | null}[]): IncompleteFacts {
  const seen = coverage(pictures.map((picture) => picture.label));
  return {
    views: seen.count,
    needed: seen.needed,
    missing: seen.missing,
    pictures: pictures
      .map((picture, index) => ({position: index + 1, label: picture.label, problems: picture.measurements ? assess(picture.measurements).problems : []}))
      .filter((picture) => picture.problems.length > 0),
  };
}

// The form the Server Action reads ----------------------------------------------------------------------------------------------

/**
 * One picture of the form, as text: the fields the action reads (`uploadId`, `label`, `shortEdge`, `blur`, `clipped`), repeated once for each picture in order. Numbers
 * keep the digits they were kept with (an integer, at most 3 decimals, at most 4), never an exponent.
 */
export type ReviewFields = {uploadId: string; label: ViewLabel; shortEdge: string; blur: string; clipped: string};

export function reviewFields(items: readonly ReviewItem[]): ReviewFields[] {
  const reviewed = reviewedImagesOf(items);
  if (!reviewed) return [];
  return reviewed.map((image) => ({
    uploadId: image.uploadId,
    label: image.label,
    shortEdge: String(image.measurements.shortEdgePx),
    blur: String(image.measurements.blurVariance),
    clipped: String(image.measurements.clippedFraction),
  }));
}

/**
 * Reads the measurements of one picture from the text of a form, or null when they are not what the screen sends: a whole short edge from 1, a blur from 0 to 1,040,400
 * with at most 3 decimals, a clipped share from 0 to 1 with at most 4. (The database reads the same ranges again; none of these is a pass or a fail.)
 */
export function measurementsFromFields(fields: {shortEdge: unknown; blur: unknown; clipped: unknown}): Measurements | null {
  const { shortEdge, blur, clipped } = fields;
  if (typeof shortEdge !== 'string' || typeof blur !== 'string' || typeof clipped !== 'string') return null;
  if (!/^[1-9][0-9]{0,8}$/.test(shortEdge) || !/^[0-9]{1,7}(\.[0-9]{1,3})?$/.test(blur) || !/^[01](\.[0-9]{1,4})?$/.test(clipped)) return null;
  const variance = Number(blur);
  const share = Number(clipped);
  if (variance > 1040400 || share > 1) return null;
  return {shortEdgePx: Number(shortEdge), blurVariance: variance, clippedFraction: share};
}

// In words ------------------------------------------------------------------------------------------------------------------

/** The name of each label, in the person's language. */
export const labelKeys = {
  front: 'review.label.front',
  back: 'review.label.back',
  left: 'review.label.left',
  right: 'review.label.right',
  top: 'review.label.top',
  bottom: 'review.label.bottom',
  detail: 'review.label.detail',
} as const satisfies Record<ViewLabel, MessageKey>;

/** The name of each problem a picture can have, as a badge says it ("Too small"), and as a list of problems does (in lower case, in the UI's own language). */
export const badgeKeys = {resolution: 'review.badge.resolution', blur: 'review.badge.blur', exposure: 'review.badge.exposure'} as const satisfies Record<QualityProblem, MessageKey>;

/** Views, problems or any list of names, joined in the person's language (the catalog says where its `and` goes). */
export function listOf(t: Translator, names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return t('review.list.two', {first: names[0], second: names[1]});
  return t('review.list.many', {list: names.slice(0, -1).join(t('review.list.comma')), last: names[names.length - 1]});
}

/** A name in the middle of a sentence: in lower case by the rules of the UI's language (never the machine's), which Hebrew has none of. */
const inSentence = (text: string, locale: Locale) => text.toLocaleLowerCase(locale);

/** A picture's problems, by name, in words, in the UI's language. */
export function problemWords(t: Translator, problems: readonly QualityProblem[], locale: Locale): string {
  return listOf(t, problems.map((problem) => inSentence(t(badgeKeys[problem]), locale)));
}

/**
 * What a Generate anyway warning (and the recorded acknowledgment on the Project page) says is wrong with the inputs, one sentence each: the different views there are and
 * the ones missing, and each picture's problems. Worked out from the labels and measurements alone, so the sentences for a recorded acknowledgment are the ones the
 * person saw. `locale` is the UI's: names are put in lower case by its rules.
 */
export function incompleteSentences(t: Translator, pictures: readonly {label: ViewLabel | null; measurements: Measurements | null}[], locale: Locale): string[] {
  const facts = incompleteFacts(pictures);
  const sentences: string[] = [];
  if (facts.views < facts.needed) {
    sentences.push(
      facts.missing.length
        ? t('review.ack.missing', {count: facts.views, needed: facts.needed, views: listOf(t, facts.missing.map((label) => inSentence(t(labelKeys[label]), locale)))})
        : t('review.ack.fewViews', {count: facts.views, needed: facts.needed}),
    );
  }
  for (const picture of facts.pictures) {
    sentences.push(
      t('review.ack.picture', {position: picture.position, view: picture.label ? inSentence(t(labelKeys[picture.label]), locale) : '', problems: problemWords(t, picture.problems, locale)}),
    );
  }
  return sentences;
}
