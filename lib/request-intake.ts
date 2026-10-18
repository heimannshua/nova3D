// Story 2.1. Understanding a described request: what a description is matched against, what personalization wording means, and the
// limits every field has. It is deterministic and free: no model, no fuzzy match, no network and no database. The same description
// gives the same answer on the server and in the browser, so the server recomputes the understanding from the submitted fields at
// Confirm and trusts nothing the client says it understood.
//
// PURE and CLIENT-SAFE: no `process`, no I/O, and `import type` only (the registry is a parameter, never imported here).
//
// Matching. The description and each subject alias are normalized (`normalizeText`: Unicode NFKC, the Hebrew points removed, lower
// case, white space collapsed) and a subject matches when the description contains one of its aliases as a WHOLE WORD: the character
// before and the character after are not a letter, a digit or a mark. JavaScript's `\b` is ASCII-only, so the test is spelled with
// Unicode properties. Hebrew is written with its articles and prepositions attached to the noun, so an alias that starts with a
// Hebrew letter also matches after one or two of the prefix letters ו ב כ ל מ ש ה, when those themselves follow a non-letter:
// `המזבח`, `במזבח` and `לכבש` match; `altarpiece`, `ramps` and `kevesher` do not. The person's own words are never altered: only the
// comparison uses the normalized form.
//
// Text that draws nothing. A description, scope, outcome, wording or quoted text that is empty once the characters that draw nothing are
// removed (control, format and separator characters, and four fill characters) counts as empty, and a bidirectional override, embedding or
// isolate control (U+202A to U+202E, U+2066 to U+2069) is refused in all of them. The database makes the same two checks
// (`projects.is_invisible`, `projects.has_bidi_control`). U+200C and U+200D are NOT refused: Hebrew, Persian and emoji text need them.
//
// Personalization. Free wording maps to the one supported kind, raised or recessed text. A wish that cannot be applied is explained
// in plain words, may still be confirmed, and is recorded as not applied with its reason.
import type {DomainRegistry, RegisteredSubject} from './domain-registry.ts';

// Limits ------------------------------------------------------------------------------------------------------------------------

/** A description is 1 to 2,000 characters after trimming. */
export const maxDescriptionLength = 2000;
/** Scope and outcome are free text of 1 to 300 characters after trimming. */
export const maxScopeLength = 300;
export const maxOutcomeLength = 300;
/** The personalization wording is at most 300 characters. */
export const maxWordingLength = 300;
/**
 * The longest text a personalization may carry. It is the first surface's limit (Story 4.2) and moves into the surface declaration
 * there; until then it is one number, here.
 */
export const maxPersonalizationText = 24;

/** The modes a request revision can have. Only `evidence_text` is chosen by a person in this story. */
export const requestModes = ['evidence_text', 'evidence_images', 'image_direct'] as const;
export type RequestMode = (typeof requestModes)[number];

/** The fields a person fills in, and so the fields a problem is about. `subject` is the choice among several matches. */
export type IntakeField = 'description' | 'subject' | 'personalization' | 'scope' | 'outcome';
export type FieldProblemKind = 'empty' | 'too_long' | 'control' | 'not_a_match';
export type FieldProblem = {field: IntakeField; problem: FieldProblemKind};

// Normalization -----------------------------------------------------------------------------------------------------------------

/**
 * The comparison form of a text: NFKC; then the Hebrew points U+0591 to U+05C7 removed, except U+05BE (maqaf), U+05C0 (paseq),
 * U+05C3 (sof pasuq) and U+05C6 (nun hafukha), which punctuate and so become a space; then lower case; then every run of white
 * space one space; then trimmed.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\u05be\u05c0\u05c3\u05c6]/g, ' ')
    .replace(/[\u0591-\u05c7]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Whole-word matching -----------------------------------------------------------------------------------------------------------

const wordCharacter = /^[\p{L}\p{N}\p{M}]$/u;
const letter = /^\p{L}$/u;
const hebrewLetter = /^[א-ת]$/;
/** The Hebrew prefix letters: and, in, like, to, from, that, the. */
const hebrewPrefixLetters = new Set(['ו', 'ב', 'כ', 'ל', 'מ', 'ש', 'ה']);

/** The code point that ends `text` before index `at`, or '' at the start. */
function characterBefore(text: string, at: number): string {
  if (at <= 0) return '';
  return Array.from(text.slice(Math.max(0, at - 2), at)).pop() ?? '';
}

/** The code point that starts at index `at`, or '' at the end. */
function characterAt(text: string, at: number): string {
  const point = text.codePointAt(at);
  return point === undefined ? '' : String.fromCodePoint(point);
}

