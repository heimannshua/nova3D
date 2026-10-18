import {describe, expect, it} from 'vitest';
import {defaultDomainRegistry} from '@/lib/domain-registry';
import {titleProblem} from '@/lib/project-view';
import {
  checkRequest,
  classifyPersonalization,
  declineReasons,
  descriptionProblem,
  fieldText,
  isInvisible,
  lineProblem,
  matchSubjects,
  maxDescriptionLength,
  maxPersonalizationText,
  maxScopeLength,
  normalizeText,
  storedPersonalization,
  understand,
  wordingProblem,
} from '@/lib/request-intake';
import {createDomainRegistry} from '@/lib/domain-registry';
import type {DomainManifest} from '../../packages/contracts/domain-manifest';
import {fixtureRegistry} from '../support/fixture-domains';

// Characters that draw nothing or that reorder text, by code point (the test source holds no invisible character).
const at = (...codes: number[]) => String.fromCodePoint(...codes);
const ZWSP = at(0x200b);
const ZWNJ = at(0x200c);
const ZWJ = at(0x200d);
const BRAILLE_BLANK = at(0x2800);
const HANGUL_FILLER = at(0x3164);
const RLO = at(0x202e);
const LRI = at(0x2066);
const PDI = at(0x2069);

// Story 2.1: understanding a described request. Deterministic and free: the same words give the same answer, and nothing here reaches a
// database, a network or a model (AC-1, AC-4).
const middot = defaultDomainRegistry.subjects();
const matches = (description: string) => matchSubjects(description, middot).map((subject) => subject.id);
const ALTAR = 'middot-altar-ramp';

describe('normalizeText', () => {
  it('applies NFKC, then removes the Hebrew points, then lower-cases, then collapses white space, then trims', () => {
    expect(normalizeText('  Altar \t\n ＲＡＭＰ  ')).toBe('altar ramp');
    expect(normalizeText('ﬁne')).toBe('fine');
    expect(normalizeText('מִזְבֵּחַ')).toBe('מזבח');
    expect(normalizeText('שָׁלוֹם')).toBe('שלום');
    expect(normalizeText('')).toBe('');
    expect(normalizeText(' \n\t ')).toBe('');
  });

  it('removes every Hebrew point from U+0591 to U+05C7 except the four that punctuate, which become a space', () => {
    for (let code = 0x0591; code <= 0x05c7; code += 1) {
      const character = String.fromCharCode(code);
      const punctuation = [0x05be, 0x05c0, 0x05c3, 0x05c6].includes(code);
      expect(normalizeText(`א${character}ב`), `U+${code.toString(16)}`).toBe(punctuation ? 'א ב' : 'אב');
    }
    // Neither side of the range is touched.
    expect(normalizeText('֐א')).toBe('֐א');
    expect(normalizeText('א׈')).toBe('א׈');
  });

  it('is idempotent', () => {
    for (const text of ['Altar,', 'מִזְבֵּחַ וְהַכֶּבֶשׁ', 'ＡＬＴＡＲ  ramp', 'א־ב']) expect(normalizeText(normalizeText(text))).toBe(normalizeText(text));
  });
});

