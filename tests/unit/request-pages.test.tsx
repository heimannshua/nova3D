import type {ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The text flow (Story 2.1): C-01 (Create), C-02 (describe), C-06 (the understood request), and the Project page's Request section,
// rendered to markup in both languages. What needs a browser (focus, the live region, the Server Actions, the redirect) is in
// tests/e2e/request.spec.ts. A result the server would have answered is given to the screen as its initial state (as Shell's initial* flags
// are only for tests), which is how the ambiguous case, reachable only with the fixture registry, is seen here.
const mocks = vi.hoisted(() => ({access: null as unknown}));
vi.mock('next/headers', () => ({
  cookies: async () => ({get: () => undefined, getAll: () => []}),
  headers: async () => ({get: () => null}),
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccess: async () => mocks.access,
  requireActiveAccount: async () => {
    if ((mocks.access as {state: string}).state !== 'active') throw new Error('not active');
    return mocks.access;
  },
}));

import NewProjectPage, {generateMetadata} from '@/app/projects/new/page';
import {PersonalizationSummary} from '@/components/projects/personalization-summary';
import {RequestIntake, type InitialIntake} from '@/components/projects/request-intake';
import {RequestSection, type RequestSectionData} from '@/components/projects/request-section';
import {CreateDialog} from '@/components/shell/create-dialog';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {fixtureRows} from '@/lib/project-fixtures';
import {stageDefinition} from '@/lib/project-stage';
import type {ProjectRequestRow} from '@/lib/project-view';
import {classifyPersonalization, declineReasons, storedPersonalization} from '@/lib/request-intake';
import type {UnderstandState} from '@/lib/request-view';
import {fixtureRegistry} from '../support/fixture-domains';

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params, {isolate: false});
const render = (locale: Locale, element: ReactElement) => renderToStaticMarkup(<I18nProvider locale={locale}><AnnouncerProvider>{element}</AnnouncerProvider></I18nProvider>);
const intake = (locale: Locale, initial?: InitialIntake) => render(locale, <RequestIntake initial={initial}/>);
const attribute = (markup: string, name: string) => [...markup.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))].map((match) => match[1]);
/** The tag of the radio of a group with this value. */
const radio = (markup: string, name: string, value: string) => new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*\\bvalue="${value}"[^>]*>|<input\\b[^>]*\\bvalue="${value}"[^>]*\\bname="${name}"[^>]*>`).exec(markup)?.[0] ?? '';
/** The page without the announcer region every render of the providers carries. */
const withoutAnnouncer = (markup: string) => markup.replace(/<div class="visually-hidden" role="status"[^>]*data-announcer[^>]*><\/div>/, '').replace(/<script>[\s\S]*?<\/script>/, '');
/** The whole tag of the field with this name (React writes a tag's attributes in its own order). */
const field = (markup: string, name: string) => new RegExp(`<(?:input|textarea)\\b[^>]*\\bname="${name}"[^>]*>`).exec(markup)?.[0] ?? '';

const altar = {id: 'middot-altar-ramp', displayName: 'The outer altar and ramp (Middot 3)'};
const incense = {id: 'fixture-incense-altar', displayName: 'The incense altar (fixture)'};
const none = {kind: 'none'} as const;
const description = 'Please build the altar and ramp, and add "David" engraved on the base';
const clear = (personalization: UnderstandState extends infer S ? (S extends {personalization: infer P} ? P : never) : never = none): UnderstandState => ({outcome: 'clear', subject: altar, personalization});

beforeEach(() => {
  mocks.access = {state: 'active', user: {id: 'u', email: 'person@example.com', sessionId: 's'}, account: {accountId: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', workspaceId: null, role: 'member', epoch: 4, preferences: null}};
});

describe('the page', () => {
  it('is titled New project, and renders the flow for an active Account only', async () => {
    expect((await generateMetadata()).title).toBe('New project');
    expect((await NewProjectPage()).type).toBe(RequestIntake);
    mocks.access = {state: 'disabled'};
    await expect(NewProjectPage()).rejects.toThrow('not active');
  });
});

describe.each(locales)('C-02, describe the model, in %s (UX-DR32)', (locale) => {
  const markup = intake(locale);
  const words = text(markup);

  it('has one level-one heading that can take focus after a step, and the eyebrow', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1 tabindex="-1" class="request-title">/);
    expect(words).toContain(t(locale, 'request.title'));
    expect(words).toContain(t(locale, 'request.eyebrow'));
  });

  it('has a labelled description field and a labelled optional personalization field', () => {
    const descriptionId = /<textarea[^>]*id="([^"]+)"[^>]*name="description"/.exec(markup)?.[1];
    const wordingId = /<textarea[^>]*id="([^"]+)"[^>]*name="personalization"/.exec(markup)?.[1];
    expect(descriptionId).toBeTruthy();
    expect(wordingId).toBeTruthy();
    expect(markup).toMatch(new RegExp(`<label for="${descriptionId}"[^>]*>${t(locale, 'request.description.label')}</label>`));
    expect(markup).toMatch(new RegExp(`<label for="${wordingId}"[^>]*>${t(locale, 'request.personalization.label').replace(/[()]/g, '\\$&')}</label>`));
    // The description is required, the personalization is not.
    expect(/<textarea[^>]*name="description"[^>]*aria-required="true"/.test(markup)).toBe(true);
    expect(/<textarea[^>]*name="personalization"[^>]*aria-required/.test(markup)).toBe(false);
  });

  it('writes the example and the help as visible text, joined to the field, and never as a placeholder', () => {
    expect(words).toContain(t(locale, 'request.description.example'));
    expect(words).toContain(t(locale, 'request.description.help', {max: 2000}));
    expect(words).toContain(t(locale, 'request.personalization.example'));
    expect(words).toContain(t(locale, 'request.personalization.help'));
    expect(words).toContain(t(locale, 'request.limit', {max: 300}));
    expect(markup).not.toMatch(/placeholder=/);
    const described = attribute(markup.slice(markup.indexOf('name="description"') - 200, markup.indexOf('name="description"') + 400), 'aria-describedby')[0] ?? '';
    expect(described.split(' ')).toHaveLength(2);
    for (const id of described.split(' ')) expect(markup).toContain(`id="${id}"`);
  });

  it('never pre-fills the fields (empty state), and shows no error before anything is sent', () => {
    expect(markup).toMatch(/<textarea[^>]*name="description"[^>]*>\s*<\/textarea>/);
    expect(markup).toMatch(/<textarea[^>]*name="personalization"[^>]*>\s*<\/textarea>/);
    expect(markup).not.toContain('aria-invalid');
    expect(markup).not.toContain('notice-danger');
  });

  it('has a Continue button that submits the form, and a status region for the check in flight', () => {
    expect(markup).toMatch(new RegExp(`<button type="submit" class="btn btn-primary"[^>]*><span>${t(locale, 'request.continue')}</span>`));
    expect(markup).toMatch(/<form[^>]*noValidate/);
    expect(markup).toContain('role="status"');
  });

  it('keeps what was typed when the screen is shown again (Edit returns to this step with every value kept)', () => {
    const kept = intake(locale, {description, wording: 'Add "David" engraved'});
    expect(kept).toContain(description.replace(/"/g, '&quot;'));
    expect(kept).toContain('Add &quot;David&quot; engraved');
  });
});

describe.each(locales)('C-02, validation problems, in %s', (locale) => {
  it.each([
    ['empty', 'request.error.description.empty', 2000],
    ['too_long', 'request.error.description.tooLong', 2000],
    ['control', 'request.error.description.control', 2000],
  ] as const)('names a %s description, marks the field invalid and joins the message to it', (problem, key, max) => {
    const markup = intake(locale, {understood: {outcome: 'invalid', problems: [{field: 'description', problem}]}, description: 'x'});
    expect(text(markup)).toContain(t(locale, key, {max}));
    expect(markup).toMatch(/<textarea[^>]*name="description"[^>]*aria-invalid="true"/);
    const message = /<p class="notice-text" id="([^"]+)">/.exec(markup)?.[1];
    expect(message).toBeTruthy();
    expect(/<textarea[^>]*aria-describedby="[^"]*"[^>]*name="description"|<textarea[^>]*name="description"[^>]*aria-describedby="[^"]*"/.exec(markup)?.[0]).toContain(message!);
    expect(markup).not.toMatch(/<textarea[^>]*name="personalization"[^>]*aria-invalid/);
  });

  it('names a personalization over 300 characters on its own field', () => {
    const markup = intake(locale, {understood: {outcome: 'invalid', problems: [{field: 'personalization', problem: 'too_long'}]}});
    expect(text(markup)).toContain(t(locale, 'request.error.personalization.tooLong', {max: 300}));
    expect(markup).toMatch(/<textarea[^>]*name="personalization"[^>]*aria-invalid="true"/);
    expect(markup).not.toMatch(/<textarea[^>]*name="description"[^>]*aria-invalid/);
  });

  it('names every problem at once', () => {
    const markup = intake(locale, {understood: {outcome: 'invalid', problems: [{field: 'description', problem: 'empty'}, {field: 'personalization', problem: 'control'}]}});
    expect(text(markup)).toContain(t(locale, 'request.error.description.empty'));
    expect(text(markup)).toContain(t(locale, 'request.error.personalization.control'));
  });

  it('says so, in words, when the check could not be made', () => {
    const markup = intake(locale, {understood: {outcome: 'unavailable'}});
    expect(text(markup)).toContain(t(locale, 'request.checkFailed'));
    expect(markup).toContain('role="alert"');
  });
});

describe.each(locales)('C-06, clear, in %s (UX-DR36, AC-2)', (locale) => {
  const markup = intake(locale, {understood: clear(), description});
  const words = text(markup);

  it('shows the subject by the name its package gave it, isolated, in the language of neither', () => {
    expect(markup).toContain(`<bdi>${altar.displayName}</bdi>`);
    expect(words).toContain(t(locale, 'request.review.subject'));
    expect(words).toContain(t(locale, 'request.review.title'));
  });

  it('prefills the scope with the display name and the outcome with the catalog sentence, both editable and labelled', () => {
    expect(field(markup, 'scope')).toContain('value="The outer altar and ramp (Middot 3)"');
    expect(field(markup, 'scope')).toContain('type="text"');
    expect(field(markup, 'outcome')).toContain(`value="${t(locale, 'request.review.outcomeDefault')}"`);
    for (const key of ['request.review.scope', 'request.review.outcome'] as const) expect(markup).toMatch(new RegExp(`<label for="[^"]+" class="auth-label">${t(locale, key)}</label>`));
    expect(words).toContain(t(locale, 'request.review.scopeHelp'));
    expect(words).toContain(t(locale, 'request.review.outcomeHelp'));
  });

  it('shows the mode in words, and the description the person wrote', () => {
    expect(words).toContain(t(locale, 'request.mode.evidence_text'));
    expect(markup).toContain('<bdi>Please build the altar and ramp, and add &quot;David&quot; engraved on the base</bdi>');
  });

  it('has an Edit control and a Confirm control, and the sentence that confirming starts no research, approves no plan and authorizes no cost', () => {
    expect(markup).toMatch(new RegExp(`<button type="submit" class="btn btn-primary"[^>]*><span>${t(locale, 'request.review.confirm')}</span>`));
    expect(markup).toMatch(new RegExp(`<button type="button" class="btn btn-secondary"[^>]*><span>${t(locale, 'request.review.edit')}</span>`));
    expect(words).toContain(t(locale, 'request.review.confirmNote'));
  });

  it('sends the command, the description, the wording and the subject with the form, and nothing about an Account, an approval, a permission or a payment', () => {
    const names = attribute(markup.slice(markup.indexOf('<form')), 'name');
    expect(names.sort()).toEqual(['commandId', 'description', 'outcome', 'personalization', 'scope', 'subjectId']);
    // On purpose changed from a rendered UUID: the command ID is chosen when Confirm is pressed (one for the request last sent), not as the
    // person types, so the field is empty until then and nothing keeps an entry for each keystroke.
    expect(field(markup, 'commandId')).toContain('type="hidden"');
    expect(field(markup, 'commandId')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(markup).toContain('<input type="hidden" name="subjectId" value="middot-altar-ramp"/>');
    // Nothing in a field name or a hidden value: the sentence that confirming approves nothing is prose, and is checked above.
    expect(names.join(' ')).not.toMatch(/approv|permission|payment|epoch|account|cost|job/i);
  });

  it('has no "describe" fields on this step: it is the next step, not a second form', () => {
    expect(markup).not.toMatch(/<textarea/);
    expect(markup.match(/<form\b/g)).toHaveLength(1);
  });
});