const isWordCharacter = (character: string) => character !== '' && wordCharacter.test(character);
const isLetter = (character: string) => character !== '' && letter.test(character);

/**
 * Whether `alias` occurs in `text` as a whole word. Both are already normalized. An alias that starts with a Hebrew letter also
 * counts after one or two Hebrew prefix letters that themselves follow a non-letter.
 */
function containsWholeWord(text: string, alias: string): boolean {
  if (alias === '') return false;
  const hebrew = hebrewLetter.test(characterAt(alias, 0));
  for (let from = text.indexOf(alias); from !== -1; from = text.indexOf(alias, from + 1)) {
    if (isWordCharacter(characterAt(text, from + alias.length))) continue;
    if (!isWordCharacter(characterBefore(text, from))) return true;
    if (!hebrew) continue;
    // Not at the start of a word: it may still be a word with a prefix, one letter or two.
    const one = characterBefore(text, from);
    if (hebrewPrefixLetters.has(one) && !isLetter(characterBefore(text, from - 1))) return true;
    const two = characterBefore(text, from - 1);
    if (hebrewPrefixLetters.has(one) && hebrewPrefixLetters.has(two) && !isLetter(characterBefore(text, from - 2))) return true;
  }
  return false;
}

/**
 * The subjects one of whose ALIASES the description contains as a whole word, in registry order. The display name is not matched (a
 * description rarely repeats it, and it is not a word a person would write), so a subject is found by its aliases and by nothing else:
 * a generic alias can match text that is about something else (a ramp is not always the Temple's), and a plural, a transliteration
 * variant or a synonym that is not an alias is not found. The aliases are compared as the description is: normalized (`normalizeText`).
 */
export function matchSubjects(description: string, subjects: readonly RegisteredSubject[]): RegisteredSubject[] {
  const text = normalizeText(description);
  if (text === '') return [];
  return subjects.filter((subject) => subject.aliases.some((alias) => containsWholeWord(text, normalizeText(alias))));
}

// Fields ------------------------------------------------------------------------------------------------------------------------

const codePoints = (text: string) => [...text].length;
// Any control character (C0, DEL, C1).
const anyControl = /[\u0000-\u001f\u007f-\u009f]/;
// A control character but newline and tab.
const controlButLayout = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
// The characters that draw nothing: control (Cc), format (Cf, which holds the zero-width space and joiners), separators (Z) and four fill
// characters that are letters or marks in Unicode but render blank (the Braille blank, the Hangul fillers). This is the set `titleProblem`
// (lib/project-view.ts) removes from a Project's title; it is repeated here because this module imports nothing at run time.
const invisible = /[\p{Cc}\p{Cf}\p{Z}\u2800\u3164\u115f\u1160]/gu;
// A bidirectional override, embedding or isolate control: it can make text read in an order other than the one it is stored in.
const bidiControl = /[\u202a-\u202e\u2066-\u2069]/;

/** Whether a text draws nothing: empty, or only characters that draw nothing. */
export function isInvisible(text: string): boolean {
  return text.replace(invisible, '') === '';
}

/**
 * A text field as the server reads it: line ends are the form's (a textarea is submitted with CRLF) and become a newline, and the
 * surrounding white space goes. Anything that is not text is empty.
 */
export function fieldText(input: unknown): string {
  return typeof input === 'string' ? input.replace(/\r\n?/g, '\n').trim() : '';
}

/**
 * What is wrong with a text field, if anything: empty (or nothing that draws), a character that cannot be used (a control character, a
 * newline and a tab excepted when `layout` allows them, or a bidirectional control), or too long (in characters, not UTF-16 units).
 */
function textProblem(value: string, max: number, layout: boolean): FieldProblemKind | null {
  if (value === '') return 'empty';
  if ((layout ? controlButLayout : anyControl).test(value) || bidiControl.test(value)) return 'control';
  if (isInvisible(value)) return 'empty';
  return codePoints(value) > max ? 'too_long' : null;
}

/** What is wrong with a description (already read with `fieldText`), if anything. A newline and a tab are allowed in it. */
export function descriptionProblem(description: string): FieldProblemKind | null {
  return textProblem(description, maxDescriptionLength, true);
}

/** What is wrong with a scope or an outcome, if anything: 1 to 300 characters, and no control character (a newline included). */
export function lineProblem(value: string, max: number = maxScopeLength): FieldProblemKind | null {
  return textProblem(value, max, false);
}

/** What is wrong with personalization wording, if anything. Empty, or nothing that draws, is fine: there is no wish. */
export function wordingProblem(wording: string): FieldProblemKind | null {
  const problem = textProblem(wording, maxWordingLength, true);
  return problem === 'empty' ? null : problem;
}