describe('matching a description against the registered subjects (AC-1)', () => {
  it.each([
    ['Build the altar and ramp', true],
    ['Altar,', true],
    ['the ALTAR.', true],
    ['(altar)', true],
    ['altar', true],
    ['a model of the mizbeach', true],
    ['the Kevesh up to it', true],
    ['המזבח', true],
    ['במזבח', true],
    ['לכבש', true],
    ['ולמזבח', true],
    ['והמזבח', true],
    ['מזבח', true],
    ['מִזְבֵּחַ', true],
    ['  כבש  ', true],
    ['מזבח־הנחושת', true],
    ['altar\nramp', true],
    ['altar-ramp', true],
    ['ＡＬＴＡＲ', true],
    ['altarpiece', false],
    ['ramps', false],
    ['kevesher', false],
    ['preramp', false],
    ['altar2', false],
    ['2altar', false],
    ['altarרמפה', false],
    ['xמזבח', false],
    ['מזבחות', false],
    ['המזבחות', false],
    ['שמזבח', true],
    ['ממזבח', true],
    ['וממזבח', true],
    ['הכבש', true],
    ['כמזבח', true],
    ['אמזבח', false],
    ['תמזבח', false],
    ['הוהמזבח', false],
    ['a lighthouse', false],
    ['', false],
    ['   ', false],
  ])('%j matches: %s', (description, expected) => {
    expect(matches(description).length > 0).toBe(expected);
  });

  it('allows one or two prefix letters only when they themselves start the word', () => {
    expect(matches('xבמזבח')).toEqual([]);
    expect(matches('1המזבח')).toEqual([ALTAR]);
    expect(matches('"המזבח"')).toEqual([ALTAR]);
    // Three prefix letters are one too many.
    expect(matches('שהלמזבח')).toEqual([]);
  });

  it('applies the Hebrew prefix rule to an alias that starts with a Hebrew letter, and to no other', () => {
    expect(matchSubjects('xaltar', middot)).toEqual([]);
    expect(matchSubjects('lramp', middot)).toEqual([]);
    expect(matchSubjects('hramp', middot)).toEqual([]);
    // The cases that can see the guard (`if (!hebrew) continue`): Hebrew prefix letters in front of a LATIN alias. Without the guard these would
    // match, because ה, ל, ו and ב are prefix letters that follow a non-letter.
    expect(matchSubjects('הaltar', middot)).toEqual([]);
    expect(matchSubjects('לramp', middot)).toEqual([]);
    expect(matchSubjects('ובkevesh', middot)).toEqual([]);
  });

  it('finds a whole word that follows a longer non-match of the same alias', () => {
    expect(matches('altarpiece and then the altar')).toEqual([ALTAR]);
    expect(matches('ramps, ramp')).toEqual([ALTAR]);
  });

  it('does not alter the description: only the comparison uses the normalized form', () => {
    const description = 'Build the ALTAR\r\nמִזְבֵּחַ';
    matches(description);
    expect(description).toBe('Build the ALTAR\r\nמִזְבֵּחַ');
  });

  it('matches every subject whose alias occurs, in registry order', () => {
    expect(matchSubjects('the altar and the incense', fixtureRegistry.subjects()).map((subject) => subject.id)).toEqual([ALTAR, 'fixture-incense-altar']);
    expect(matchSubjects('incense', fixtureRegistry.subjects()).map((subject) => subject.id)).toEqual(['fixture-incense-altar']);
    expect(matchSubjects('a ramp', fixtureRegistry.subjects()).map((subject) => subject.id)).toEqual([ALTAR]);
  });
});

describe('the description and the other fields', () => {
  it('reads a form field: a textarea\'s CRLF becomes a newline, the ends are trimmed, and anything that is not text is empty', () => {
    expect(fieldText('  one\r\ntwo\rthree\n ')).toBe('one\ntwo\nthree');
    expect(fieldText(null)).toBe('');
    expect(fieldText(undefined)).toBe('');
    expect(fieldText(new File([], 'x'))).toBe('');
    expect(fieldText(3)).toBe('');
  });

  it('accepts a description of 1 to 2,000 characters, with a newline and a tab in it', () => {
    expect(descriptionProblem('a')).toBeNull();
    expect(descriptionProblem('x'.repeat(maxDescriptionLength))).toBeNull();
    expect(descriptionProblem('line one\nline two\twith a tab')).toBeNull();
    expect(descriptionProblem('ש'.repeat(maxDescriptionLength))).toBeNull();
    // Characters, not UTF-16 units.
    expect(descriptionProblem('😀'.repeat(maxDescriptionLength))).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['x'.repeat(maxDescriptionLength + 1), 'too_long'],
    ['😀'.repeat(maxDescriptionLength + 1), 'too_long'],
    ['bell\u0007', 'control'],
    ['escape\u001b', 'control'],
    ['carriage\rreturn', 'control'],
    ['c1\u0085', 'control'],
    ['del\u007f', 'control'],
    ['null\u0000', 'control'],
  ])('refuses the description %j: %s', (description, problem) => {
    expect(descriptionProblem(description)).toBe(problem);
  });

  it('accepts a scope or outcome of 1 to 300 characters with no control character at all', () => {
    expect(lineProblem('The outer altar and ramp (Middot 3)')).toBeNull();
    expect(lineProblem('x'.repeat(maxScopeLength))).toBeNull();
    expect(lineProblem('')).toBe('empty');
    expect(lineProblem('x'.repeat(maxScopeLength + 1))).toBe('too_long');
    expect(lineProblem('a\nb')).toBe('control');
    expect(lineProblem('a\tb')).toBe('control');
  });

  it('accepts wording of 0 to 300 characters, with a newline, and refuses a control character', () => {
    expect(wordingProblem('')).toBeNull();
    expect(wordingProblem('Add "David"\nengraved')).toBeNull();
    expect(wordingProblem('x'.repeat(300))).toBeNull();
    expect(wordingProblem('x'.repeat(301))).toBe('too_long');
    expect(wordingProblem('bell\u0007')).toBe('control');
  });
});