describe.each(locales)('C-06, the personalization as understood or declined, in %s (AC-2, AC-4)', (locale) => {
  const review = (wording: string, mode: 'evidence_text' | 'image_direct' = 'evidence_text') => intake(locale, {understood: clear(classifyPersonalization(wording, mode)), description, wording});

  it('says none was requested when there is no wording', () => {
    expect(text(review(''))).toContain(t(locale, 'request.personalization.none'));
  });

  it('shows an applied wish as its text (isolated) and its style, marked user-added, and says the rest of the wording is not used', () => {
    const markup = review('Add "David" engraved on the base');
    expect(markup).toContain('<bdi class="wish-text">David</bdi>');
    expect(text(markup)).toContain(t(locale, 'request.personalization.style.recessed'));
    expect(text(markup)).toContain(t(locale, 'request.personalization.userAdded'));
    expect(text(markup)).toContain(t(locale, 'request.personalization.unusedNote'));
    expect(text(review('Add "דוד"'))).toContain(t(locale, 'request.personalization.style.raised'));
    expect(review('Add "דוד"')).toContain('<bdi class="wish-text">דוד</bdi>');
  });

  it.each([
    ['add something nice', 'no_quoted_text'],
    ['Add "David" and "Sara"', 'several_texts'],
    [`Add "${'x'.repeat(25)}"`, 'text_too_long'],
    ['Add "Dav\tid"', 'text_invalid'],
    ['Add "David" raised and engraved', 'conflicting_styles'],
  ] as const)('explains %j in plain words (%s), says confirming is still allowed, and shows what was written', (wording, reason) => {
    const markup = review(wording);
    const words = text(markup);
    expect(words).toContain(t(locale, 'request.personalization.notApplied', {reason: t(locale, `request.personalization.reason.${reason}`, {max: 24})}));
    expect(words).toContain(t(locale, 'request.personalization.declinedNote'));
    expect(markup).toContain(`<bdi>${wording.replace(/"/g, '&quot;')}</bdi>`);
    // The Confirm control is still there.
    expect(markup).toContain(t(locale, 'request.review.confirm'));
  });

  it('declines the wish of an image_direct request with the no-surfaces reason', () => {
    expect(text(review('Add "David" engraved', 'image_direct'))).toContain(t(locale, 'request.personalization.reason.image_direct_has_no_surfaces'));
  });

  it('has a plain-words reason, in both languages, for every reason the record can hold', () => {
    for (const reason of declineReasons) {
      for (const language of locales) expect(translate(language, `request.personalization.reason.${reason}`).length, `${language}:${reason}`).toBeGreaterThan(20);
    }
  });
});