// Understanding -----------------------------------------------------------------------------------------------------------------

/**
 * What the description means to nova3D, exactly one of:
 *  - `invalid`: named field problems (nothing was matched);
 *  - `no_match`: no registered subject; carries the registered subjects, for the explanation;
 *  - `ambiguous`: several match; carries them, in registry order, for the question;
 *  - `clear`: one subject.
 */
export type Understanding =
  | {kind: 'invalid'; problems: FieldProblem[]}
  | {kind: 'no_match'; subjects: readonly RegisteredSubject[]}
  | {kind: 'ambiguous'; matches: readonly RegisteredSubject[]}
  | {kind: 'clear'; subject: RegisteredSubject};

/**
 * Understands a described request. `description` and `wording` are already read with `fieldText`. `subjectId` is the subject the
 * person chose when asked which one (or that C-06 showed as clear); it is accepted only if it is among the matches, and a choice
 * outside them is a field problem. The registry is a parameter: this module imports nothing at run time.
 */
export function understand(input: {description: string; subjectId?: string | null; wording?: string}, registry: DomainRegistry): Understanding {
  const problems: FieldProblem[] = [];
  const description = descriptionProblem(input.description);
  if (description) problems.push({field: 'description', problem: description});
  const wording = wordingProblem(input.wording ?? '');
  if (wording) problems.push({field: 'personalization', problem: wording});
  if (problems.length) return {kind: 'invalid', problems};

  const matches = matchSubjects(input.description, registry.subjects());
  const chosen = input.subjectId ?? null;
  if (chosen !== null) {
    const subject = matches.find((match) => match.id === chosen);
    return subject ? {kind: 'clear', subject} : {kind: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]};
  }
  if (matches.length === 0) return {kind: 'no_match', subjects: registry.subjects()};
  if (matches.length > 1) return {kind: 'ambiguous', matches};
  return {kind: 'clear', subject: matches[0]};
}

// Personalization ---------------------------------------------------------------------------------------------------------------

export type PersonalizationStyle = 'raised' | 'recessed';

/** Why a wish cannot be applied. Each has a plain-words explanation in both languages (`personalization.reason.*`). */
export const declineReasons = ['no_quoted_text', 'several_texts', 'text_too_long', 'text_invalid', 'conflicting_styles', 'image_direct_has_no_surfaces'] as const;
export type DeclineReason = (typeof declineReasons)[number];

/**
 * What a wish means: nothing asked (`none`), raised or recessed text that can be applied (`applied`), or a wish that is explained and
 * recorded but not applied (`declined`). `wording` is the wish as written, trimmed.
 */
export type Personalization =
  | {kind: 'none'}
  | {kind: 'applied'; wording: string; text: string; style: PersonalizationStyle}
  | {kind: 'declined'; wording: string; reason: DeclineReason};

// The words that choose a style, each with the forms of its verb (whole words only: `engravedish` and `unraised` are neither).
const recessedWords = [
  'recess', 'recesses', 'recessed', 'recessing',
  'engrave', 'engraves', 'engraved', 'engraving',
  'carve', 'carves', 'carved', 'carving',
  'incise', 'incises', 'incised', 'incising',
  'deboss', 'debosses', 'debossed', 'debossing',
  'etch', 'etched', 'sunken',
  'חרוט', 'שקוע',
];
const raisedWords = [
  'raise', 'raises', 'raised', 'raising',
  'emboss', 'embosses', 'embossed', 'embossing',
  'relief', 'protruding', 'protrude', 'protrudes',
  'בולט', 'מוגבה',
];