describe('understand (AC-1)', () => {
  const registry = defaultDomainRegistry;

  it('is clear when exactly one subject matches', () => {
    const result = understand({description: 'Build the altar and ramp'}, registry);
    expect(result).toEqual({kind: 'clear', subject: registry.subject(ALTAR)});
  });

  it('is no_match when nothing does, and carries the registered subjects for the explanation', () => {
    expect(understand({description: 'a lighthouse'}, registry)).toEqual({kind: 'no_match', subjects: registry.subjects()});
    expect(understand({description: 'a lighthouse'}, registry).kind).toBe('no_match');
  });

  it('is ambiguous when several match, naming them in registry order', () => {
    const result = understand({description: 'altar'}, fixtureRegistry);
    expect(result).toMatchObject({kind: 'ambiguous'});
    expect(result.kind === 'ambiguous' && result.matches.map((subject) => subject.id)).toEqual([ALTAR, 'fixture-incense-altar']);
  });

  it('names the field problems of an empty, over-long or control-character description before it matches anything', () => {
    expect(understand({description: ''}, registry)).toEqual({kind: 'invalid', problems: [{field: 'description', problem: 'empty'}]});
    expect(understand({description: 'x'.repeat(2001)}, registry)).toEqual({kind: 'invalid', problems: [{field: 'description', problem: 'too_long'}]});
    expect(understand({description: 'altar\u0007'}, registry)).toEqual({kind: 'invalid', problems: [{field: 'description', problem: 'control'}]});
    // An invalid description that would have matched is still invalid.
    expect(understand({description: `altar ${'x'.repeat(2000)}`}, registry).kind).toBe('invalid');
  });

  it('names every problem at once: the description and the wording', () => {
    expect(understand({description: '', wording: 'x'.repeat(301)}, registry)).toEqual({
      kind: 'invalid',
      problems: [
        {field: 'description', problem: 'empty'},
        {field: 'personalization', problem: 'too_long'},
      ],
    });
  });

  it('accepts a chosen subject only if it is among the matches', () => {
    expect(understand({description: 'altar', subjectId: 'fixture-incense-altar'}, fixtureRegistry)).toEqual({kind: 'clear', subject: fixtureRegistry.subject('fixture-incense-altar')});
    expect(understand({description: 'altar', subjectId: ALTAR}, fixtureRegistry)).toEqual({kind: 'clear', subject: fixtureRegistry.subject(ALTAR)});
    // One that is registered but does not fit the description, one nobody registered, and one when nothing matches at all.
    for (const [description, subjectId] of [['a ramp', 'fixture-incense-altar'], ['altar', 'no-such-subject'], ['a lighthouse', ALTAR], ['altar', '']]) {
      expect(understand({description, subjectId}, fixtureRegistry), `${description} / ${subjectId}`).toEqual({kind: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]});
    }
  });

  it('treats a missing choice and a null one alike', () => {
    expect(understand({description: 'a ramp', subjectId: null}, fixtureRegistry).kind).toBe('clear');
    expect(understand({description: 'a ramp'}, fixtureRegistry).kind).toBe('clear');
  });

  it('is deterministic: the same words give the same answer', () => {
    const first = understand({description: 'the altar'}, fixtureRegistry);
    for (let i = 0; i < 5; i += 1) expect(understand({description: 'the altar'}, fixtureRegistry)).toEqual(first);
  });

  it('understands the Hebrew examples of the story', () => {
    for (const description of ['המזבח', 'מִזְבֵּחַ', 'Altar,']) expect(understand({description}, registry).kind, description).toBe('clear');
    for (const description of ['altarpiece', 'ramps', 'kevesher']) expect(understand({description}, registry).kind, description).toBe('no_match');
  });
});