describe.each(locales)('C-06, ambiguous, with the fixture registry, in %s (AC-1)', (locale) => {
  const matches = [altar, incense];
  const asked: UnderstandState = {outcome: 'ambiguous', matches, personalization: none};

  it('asks which subject, as a radio group of the matching subjects in registry order, and offers no confirm until one is chosen', () => {
    const markup = intake(locale, {understood: asked, description: 'altar'});
    expect(fixtureRegistry.subjects().map((subject) => subject.id)).toEqual(matches.map((match) => match.id));
    expect(text(markup)).toContain(t(locale, 'request.ambiguous.title'));
    expect(text(markup)).toContain(t(locale, 'request.ambiguous.body'));
    expect(markup).toMatch(/<fieldset[^>]*class="choice-group request-choice"/);
    expect(markup.match(/type="radio" name="subject"/g)).toHaveLength(2);
    expect(markup).not.toMatch(/type="radio"[^>]*checked/);
    expect(markup.indexOf(altar.displayName)).toBeLessThan(markup.indexOf(incense.displayName));
    expect(markup).toContain(`<bdi>${altar.displayName}</bdi>`);
    expect(markup).toContain(`<bdi>${incense.displayName}</bdi>`);
    // No confirm, no scope, no outcome, no hidden subject.
    expect(markup).not.toContain(t(locale, 'request.review.confirm'));
    expect(markup).not.toContain('type="submit"');
    expect(markup).not.toContain('name="subjectId"');
    expect(markup).not.toContain('name="scope"');
    // The person can still go back.
    expect(markup).toContain(t(locale, 'request.review.edit'));
  });

  it('shows the review of the subject that was chosen, titled by it, with its own scope', () => {
    const markup = intake(locale, {understood: asked, description: 'altar', chosen: incense.id});
    expect(radio(markup, 'subject', 'fixture-incense-altar')).toContain('checked');
    expect(radio(markup, 'subject', 'middot-altar-ramp')).not.toContain('checked');
    expect(markup).toContain('<input type="hidden" name="subjectId" value="fixture-incense-altar"/>');
    expect(markup).toContain(`value="${incense.displayName}"`);
    expect(markup).toContain(t(locale, 'request.review.confirm'));
    expect(text(markup)).toContain(t(locale, 'request.review.title'));
  });

  it('ignores a choice that is not among the matches', () => {
    const markup = intake(locale, {understood: asked, description: 'altar', chosen: 'something-else'});
    expect(markup).not.toContain('name="subjectId"');
    expect(markup).not.toContain(t(locale, 'request.review.confirm'));
  });
});