// One quoted text: "…", “…” or «…». The quotes are not nested and not mixed.
const quoted = /"([^"]*)"|\u201c([^\u201d]*)\u201d|\u00ab([^\u00bb]*)\u00bb/g;
// A quotation mark of any of the three kinds, alone: one that is left over once the pairs are taken out is a text that is not closed (or
// opened), and the wording is then not clear about which text is meant.
const quotationMark = /["\u201c\u201d\u00ab\u00bb]/;

/**
 * Maps personalization wording to the one supported kind. Empty wording is `none`. In `image_direct` mode any wording is declined
 * (an image-derived model carries no declared surfaces). Otherwise the wording must contain exactly one quoted text of 1 to 24
 * characters with no control character, and the words outside the quotes choose the style: recessed words, raised words, both is a
 * conflict, neither is raised. Everything else in the wording is not used. `wording` is already read with `fieldText`.
 */
export function classifyPersonalization(wording: string, mode: RequestMode): Personalization {
  const wish = wording.trim();
  if (wish === '' || isInvisible(wish)) return {kind: 'none'};
  const declined = (reason: DeclineReason): Personalization => ({kind: 'declined', wording: wish, reason});
  if (mode === 'image_direct') return declined('image_direct_has_no_surfaces');

  const found = [...wish.matchAll(quoted)];
  // Quotes with nothing between them hold no text.
  const texts = found.filter((match) => (match[1] ?? match[2] ?? match[3] ?? '').trim() !== '');
  if (texts.length === 0) return declined('no_quoted_text');
  if (texts.length > 1) return declined('several_texts');
  // One pair, and another quotation mark without its pair (`"צה"ל"`): which text is meant is not clear, so it is not guessed.
  if (quotationMark.test(wish.replace(quoted, ' '))) return declined('several_texts');
  const text = (texts[0][1] ?? texts[0][2] ?? texts[0][3] ?? '').trim();
  if (anyControl.test(text) || bidiControl.test(text) || isInvisible(text)) return declined('text_invalid');
  if (codePoints(text) > maxPersonalizationText) return declined('text_too_long');

  const outside = normalizeText(wish.replace(quoted, ' '));
  const recessed = recessedWords.some((word) => containsWholeWord(outside, normalizeText(word)));
  const raised = raisedWords.some((word) => containsWholeWord(outside, normalizeText(word)));
  if (recessed && raised) return declined('conflicting_styles');
  return {kind: 'applied', wording: wish, text, style: recessed ? 'recessed' : 'raised'};
}

/** A wish as a revision stores it: all of it set when applied, the wording and the reason when declined, nothing when there is none. */
export type StoredPersonalization = {
  wording: string | null;
  text: string | null;
  style: PersonalizationStyle | null;
  applied: boolean;
  reason: DeclineReason | null;
};

export function storedPersonalization(personalization: Personalization): StoredPersonalization {
  switch (personalization.kind) {
    case 'none':
      return {wording: null, text: null, style: null, applied: false, reason: null};
    case 'applied':
      return {wording: personalization.wording, text: personalization.text, style: personalization.style, applied: true, reason: null};
    case 'declined':
      return {wording: personalization.wording, text: null, style: null, applied: false, reason: personalization.reason};
  }
}

// Confirmation ------------------------------------------------------------------------------------------------------------------

/** What a request revision holds, as the server works it out from the submitted fields. There is no approval, permission or payment in it. */
export type ConfirmedRequest = {
  /** The Project's title: the subject's display name. */
  title: string;
  mode: RequestMode;
  subjectId: string;
  scope: string;
  outcome: string;
  description: string;
  personalization: StoredPersonalization;
};

/** Why a request cannot be confirmed as submitted: a field is wrong (`invalid`), or the description names no subject or several (the person decides again). */
export type RequestCheck =
  | {ok: true; request: ConfirmedRequest}
  | {ok: false; kind: 'invalid'; problems: FieldProblem[]}
  | {ok: false; kind: 'no_match' | 'ambiguous'};

/**
 * Works out, from the submitted fields alone, what a confirmation would record: the understanding is recomputed (the subject must be
 * a match for the description), scope and outcome are checked, and the wish is classified for the mode. Nothing the client says it
 * understood is used. The fields are already read with `fieldText`. The title is the subject's display name.
 */
export function checkRequest(
  input: {mode: RequestMode; description: string; subjectId: string | null; scope: string; outcome: string; wording: string},
  registry: DomainRegistry,
): RequestCheck {
  const understanding = understand({description: input.description, subjectId: input.subjectId, wording: input.wording}, registry);
  const problems: FieldProblem[] = understanding.kind === 'invalid' ? [...understanding.problems] : [];
  const scope = lineProblem(input.scope, maxScopeLength);
  if (scope) problems.push({field: 'scope', problem: scope});
  const outcome = lineProblem(input.outcome, maxOutcomeLength);
  if (outcome) problems.push({field: 'outcome', problem: outcome});
  if (problems.length) return {ok: false, kind: 'invalid', problems};
  if (understanding.kind === 'no_match' || understanding.kind === 'ambiguous') return {ok: false, kind: understanding.kind};
  if (understanding.kind !== 'clear') return {ok: false, kind: 'invalid', problems: []};
  const {subject} = understanding;
  return {
    ok: true,
    request: {
      title: subject.displayName,
      mode: input.mode,
      subjectId: subject.id,
      scope: input.scope,
      outcome: input.outcome,
      description: input.description,
      personalization: storedPersonalization(classifyPersonalization(input.wording, input.mode)),
    },
  };
}