describe('classifyPersonalization (AC-4)', () => {
  const text = (wording: string) => classifyPersonalization(wording, 'evidence_text');
  const declined = (wording: string, reason: string) => ({kind: 'declined', wording: wording.trim(), reason});

  it('is none for no wording at all, in every mode', () => {
    for (const mode of ['evidence_text', 'evidence_images', 'image_direct'] as const) {
      expect(classifyPersonalization('', mode)).toEqual({kind: 'none'});
      expect(classifyPersonalization('  \n\t ', mode)).toEqual({kind: 'none'});
    }
  });

  it('applies one quoted text, recessed when the words outside the quotes say so', () => {
    for (const wording of [
      'Add "David" engraved on the base',
      'Add "David" carved on the base',
      'Add "David" incised',
      'add “David” DEBOSSED please',
      'Add «David» sunken into it',
      'put "David" recessed',
      'הוסיפו "דוד" חרוט על הבסיס',
      'הוסיפו "דוד" שקוע',
      'Engraved: "David"',
      'engraved, "David".',
    ]) {
      expect(text(wording), wording).toMatchObject({kind: 'applied', style: 'recessed'});
    }
    expect(text('Add "David" engraved on the base')).toEqual({kind: 'applied', wording: 'Add "David" engraved on the base', text: 'David', style: 'recessed'});
  });

  it('applies one quoted text as raised when the words say so, and as raised when they say nothing', () => {
    for (const wording of ['Add "David" raised', 'Add "David" embossed', 'with "David" in relief', 'a protruding "David"', 'הוסיפו "דוד" בולט', 'הוסיפו "דוד" מוגבה']) {
      expect(text(wording), wording).toMatchObject({kind: 'applied', style: 'raised'});
    }
    expect(text('Add "דוד"')).toEqual({kind: 'applied', wording: 'Add "דוד"', text: 'דוד', style: 'raised'});
    expect(text('"David"')).toMatchObject({kind: 'applied', style: 'raised', text: 'David'});
  });

  it('takes the style from outside the quotes only: a style word inside the text is the text', () => {
    expect(text('Add "Raised" to the base')).toMatchObject({kind: 'applied', text: 'Raised', style: 'raised'});
    expect(text('Add "Engraved" to the base')).toMatchObject({kind: 'applied', text: 'Engraved', style: 'raised'});
    expect(text('Add "Raised" engraved')).toMatchObject({kind: 'applied', text: 'Raised', style: 'recessed'});
  });

  it('matches a style as a whole word', () => {
    expect(text('Add "David" engravedish')).toMatchObject({style: 'raised'});
    expect(text('Add "David" unraised')).toMatchObject({style: 'raised'});
  });

  it('keeps the text as it was written, trimmed, in the three kinds of quotes', () => {
    expect(text('Add "  David  " raised')).toMatchObject({text: 'David'});
    expect(text('Add “Dav id” raised')).toMatchObject({text: 'Dav id'});
    expect(text('Add «DAVID» raised')).toMatchObject({text: 'DAVID'});
  });

  it('declines wording with no quoted text, naming the reason', () => {
    for (const wording of ['add something nice', 'engraved on the base', 'Add David', 'Add "David', 'Add ""', 'Add " "']) expect(text(wording), wording).toEqual(declined(wording, 'no_quoted_text'));
  });

  it('declines wording with several quoted texts', () => {
    for (const wording of ['Add "David" and "Sara"', 'Add “David” and «Sara»', '"A" "B" engraved']) expect(text(wording), wording).toEqual(declined(wording, 'several_texts'));
  });

  it('declines a text of more than 24 characters and accepts one of exactly 24', () => {
    expect(text(`Add "${'x'.repeat(maxPersonalizationText)}"`)).toMatchObject({kind: 'applied'});
    expect(text(`Add "${'x'.repeat(maxPersonalizationText + 1)}"`)).toEqual(declined(`Add "${'x'.repeat(25)}"`, 'text_too_long'));
    expect(text(`Add "${'ש'.repeat(24)}"`)).toMatchObject({kind: 'applied'});
    expect(text(`Add "${'😀'.repeat(24)}"`)).toMatchObject({kind: 'applied'});
    expect(text(`Add "${'😀'.repeat(25)}"`)).toMatchObject({reason: 'text_too_long'});
  });

  it('declines a text with a control character', () => {
    expect(text('Add "Dav\tid"')).toMatchObject({kind: 'declined', reason: 'text_invalid'});
    expect(text('Add "Dav\nid"')).toMatchObject({kind: 'declined', reason: 'text_invalid'});
    expect(text('Add "Dav\u0007id"')).toMatchObject({kind: 'declined', reason: 'text_invalid'});
  });

  it('declines wording that asks for raised and recessed together', () => {
    for (const wording of ['Add "David" raised and engraved', 'recessed or embossed "David"', 'הוסיפו "דוד" בולט וחרוט']) expect(text(wording), wording).toEqual(declined(wording, 'conflicting_styles'));
  });

  it('declines any wording in image_direct mode, with the no-surfaces reason, even a good one', () => {
    for (const wording of ['Add "David" engraved on the base', 'something nice', 'Add "David" and "Sara"']) {
      expect(classifyPersonalization(wording, 'image_direct')).toEqual({kind: 'declined', wording, reason: 'image_direct_has_no_surfaces'});
    }
  });

  it('applies evidence_images wording like evidence_text wording', () => {
    expect(classifyPersonalization('Add "David" raised', 'evidence_images')).toMatchObject({kind: 'applied', style: 'raised'});
  });

  it('only ever gives a reason the database and the screens know', () => {
    const seen = new Set<string>();
    for (const [wording, mode] of [['x', 'evidence_text'], ['"a" "b"', 'evidence_text'], [`"${'x'.repeat(25)}"`, 'evidence_text'], ['"a\tb"', 'evidence_text'], ['"a" raised engraved', 'evidence_text'], ['"a"', 'image_direct']] as const) {
      const result = classifyPersonalization(wording, mode);
      if (result.kind === 'declined') seen.add(result.reason);
    }
    expect([...seen].sort()).toEqual([...declineReasons].sort());
  });
});