describe.each(locales)('C-06, what Confirm answered that was not a Project, in %s (the review patches)', (locale) => {
  const clearReview = (confirmed: InitialIntake['confirmed'], more: InitialIntake = {}) => intake(locale, {understood: clear(), description, confirmed, ...more});
  const alerts = (markup: string) => (markup.match(/class="notice notice-danger" role="alert"/g) ?? []).length;

  it('marks a scope and an outcome problem on their fields, joins the message, and says what the generic message says only once there is something below', () => {
    const markup = clearReview({outcome: 'invalid', problems: [{field: 'scope', problem: 'empty'}, {field: 'outcome', problem: 'too_long'}]});
    expect(field(markup, 'scope')).toContain('aria-invalid="true"');
    expect(field(markup, 'outcome')).toContain('aria-invalid="true"');
    expect(text(markup)).toContain(t(locale, 'request.error.scope.empty'));
    expect(text(markup)).toContain(t(locale, 'request.error.outcome.tooLong', {max: 300}));
    expect(text(markup)).toContain(t(locale, 'request.confirm.invalid'));
    expect(text(markup)).not.toContain(t(locale, 'request.confirm.changed'));
  });

  it('shows a subject problem on a review of one subject, which has no choice to mark it on', () => {
    const markup = clearReview({outcome: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]});
    expect(text(markup)).toContain(t(locale, 'request.error.subject.notAMatch'));
    expect(text(markup)).toContain(t(locale, 'request.confirm.invalid'));
  });

  it('shows a description problem and a personalization problem as notices with a button back to the description, keeping every value', () => {
    const markup = clearReview({outcome: 'invalid', problems: [{field: 'description', problem: 'too_long'}, {field: 'personalization', problem: 'control'}]}, {wording: 'Add "David" raised'});
    expect(text(markup)).toContain(t(locale, 'request.error.description.tooLong', {max: 2000}));
    expect(text(markup)).toContain(t(locale, 'request.error.personalization.control'));
    // Each carries the way back: the same Edit control, inside the notice.
    const notices = markup.split('class="notice notice-danger" role="alert"').slice(1).filter((part) => part.includes(t(locale, 'request.review.edit')));
    expect(notices.length).toBeGreaterThanOrEqual(2);
    // Everything the person wrote is still in the form that goes back and forth.
    expect(field(markup, 'description')).toContain(`value="${description.replace(/"/g, '&quot;')}"`);
    expect(field(markup, 'personalization')).toContain('value="Add &quot;David&quot; raised"');
  });

  it('shows a subject problem under the choice when the description fits several subjects', () => {
    const markup = intake(locale, {understood: {outcome: 'ambiguous', matches: [altar, incense], personalization: none}, description: 'altar', confirmed: {outcome: 'invalid', problems: [{field: 'subject', problem: 'not_a_match'}]}});
    expect(text(markup)).toContain(t(locale, 'request.error.subject.notAMatch'));
    expect(markup.match(new RegExp(t(locale, 'request.error.subject.notAMatch'), 'g'))).toHaveLength(1);
  });

  it('never says "marked below" for an answer with nothing to mark: it is the changed-please-review state', () => {
    const markup = clearReview({outcome: 'invalid', problems: []});
    expect(text(markup)).toContain(t(locale, 'request.confirm.changed'));
    expect(text(markup)).not.toContain(t(locale, 'request.confirm.invalid'));
    expect(alerts(markup)).toBe(1);
  });

  it('says in words what each other answer means, once', () => {
    for (const [confirmed, key] of [
      [{outcome: 'changed'}, 'request.confirm.changed'],
      [{outcome: 'reused'}, 'request.confirm.reused'],
      [{outcome: 'gone'}, 'request.confirm.gone'],
      [{outcome: 'unavailable', unknown: false}, 'request.confirm.unavailable'],
      [{outcome: 'unavailable', unknown: true}, 'request.confirm.unknown'],
    ] as const) {
      const markup = clearReview(confirmed);
      expect(text(markup), key).toContain(t(locale, key));
      expect(alerts(markup), key).toBe(1);
    }
    expect(alerts(clearReview({outcome: 'idle'}))).toBe(0);
  });

  it('tells a person whose answer was lost that confirming again is safe, and where to look', () => {
    const words = text(clearReview({outcome: 'unavailable', unknown: true}));
    expect(words).toContain(t(locale, 'request.confirm.unknown'));
    expect(translate('en', 'request.confirm.unknown')).toMatch(/may have been[\s\S]*Confirming it again is safe[\s\S]*My Projects/);
  });
});

describe.each(locales)('the four text fields, in %s (the review patches)', (locale) => {
  it('read in their own direction and truncate nothing', () => {
    const describing = intake(locale);
    for (const name of ['description', 'personalization']) {
      expect(field(describing, name)).toContain('dir="auto"');
      expect(field(describing, name)).not.toMatch(/maxLength|maxlength/);
    }
    const reviewing = intake(locale, {understood: clear(), description});
    for (const name of ['scope', 'outcome']) {
      expect(field(reviewing, name)).toContain('dir="auto"');
      expect(field(reviewing, name)).not.toMatch(/maxLength|maxlength/);
    }
  });
});

describe.each(locales)('C-06, no match, in %s (AC-1)', (locale) => {
  const markup = intake(locale, {understood: {outcome: 'no_match', subjects: [altar]}, description: 'a lighthouse'});
  const words = text(markup);

  it('explains in plain words and names the subjects that are supported', () => {
    expect(words).toContain(t(locale, 'request.noMatch.title'));
    expect(words).toContain(t(locale, 'request.noMatch.body'));
    expect(markup).toContain(`<li><bdi>${altar.displayName}</bdi></li>`);
    expect(words).toContain(t(locale, 'request.noMatch.hint'));
  });

  it('makes changing the description the main button, offers picture mode beside it as the other, and no longer says picture requests arrive later', () => {
    // On purpose changed from the picture offer being the primary button: a person whose words matched nothing most likely wants to change
    // them; the offer stays. Story 2.2 made it real, so the note that it arrives in a later release is gone.
    expect(markup).toMatch(new RegExp(`<button type="button" class="btn btn-primary"[^>]*><span>${t(locale, 'request.noMatch.edit')}</span>`));
    expect(markup).toMatch(new RegExp(`<button type="button" class="btn btn-secondary"[^>]*>(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'request.noMatch.picture')}</span>`));
    expect(markup.indexOf(t(locale, 'request.noMatch.edit'))).toBeLessThan(markup.indexOf(t(locale, 'request.noMatch.picture')));
    expect(words).not.toMatch(/later release|בגרסה מאוחרת/);
    expect(markup).not.toContain('project-muted request-note');
  });

  it('has no confirm and no hidden field', () => {
    expect(markup).not.toContain(t(locale, 'request.review.confirm'));
    expect(markup).not.toContain('type="submit"');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('type="hidden"');
  });
});