describe('what a revision stores of a wish', () => {
  it('stores nothing for no wish', () => {
    expect(storedPersonalization({kind: 'none'})).toEqual({wording: null, text: null, style: null, applied: false, reason: null});
  });

  it('stores the wording, the text and the style of an applied wish', () => {
    expect(storedPersonalization(classifyPersonalization('Add "David" engraved on the base', 'evidence_text'))).toEqual({
      wording: 'Add "David" engraved on the base',
      text: 'David',
      style: 'recessed',
      applied: true,
      reason: null,
    });
  });

  it('stores the wording and the reason of a declined one, and no text or style', () => {
    expect(storedPersonalization(classifyPersonalization('add something nice', 'evidence_text'))).toEqual({wording: 'add something nice', text: null, style: null, applied: false, reason: 'no_quoted_text'});
    expect(storedPersonalization(classifyPersonalization('Add "David"', 'image_direct'))).toEqual({wording: 'Add "David"', text: null, style: null, applied: false, reason: 'image_direct_has_no_surfaces'});
  });
});

describe('checkRequest: what a confirmation would record, worked out from the submitted fields alone (AC-2, AC-4)', () => {
  const input = {mode: 'evidence_text' as const, description: 'Please build the altar and ramp, and add "David" engraved on the base', subjectId: ALTAR as string | null, scope: 'The outer altar', outcome: 'A model I can print', wording: 'Add "David" engraved on the base'};

  it('records the exact edited values, the subject\'s display name as the title, and the wish as understood', () => {
    expect(checkRequest(input, defaultDomainRegistry)).toEqual({
      ok: true,
      request: {
        title: 'The outer altar and ramp (Middot 3)',
        mode: 'evidence_text',
        subjectId: ALTAR,
        scope: 'The outer altar',
        outcome: 'A model I can print',
        description: input.description,
        personalization: {wording: 'Add "David" engraved on the base', text: 'David', style: 'recessed', applied: true, reason: null},
      },
    });
  });

  it('records no wish when there is none', () => {
    const result = checkRequest({...input, wording: ''}, defaultDomainRegistry);
    expect(result).toMatchObject({ok: true, request: {personalization: {wording: null, text: null, style: null, applied: false, reason: null}}});
  });

  it('records a declined wish as not applied, with its reason, and still lets the request be confirmed', () => {
    const result = checkRequest({...input, wording: 'add something nice'}, defaultDomainRegistry);
    expect(result).toMatchObject({ok: true, request: {personalization: {wording: 'add something nice', applied: false, reason: 'no_quoted_text', text: null, style: null}}});
  });

  it('declines the wish of an image_direct request with the no-surfaces reason and records it not applied', () => {
    const result = checkRequest({...input, mode: 'image_direct'}, defaultDomainRegistry);
    expect(result).toMatchObject({
      ok: true,
      request: {mode: 'image_direct', personalization: {wording: 'Add "David" engraved on the base', applied: false, reason: 'image_direct_has_no_surfaces', text: null, style: null}},
    });
  });

  it('trusts no subject the client names: it must be a match for the description', () => {
    // A subject was chosen, but the description fits none: the choice is not among the matches.
    expect(checkRequest({...input, description: 'a lighthouse'}, defaultDomainRegistry)).toMatchObject({ok: false, kind: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]});
    expect(checkRequest({...input, description: 'a lighthouse', subjectId: null}, defaultDomainRegistry)).toEqual({ok: false, kind: 'no_match'});
    expect(checkRequest({...input, subjectId: 'fixture-incense-altar'}, defaultDomainRegistry)).toMatchObject({ok: false, kind: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]});
    expect(checkRequest({...input, description: 'altar', subjectId: null}, fixtureRegistry)).toEqual({ok: false, kind: 'ambiguous'});
    expect(checkRequest({...input, description: 'altar', subjectId: 'fixture-incense-altar'}, fixtureRegistry)).toMatchObject({ok: true, request: {subjectId: 'fixture-incense-altar', title: 'The incense altar (fixture)'}});
  });

  it('names every field problem together', () => {
    expect(checkRequest({...input, description: '', scope: '', outcome: 'x'.repeat(301), wording: 'x'.repeat(301)}, defaultDomainRegistry)).toEqual({
      ok: false,
      kind: 'invalid',
      problems: [
        {field: 'description', problem: 'empty'},
        {field: 'personalization', problem: 'too_long'},
        {field: 'scope', problem: 'empty'},
        {field: 'outcome', problem: 'too_long'},
      ],
    });
    expect(checkRequest({...input, scope: 'two\nlines'}, defaultDomainRegistry)).toMatchObject({ok: false, problems: [{field: 'scope', problem: 'control'}]});
  });

  it('carries no approval, permission or payment: a revision holds the request and nothing else', () => {
    const result = checkRequest(input, defaultDomainRegistry);
    expect(result.ok && Object.keys(result.request).sort()).toEqual(['description', 'mode', 'outcome', 'personalization', 'scope', 'subjectId', 'title']);
    expect(JSON.stringify(result)).not.toMatch(/approv|permission|payment|cost|job|reserv/i);
  });
});

describe('text that draws nothing, and bidirectional controls (the review patches)', () => {
  const invisibles = [ZWSP, BRAILLE_BLANK, HANGUL_FILLER, at(0x115f), at(0x1160), at(0xfeff), at(0x00a0), at(0x3000), at(0x2028), at(0x00ad), at(0x2060), ZWNJ, ZWJ, ZWSP + ZWNJ + ZWJ, ' ' + ZWSP + ' '];

  it('counts a text that is empty once the characters that draw nothing are removed as empty, in every field', () => {
    for (const nothing of invisibles) {
      expect(isInvisible(nothing), JSON.stringify(nothing)).toBe(true);
      expect(descriptionProblem(nothing), 'description').toBe('empty');
      expect(lineProblem(nothing), 'scope or outcome').toBe('empty');
      expect(lineProblem(nothing, 300), 'outcome').toBe('empty');
      // No wording at all is not a mistake: there is no wish.
      expect(wordingProblem(nothing), 'wording').toBeNull();
    }
    expect(isInvisible('')).toBe(true);
  });

  it('holds the same set as a Project title does: what titleProblem calls empty is what isInvisible calls empty, character by character', () => {
    const differing: string[] = [];
    for (let code = 1; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const character = at(code);
      // A control character is its own problem in a title ('control'), and a title is checked for those first.
      const problem = titleProblem(character);
      if (isInvisible(character) !== (problem === 'empty' || problem === 'control')) differing.push(`U+${code.toString(16)}`);
    }
    expect(differing).toEqual([]);
  }, 30_000);

  it('does not count a text with anything visible in it, joiners and all', () => {
    for (const visible of ['a', `a${ZWSP}`, `${ZWSP}a${ZWSP}`, 'שלום', `می${ZWNJ}خواهم`, `👩${ZWJ}👩${ZWJ}👧`, '0', '.']) {
      expect(isInvisible(visible), JSON.stringify(visible)).toBe(false);
    }
  });

  it('refuses a zero-width-only scope, outcome and description as empty, and a description of only a newline and joiners', () => {
    expect(lineProblem(`${ZWSP}${ZWSP}`)).toBe('empty');
    expect(lineProblem(BRAILLE_BLANK)).toBe('empty');
    expect(descriptionProblem(`\n${ZWNJ}\t${ZWJ}`)).toBe('empty');
  });

  it('refuses a bidirectional override, embedding or isolate control in the description, scope, outcome and wording', () => {
    for (let code = 0x202a; code <= 0x202e; code += 1) {
      expect(descriptionProblem(`Build ${at(code)}the altar`), `U+${code.toString(16)}`).toBe('control');
      expect(lineProblem(`The ${at(code)}altar`), `U+${code.toString(16)}`).toBe('control');
      expect(wordingProblem(`Add "x" ${at(code)}raised`), `U+${code.toString(16)}`).toBe('control');
    }
    for (let code = 0x2066; code <= 0x2069; code += 1) {
      expect(descriptionProblem(`Build ${at(code)}the altar`), `U+${code.toString(16)}`).toBe('control');
      expect(lineProblem(`The ${at(code)}altar`), `U+${code.toString(16)}`).toBe('control');
      expect(wordingProblem(`Add "x" ${at(code)}raised`), `U+${code.toString(16)}`).toBe('control');
    }
    // Alone it is a control, not "empty": it is the thing to take out.
    expect(descriptionProblem(RLO)).toBe('control');
    expect(lineProblem(`${LRI}${PDI}`)).toBe('control');
  });

  it('allows the zero-width non-joiner and joiner inside text: Hebrew, Persian and emoji need them', () => {
    for (const text of [`می${ZWNJ}خواهم`, `שלום${ZWJ}עולם`, `👩${ZWJ}👩${ZWJ}👧 altar`]) {
      expect(descriptionProblem(text), JSON.stringify(text)).toBeNull();
      expect(lineProblem(text), JSON.stringify(text)).toBeNull();
      expect(wordingProblem(text), JSON.stringify(text)).toBeNull();
    }
  });

  it('understands a description with a joiner in it, and refuses one that is a bidi override, naming the field', () => {
    expect(understand({description: `the al${ZWNJ}tar`}, defaultDomainRegistry).kind).toBe('no_match');
    expect(understand({description: `the altar${ZWNJ} and the ramp`}, defaultDomainRegistry).kind).toBe('clear');
    expect(understand({description: `the ${RLO}altar`}, defaultDomainRegistry)).toEqual({kind: 'invalid', problems: [{field: 'description', problem: 'control'}]});
    expect(understand({description: ZWSP}, defaultDomainRegistry)).toEqual({kind: 'invalid', problems: [{field: 'description', problem: 'empty'}]});
    expect(understand({description: 'altar', wording: `Add "x" ${RLO}`}, defaultDomainRegistry)).toEqual({kind: 'invalid', problems: [{field: 'personalization', problem: 'control'}]});
  });

  it('treats wording of only zero-width characters as no wish at all', () => {
    for (const mode of ['evidence_text', 'evidence_images', 'image_direct'] as const) expect(classifyPersonalization(ZWSP + ZWNJ, mode)).toEqual({kind: 'none'});
    expect(checkRequest({mode: 'evidence_text', description: 'altar', subjectId: null, scope: 'a', outcome: 'b', wording: ZWSP}, defaultDomainRegistry)).toMatchObject({
      ok: true,
      request: {personalization: {wording: null, text: null, style: null, applied: false, reason: null}},
    });
  });

  it('declines a quoted text of only characters that draw nothing, or with a bidi control, as unusable', () => {
    for (const unusable of [`Add "${ZWSP}"`, `Add "${BRAILLE_BLANK}${HANGUL_FILLER}" raised`, `Add "${ZWNJ}"`, `Add "Da${RLO}vid"`, `Add "${LRI}David${PDI}"`]) {
      expect(classifyPersonalization(unusable, 'evidence_text'), JSON.stringify(unusable)).toMatchObject({kind: 'declined', reason: 'text_invalid'});
    }
    // Quotes with nothing at all between them hold no text; quotes with only a space between them are the same.
    expect(classifyPersonalization('Add ""', 'evidence_text')).toMatchObject({reason: 'no_quoted_text'});
    expect(classifyPersonalization('Add " "', 'evidence_text')).toMatchObject({reason: 'no_quoted_text'});
    // A joiner between letters is text.
    expect(classifyPersonalization(`Add "می${ZWNJ}خواهم"`, 'evidence_text')).toMatchObject({kind: 'applied', text: `می${ZWNJ}خواهم`});
  });

  it('refuses a scope or outcome that is nothing visible when a request is confirmed', () => {
    const base = {mode: 'evidence_text' as const, description: 'altar', subjectId: null, scope: 'a', outcome: 'b', wording: ''};
    expect(checkRequest({...base, scope: ZWSP + ZWSP}, defaultDomainRegistry)).toMatchObject({ok: false, problems: [{field: 'scope', problem: 'empty'}]});
    expect(checkRequest({...base, outcome: BRAILLE_BLANK}, defaultDomainRegistry)).toMatchObject({ok: false, problems: [{field: 'outcome', problem: 'empty'}]});
    expect(checkRequest({...base, description: `${ZWSP}`}, defaultDomainRegistry)).toMatchObject({ok: false, problems: [{field: 'description', problem: 'empty'}]});
    expect(checkRequest({...base, scope: `a${RLO}b`}, defaultDomainRegistry)).toMatchObject({ok: false, problems: [{field: 'scope', problem: 'control'}]});
  });
});