describe.each(locales)('C-01, the Create dialog, in %s (UX-DR31)', (locale) => {
  const dialog = (choice: 'text' | 'image' | null) => render(locale, <CreateDialog onClose={() => undefined} initialChoice={choice}/>);

  it('sends Enter text on to the text flow with Continue, a link to /projects/new', () => {
    const markup = dialog('text');
    expect(markup).toMatch(new RegExp(`<a class="btn btn-primary"[^>]*href="/projects/new"[^>]*><span>${t(locale, 'create.continue')}</span>`));
    expect(radio(markup, 'intake', 'text')).toContain('checked');
  });

  it('sends Upload picture on to the picture screen with Continue, a link to /projects/new/pictures, and no longer says picture upload arrives later (Story 2.2)', () => {
    const markup = dialog('image');
    expect(radio(markup, 'intake', 'image')).toContain('checked');
    expect(text(markup)).toContain(t(locale, 'create.imageSelected'));
    expect(markup).toMatch(new RegExp(`<a class="btn btn-primary"[^>]*href="/projects/new/pictures"[^>]*><span>${t(locale, 'create.continue')}</span>`));
    expect(markup).not.toContain('href="/projects/new"');
    expect(text(markup)).not.toMatch(/later release|בגרסה מאוחרת/);
  });

  it('opens with no choice made, no Continue and two radios', () => {
    const markup = dialog(null);
    expect(markup.match(/type="radio" name="intake"/g)).toHaveLength(2);
    expect(markup).not.toMatch(/type="radio"[^>]*checked/);
    expect(markup).not.toContain(t(locale, 'create.continue'));
  });

  it('no longer says creating is unavailable', () => {
    expect(translate('en', 'create.footnote')).not.toMatch(/later release|arrives|unavailable/i);
    expect(text(dialog(null))).toContain(t(locale, 'create.footnote'));
  });
});