describe('the words that choose a style, with their inflections (the review patches)', () => {
  const style = (word: string) => classifyPersonalization(`Add "David" ${word}`, 'evidence_text');
  const recessed = ['recess', 'recesses', 'recessed', 'recessing', 'engrave', 'engraves', 'engraved', 'engraving', 'carve', 'carves', 'carved', 'carving', 'incise', 'incises', 'incised', 'incising', 'deboss', 'debosses', 'debossed', 'debossing', 'etched', 'etch', 'sunken', 'חרוט', 'שקוע'];
  const raised = ['raise', 'raises', 'raised', 'raising', 'emboss', 'embosses', 'embossed', 'embossing', 'relief', 'protruding', 'protrude', 'protrudes', 'בולט', 'מוגבה'];

  it.each(recessed)('reads %s as recessed', (word) => {
    expect(style(word)).toMatchObject({kind: 'applied', style: 'recessed'});
    expect(style(word.toUpperCase())).toMatchObject({kind: 'applied', style: 'recessed'});
  });

  it.each(raised)('reads %s as raised', (word) => {
    expect(style(word)).toMatchObject({kind: 'applied', style: 'raised'});
  });

  it('reads "Add "David" engraving" as recessed', () => {
    expect(classifyPersonalization('Add "David" engraving', 'evidence_text')).toEqual({kind: 'applied', wording: 'Add "David" engraving', text: 'David', style: 'recessed'});
  });

  it('matches whole words only: a longer word, a prefix and an inflection that is not listed are none of them a style word', () => {
    // These words contain a style word or look like one, and are not in the list: the wish is raised, as when nothing is said.
    for (const word of ['engravedish', 'unraised', 'engravings', 'reliefs', 'carvedwood', 'preembossed', 'recessive', 'etching', 'raiser']) {
      expect(style(word), word).toMatchObject({kind: 'applied', style: 'raised'});
    }
    // And a recessed word inside one of them does not turn the wish recessed.
    expect(style('unengraved')).toMatchObject({style: 'raised'});
  });

  it('stays conflicting when one word of each style is there, in any inflection', () => {
    for (const wording of ['Add "David" raised and engraving', 'Add "David" carves and embosses', 'Add "David" relief engraved', 'Add "David" protruding etched', 'הוסיפו "דוד" בולט וגם חרוט']) {
      expect(classifyPersonalization(wording, 'evidence_text'), wording).toMatchObject({kind: 'declined', reason: 'conflicting_styles'});
    }
  });

  it('reads a Hebrew style word with the article', () => {
    expect(style('החרוט')).toMatchObject({style: 'recessed'});
    expect(style('הבולט')).toMatchObject({style: 'raised'});
  });
});