// The Project page's Request section ---------------------------------------------------------------------------------------------
const requestRow = (patch: Partial<ProjectRequestRow> = {}): ProjectRequestRow => ({
  id: '11111111-2222-4333-8444-555555555555',
  projectId: '00000000-0000-4000-8000-000000000001',
  seq: 1,
  mode: 'evidence_text',
  subjectId: 'middot-altar-ramp',
  scope: 'The outer altar',
  outcome: 'A model I can print',
  description,
  personalization: storedPersonalization(classifyPersonalization('Add "David" engraved on the base', 'evidence_text')),
  confirmed: true,
  confirmedAt: '2026-10-18T19:12:12.844515+00:00',
  images: [],
  obstructionConfirmed: false,
  obstructionConfirmedAt: null,
  acknowledged: false,
  acknowledgedAt: null,
  ...patch,
});
const section = (locale: Locale, data: RequestSectionData) => render(locale, <RequestSection data={data}/>);

describe.each(locales)('the Request section of a Project, in %s', (locale) => {
  it('shows the subject, scope, outcome, mode, personalization and the time it was confirmed (UTC), each user text isolated', () => {
    const markup = section(locale, {state: 'found', request: requestRow(), subjectName: altar.displayName});
    const words = text(markup);
    expect(markup).toContain(`<bdi>${altar.displayName}</bdi>`);
    expect(markup).toContain('<bdi>The outer altar</bdi>');
    expect(markup).toContain('<bdi>A model I can print</bdi>');
    expect(words).toContain(t(locale, 'request.mode.evidence_text'));
    expect(markup).toContain('<bdi class="wish-text">David</bdi>');
    expect(markup).toMatch(/<bdi dir="ltr" class="ltr-token"><time dateTime="2026-10-18T19:12:12\.844Z">2026-10-18 19:12 UTC<\/time><\/bdi>/);
    for (const key of ['request.section.title', 'request.review.subject', 'request.review.scope', 'request.review.outcome', 'request.review.mode', 'request.review.personalization', 'request.section.confirmed'] as const) expect(words).toContain(t(locale, key));
  });

  it('says the confirmation started nothing and charged nothing, and carries no approval, permission or payment', () => {
    const markup = section(locale, {state: 'found', request: requestRow(), subjectName: altar.displayName});
    expect(text(markup)).toContain(t(locale, 'request.section.nothingStarted'));
    expect(markup).not.toMatch(/<a\b|<button|<input/);
  });

  it('shows a wish that was not applied with its reason', () => {
    const declined = requestRow({personalization: storedPersonalization(classifyPersonalization('add something nice', 'evidence_text'))});
    const words = text(section(locale, {state: 'found', request: declined, subjectName: altar.displayName}));
    expect(words).toContain(t(locale, 'request.personalization.notApplied', {reason: t(locale, 'request.personalization.reason.no_quoted_text')}));
  });

  it('says none was requested when there was no wish, and names a picture mode in words', () => {
    const plain = section(locale, {state: 'found', request: requestRow({personalization: storedPersonalization({kind: 'none'}), mode: 'image_direct'}), subjectName: null});
    expect(text(plain)).toContain(t(locale, 'request.personalization.none'));
    expect(text(plain)).toContain(t(locale, 'request.mode.image_direct'));
  });

  it('falls back to the subject\'s ID when no registered subject has it any more', () => {
    expect(section(locale, {state: 'found', request: requestRow({subjectId: 'gone-subject'}), subjectName: null})).toContain('gone-subject');
  });

  it('is not there for a Project without a request, and says so when the request could not be read', () => {
    expect(withoutAnnouncer(section(locale, {state: 'none'}))).toBe('');
    const unreadable = section(locale, {state: 'unreadable'});
    expect(text(unreadable)).toContain(t(locale, 'request.section.unreadable'));
    expect(text(unreadable)).toContain(t(locale, 'request.section.title'));
  });
});

describe('the stage request_confirmed on the Project page', () => {
  const row = {...fixtureRows()[0], stage: 'request_confirmed' as const};
  it.each(locales)('is named in words with a shape of its own, and its next action says nothing has started and nothing was charged, in %s', async (locale) => {
    const { ProjectOverview } = await import('@/components/projects/project-overview');
    const markup = render(locale, <ProjectOverview project={row} request={{state: 'found', request: requestRow(), subjectName: altar.displayName}}/>);
    expect(text(markup)).toContain(t(locale, stageDefinition('request_confirmed').label));
    expect(text(markup)).toContain(t(locale, 'stage.request_confirmed.next'));
    expect(markup).toContain('tone-neutral');
    // The Request section sits between the facts and the next action.
    expect(markup.indexOf('project-facts')).toBeLessThan(markup.indexOf('request-section'));
    expect(markup.indexOf('request-section')).toBeLessThan(markup.indexOf('next-action'));
    // No destination: the next action is words, not a link.
    expect(markup).not.toContain(t(locale, 'project.nextLink'));
  });

  it('says in English that nothing has started and nothing was charged', () => {
    expect(translate('en', 'stage.request_confirmed.next')).toMatch(/Nothing has started and nothing was charged/);
  });

  it.each(locales)('is neutral about what comes next, in %s: a direct request is confirmed too, and it has no research to wait for', (locale) => {
    // On purpose changed (review patch D1): the sentence used to name the research as the next step, which is untrue for a confirmed direct request.
    expect(translate('en', 'stage.request_confirmed.next')).toBe('Your request is confirmed. The next steps arrive in a later release. Nothing has started and nothing was charged.');
    expect(t(locale, 'stage.request_confirmed.next')).not.toMatch(/research|מחקר/i);
  });
});

describe('PersonalizationSummary', () => {
  it('renders an empty wish as none', () => {
    expect(text(render('en', <PersonalizationSummary wish={storedPersonalization({kind: 'none'})}/>)).trim()).toBe('None requested.');
  });
});