describe('a stray quotation mark (the review patches)', () => {
  const declined = (wording: string, reason: string) => expect(classifyPersonalization(wording, 'evidence_text'), wording).toEqual({kind: 'declined', wording, reason});

  it('declines one quoted text plus another quotation mark without its pair, rather than taking the first pair', () => {
    declined('"צה"ל"', 'several_texts');
    declined('Add "David" raised "', 'several_texts');
    declined('Add “David” ”', 'several_texts');
    declined('Add «David» »', 'several_texts');
    declined('Add “David” and a lone « mark', 'several_texts');
    declined('"David" and the "', 'several_texts');
  });

  it('declines an empty pair and a stray mark as no quoted text: there is no text in it to take', () => {
    declined('Add " "David"', 'no_quoted_text');
  });

  it('declines a lone quotation mark, of any kind, as no quoted text', () => {
    for (const mark of ['"', '“', '”', '«', '»']) {
      declined(`Add ${mark}David engraved`, 'no_quoted_text');
      declined(mark, 'no_quoted_text');
    }
  });

  it('still applies one pair with nothing else of the kind, and mixed kinds only when each has its own pair', () => {
    expect(classifyPersonalization('Add "David" engraved', 'evidence_text')).toMatchObject({kind: 'applied', text: 'David'});
    expect(classifyPersonalization('Add “David” engraved', 'evidence_text')).toMatchObject({kind: 'applied', text: 'David'});
    expect(classifyPersonalization('Add «David» engraved', 'evidence_text')).toMatchObject({kind: 'applied', text: 'David'});
    declined('Add "David" and «Sara»', 'several_texts');
    // An apostrophe is not a quotation mark of the kinds that are understood.
    expect(classifyPersonalization("Add \"David's\" raised", 'evidence_text')).toMatchObject({kind: 'applied', text: "David's"});
  });

  it('does not let a stray mark hide a text that is too long or unusable: it is not clear which text is meant', () => {
    declined(`"${'x'.repeat(30)}" "`, 'several_texts');
  });
});

describe('matchSubjects compares the registered aliases as it compares the description (the review patches)', () => {
  const manifest: DomainManifest = {
    packageId: 'normalizing',
    version: 1,
    subjects: [{id: 'needs-normalizing', displayName: 'Needs normalizing', aliases: ['Mizbeach', 'מִזְבֵּחַ', 'ＡＬＴＡＲ']}],
  };
  const subjects = createDomainRegistry([manifest]).subjects();

  it('matches the description mizbeach, מזבח and altar through aliases written in capitals, with niqqud, and in full-width letters', () => {
    for (const description of ['mizbeach', 'MIZBEACH', 'מזבח', 'המזבח', 'altar', 'Altar,', 'ａｌｔａｒ']) {
      expect(matchSubjects(description, subjects).map((subject) => subject.id), description).toEqual(['needs-normalizing']);
    }
    expect(matchSubjects('altarpiece', subjects)).toEqual([]);
  });
});

describe('the Hebrew prefix rule belongs to an alias that starts with a Hebrew letter, and to no other (the review patches)', () => {
  const aliases = createDomainRegistry([{packageId: 'latin', version: 1, subjects: [{id: 'latin-subject', displayName: 'Latin subject', aliases: ['altar', 'ramp', 'kevesh']}]}]).subjects();

  it('does not match a Latin alias after a Hebrew prefix letter or two: the letters are a longer word', () => {
    for (const description of ['הaltar', 'לramp', 'ובkevesh', 'במramp', 'שaltar', 'ה altarx']) {
      expect(matchSubjects(description, aliases), description).toEqual([]);
    }
    // Set apart from the Hebrew letters they match, as a word of their own.
    expect(matchSubjects('ה altar', aliases).map((subject) => subject.id)).toEqual(['latin-subject']);
    expect(matchSubjects('ל-ramp', aliases).map((subject) => subject.id)).toEqual(['latin-subject']);
  });

  it('matches a Hebrew alias after the same letters', () => {
    expect(matchSubjects('הכבש', defaultDomainRegistry.subjects()).map((subject) => subject.id)).toEqual([ALTAR]);
    expect(matchSubjects('ולמזבח', defaultDomainRegistry.subjects()).map((subject) => subject.id)).toEqual([ALTAR]);
  });
});
