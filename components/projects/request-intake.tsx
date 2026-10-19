'use client';

import {useActionState, useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {confirmRequest, understandRequest} from '@/app/projects/new/actions';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {
  descriptionProblem,
  fieldText,
  lineProblem,
  maxDescriptionLength,
  maxOutcomeLength,
  maxScopeLength,
  maxWordingLength,
  storedPersonalization,
  wordingProblem,
  type FieldProblem,
  type IntakeField,
  type Personalization,
} from '@/lib/request-intake';
import {
  attemptConfirm,
  attemptUnderstand,
  browserStorage,
  commandIdFor,
  confirmIdle,
  forgetCommandId,
  limitOf,
  newCommandId,
  problemKey,
  problemOf,
  requestKey,
  understandIdle,
  type ConfirmState,
  type SubjectView,
  type UnderstandState,
} from '@/lib/request-view';
import {useShell} from '../shell/shell-context';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {Choice} from '../ui/choice';
import {Notice} from '../ui/states';
import {PersonalizationSummary} from './personalization-summary';

/** The text of a field problem, in the person's language. */
function useProblemText() {
  const {t} = useI18n();
  return (problem: FieldProblem) => t(problemKey(problem), {max: limitOf(problem.field)});
}

/** The first of these fields that has a problem, in the order the screen shows them. */
function firstProblem(problems: readonly FieldProblem[], order: readonly IntakeField[]): IntakeField | null {
  return order.find((field) => problems.some((problem) => problem.field === field)) ?? null;
}

/**
 * Where the flow starts. Only the tests give any of this (as Shell's `initial*` flags are only the tests'): they render a result the
 * server would have answered, to see a screen without a browser. A person's flow always starts empty.
 */
export type InitialIntake = {understood?: UnderstandState; description?: string; wording?: string; chosen?: string | null; confirmed?: ConfirmState};

/**
 * The text flow, in one narrow page (Story 2.1): C-02 (describe the model, with an optional personalization), then C-06 (the understood
 * request: confirm it, choose among several subjects, or learn that nothing fits). Understanding is free and deterministic and stores
 * nothing; Confirm is the one step that stores anything, and it starts nothing, approves nothing and spends nothing.
 *
 * Every value is kept in this component, so "Edit description" returns to C-02 with everything as it was. After each step focus moves
 * to the new heading, or to the first field with a problem; each result is announced through the page's live region.
 */
export function RequestIntake({initial = {}}: {initial?: InitialIntake} = {}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const {openCreatePicture} = useShell();
  const problemText = useProblemText();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const wordingRef = useRef<HTMLTextAreaElement>(null);
  const scopeRef = useRef<HTMLInputElement>(null);
  const outcomeRef = useRef<HTMLInputElement>(null);
  const choiceRef = useRef<HTMLFieldSetElement>(null);
  const checking = useRef(false);
  const confirming = useRef(false);
  const ids = {
    description: useId(),
    descriptionExample: useId(),
    descriptionHelp: useId(),
    descriptionError: useId(),
    wording: useId(),
    wordingExample: useId(),
    wordingHelp: useId(),
    wordingError: useId(),
    scope: useId(),
    scopeHelp: useId(),
    scopeError: useId(),
    outcome: useId(),
    outcomeHelp: useId(),
    outcomeError: useId(),
    choiceError: useId(),
  };

  // What the person typed. Controlled: React resets a form's uncontrolled fields when its action settles, which would take it away.
  const [description, setDescription] = useState(initial.description ?? '');
  const [wording, setWording] = useState(initial.wording ?? '');
  // Problems found here, before anything is sent (the server finds the same ones again, and more).
  const [local, setLocal] = useState<FieldProblem[]>([]);

  const [understood, understandForm, understanding] = useActionState(async (previous: UnderstandState, formData: FormData) => {
    try {
      return await attemptUnderstand(understandRequest, previous, formData);
    } finally {
      checking.current = false;
    }
  }, initial.understood ?? understandIdle);

  // The result the person went back from with Edit. A newer result (a new object) shows its own review again.
  const [editedFrom, setEditedFrom] = useState<UnderstandState | null>(null);
  const reviewable = understood.outcome === 'clear' || understood.outcome === 'ambiguous' || understood.outcome === 'no_match';
  const reviewing = reviewable && understood !== editedFrom;

  // Which subject, when the description fits several.
  const [chosen, setChosen] = useState<string | null>(initial.chosen ?? null);
  const subject: SubjectView | null =
    understood.outcome === 'clear' ? understood.subject : understood.outcome === 'ambiguous' ? (understood.matches.find((match) => match.id === chosen) ?? null) : null;

  // Scope and outcome are prefilled and the person edits them; an edit belongs to the subject it was made for.
  const [edits, setEdits] = useState<{subjectId: string; scope: string | null; outcome: string | null} | null>(null);
  const edited = subject && edits?.subjectId === subject.id ? edits : null;
  const scope = edited?.scope ?? subject?.displayName ?? '';
  const outcome = edited?.outcome ?? t('request.review.outcomeDefault');
  const [reviewProblems, setReviewProblems] = useState<FieldProblem[]>([]);

  // One command ID for each confirmation, chosen when Confirm is pressed (not as the person types) and kept for the request last sent: an
  // answer that was lost may have committed, and the retry must carry the very ID that was sent, so the database answers the original
  // receipt. Another request (any of what is sent differs) gets another ID. This is the one thing kept in memory about attempts; the
  // ID's life across tabs and reloads is request-view.ts's `commandIdFor`.
  const lastSent = useRef<{key: string; id: string} | null>(null);

  const [confirmed, confirmForm, saving] = useActionState(async (previous: ConfirmState, formData: FormData) => {
    try {
      const result = await attemptConfirm(confirmRequest, previous, formData);
      // A command ID the database says was used for something else, or whose Project is gone, cannot be used again: the next Confirm of
      // this request is a new command.
      if (result.outcome === 'reused' || result.outcome === 'gone') {
        const used = formData.get('commandId');
        forgetCommandId(typeof used === 'string' ? used : '', browserStorage());
        lastSent.current = null;
      }
      return result;
    } finally {
      confirming.current = false;
    }
  }, initial.confirmed ?? confirmIdle);

  // The problems of a step: found here, or by the server (until the person changes the words the server found them in). What Confirm
  // answered belongs to the review it was answered on: going back to the description and to a new review leaves none of it behind.
  const [typedSince, setTypedSince] = useState<UnderstandState | null>(null);
  const [confirmEdited, setConfirmEdited] = useState<ConfirmState | null>(null);
  const [confirmDismissed, setConfirmDismissed] = useState<ConfirmState | null>(null);
  const shownConfirm: ConfirmState = confirmed === confirmDismissed || (confirmed.outcome === 'invalid' && confirmEdited === confirmed) ? confirmIdle : confirmed;
  const describeProblems = local.length ? local : understood.outcome === 'invalid' && typedSince !== understood ? understood.problems : [];
  const shownReviewProblems = reviewProblems.length ? reviewProblems : shownConfirm.outcome === 'invalid' ? shownConfirm.problems : [];

  // After each step: say what happened and move focus to the new heading, or to the first thing to fix. Nothing here changes state. The
  // words and the announcer are read when a step happens (through a ref), not when they change: only a new result or going back is a step.
  const latest = useRef({announce, t, locale});
  useEffect(() => {
    latest.current = {announce, t, locale};
  });
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      return;
    }
    const {announce: say, t: words, locale: language} = latest.current;
    if (reviewing) {
      say(words(understood.outcome === 'clear' ? 'request.announce.clear' : understood.outcome === 'ambiguous' ? 'request.announce.ambiguous' : 'request.announce.noMatch'), language);
      headingRef.current?.focus();
    } else if (understood.outcome === 'invalid') {
      say(words('request.announce.invalid'), language);
      const field = firstProblem(understood.problems, ['description', 'personalization']);
      (field === 'personalization' ? wordingRef : descriptionRef).current?.focus();
    } else if (understood.outcome === 'unavailable') {
      say(words('request.checkFailed'), language);
    } else if (editedFrom !== null) {
      // Back from the review with Edit: the heading of the description step.
      headingRef.current?.focus();
    }
  }, [understood, editedFrom, reviewing]);

  useEffect(() => {
    if (confirmed.outcome === 'idle') return;
    const {announce: say, t: words, locale: language} = latest.current;
    if (confirmed.outcome === 'invalid' && confirmed.problems.length) {
      say(words('request.announce.invalid'), language);
      const field = firstProblem(confirmed.problems, ['subject', 'scope', 'outcome']);
      if (field === 'scope') scopeRef.current?.focus();
      else if (field === 'outcome') outcomeRef.current?.focus();
      else if (field === 'subject') choiceRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    } else {
      const key = confirmKey(confirmed);
      if (key) say(words(key), language);
    }
  }, [confirmed]);

  // C-02: Continue. The same checks the server makes are made first, so a field that is wrong is fixed without a round trip.
  const submitDescribe = (event: FormEvent<HTMLFormElement>) => {
    if (checking.current || understanding) {
      event.preventDefault();
      return;
    }
    const problems: FieldProblem[] = [];
    const descriptionIssue = descriptionProblem(fieldText(description));
    if (descriptionIssue) problems.push({field: 'description', problem: descriptionIssue});
    const wordingIssue = wordingProblem(fieldText(wording));
    if (wordingIssue) problems.push({field: 'personalization', problem: wordingIssue});
    setLocal(problems);
    if (problems.length) {
      event.preventDefault();
      announce(t('request.announce.invalid'), locale);
      (firstProblem(problems, ['description', 'personalization']) === 'personalization' ? wordingRef : descriptionRef).current?.focus();
      return;
    }
    checking.current = true;
  };

  // C-06: Confirm.
  const submitConfirm = (event: FormEvent<HTMLFormElement>) => {
    if (confirming.current || saving) {
      event.preventDefault();
      return;
    }
    const problems: FieldProblem[] = [];
    const scopeIssue = lineProblem(fieldText(scope), maxScopeLength);
    if (scopeIssue) problems.push({field: 'scope', problem: scopeIssue});
    const outcomeIssue = lineProblem(fieldText(outcome), maxOutcomeLength);
    if (outcomeIssue) problems.push({field: 'outcome', problem: outcomeIssue});
    setReviewProblems(problems);
    if (problems.length) {
      event.preventDefault();
      announce(t('request.announce.invalid'), locale);
      (firstProblem(problems, ['scope', 'outcome']) === 'outcome' ? outcomeRef : scopeRef).current?.focus();
      return;
    }
    // The command ID is chosen now: the one this request was last sent with (a retry), or a new one. The same request confirmed in another
    // tab a moment ago is the same command: take its ID, so the second Confirm is answered with the first's Project and creates nothing.
    // (The form is read after this handler, so the field carries it.)
    const key = requestKey([fieldText(description), fieldText(wording), subject?.id ?? '', fieldText(scope), fieldText(outcome)]);
    const proposed = lastSent.current?.key === key ? lastSent.current.id : newCommandId();
    const chosenId = commandIdFor(key, proposed, browserStorage());
    const field = event.currentTarget.elements.namedItem('commandId');
    if (field instanceof HTMLInputElement) field.value = chosenId;
    lastSent.current = {key, id: chosenId};
    confirming.current = true;
    announce(t('request.announce.saving'), locale);
  };

  const edit = () => {
    setEditedFrom(understood);
    setReviewProblems([]);
    // What the last Confirm answered was about the review being left: it must not greet the next one.
    setConfirmDismissed(confirmed);
    announce(t('request.announce.edit'), locale);
  };

  const wish: Personalization | null = understood.outcome === 'clear' || understood.outcome === 'ambiguous' ? understood.personalization : null;

  const fieldError = (problems: readonly FieldProblem[], field: IntakeField, id: string) => {
    const kind = problemOf(problems, field);
    return kind ? <div className="invite-notice"><Notice id={id} tone="danger">{problemText({field, problem: kind})}</Notice></div> : null;
  };
  const describedBy = (...parts: (string | false)[]) => parts.filter(Boolean).join(' ');

  const unavailable = understood.outcome === 'unavailable';

  return (
    <div className="page page-narrow request-page">
      <p className="eyebrow">{t('request.eyebrow')}</p>
      <h1 ref={headingRef} tabIndex={-1} className="request-title">
        {reviewing ? (understood.outcome === 'no_match' ? t('request.noMatch.title') : understood.outcome === 'ambiguous' && !subject ? t('request.ambiguous.title') : t('request.review.title')) : t('request.title')}
      </h1>

      {!reviewing ? (
        <>
          <p className="lede">{t('request.lede')}</p>
          <form action={understandForm} onSubmit={submitDescribe} noValidate className="invite-form request-form">
            <div className="invite-field">
              <label htmlFor={ids.description} className="auth-label">{t('request.description.label')}</label>
              <p id={ids.descriptionExample} className="auth-hint">{t('request.description.example')}</p>
              <textarea
                ref={descriptionRef}
                id={ids.description}
                name="description"
                className="invite-input"
                dir="auto"
                rows={5}
                value={description}
                autoComplete="off"
                aria-required="true"
                aria-describedby={describedBy(ids.descriptionExample, ids.descriptionHelp, !!problemOf(describeProblems, 'description') && ids.descriptionError)}
                aria-invalid={problemOf(describeProblems, 'description') ? true : undefined}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setTypedSince(understood);
                  if (local.length) setLocal([]);
                }}
              />
              <p id={ids.descriptionHelp} className="auth-hint">{t('request.description.help', {max: maxDescriptionLength})}</p>
              {fieldError(describeProblems, 'description', ids.descriptionError)}
            </div>
            <div className="invite-field">
              <label htmlFor={ids.wording} className="auth-label">{t('request.personalization.label')}</label>
              <p id={ids.wordingExample} className="auth-hint">{t('request.personalization.example')}</p>
              <textarea
                ref={wordingRef}
                id={ids.wording}
                name="personalization"
                className="invite-input"
                dir="auto"
                rows={2}
                value={wording}
                autoComplete="off"
                aria-describedby={describedBy(ids.wordingExample, ids.wordingHelp, !!problemOf(describeProblems, 'personalization') && ids.wordingError)}
                aria-invalid={problemOf(describeProblems, 'personalization') ? true : undefined}
                onChange={(event) => {
                  setWording(event.target.value);
                  setTypedSince(understood);
                  if (local.length) setLocal([]);
                }}
              />
              <p id={ids.wordingHelp} className="auth-hint">{t('request.personalization.help')} {t('request.limit', {max: maxWordingLength})}</p>
              {fieldError(describeProblems, 'personalization', ids.wordingError)}
            </div>
            {unavailable && !understanding ? <div className="invite-notice"><Notice tone="danger" role="alert">{t('request.checkFailed')}</Notice></div> : null}
            <Button variant="primary" type="submit" iconAfter="arrow" aria-disabled={understanding ? true : undefined}>{t('request.continue')}</Button>
            <p className="auth-hint auth-status" role="status">{understanding ? t('request.checking') : null}</p>
          </form>
        </>
      ) : understood.outcome === 'no_match' ? (
        <div className="request-review">
          <p className="lede">{t('request.noMatch.body')}</p>
          <ul className="request-subjects">
            {understood.subjects.map((supported) => <li key={supported.id}><bdi>{supported.displayName}</bdi></li>)}
          </ul>
          <p>{t('request.noMatch.hint')}</p>
          <div className="request-actions">
            <Button variant="primary" onClick={edit}>{t('request.noMatch.edit')}</Button>
            <Button variant="secondary" icon="image" onClick={openCreatePicture}>{t('request.noMatch.picture')}</Button>
          </div>
        </div>
      ) : (
        <div className="request-review">
          {understood.outcome === 'ambiguous' ? (
            <>
              <p className="lede">{t('request.ambiguous.body')}</p>
              <fieldset ref={choiceRef} className="choice-group request-choice" aria-describedby={problemOf(shownReviewProblems, 'subject') ? ids.choiceError : undefined}>
                <legend className="visually-hidden">{t('request.ambiguous.title')}</legend>
                {understood.matches.map((match) => (
                  <Choice key={match.id} name="subject" value={match.id} checked={chosen === match.id} onChange={() => setChosen(match.id)}>
                    <strong><bdi>{match.displayName}</bdi></strong>
                  </Choice>
                ))}
              </fieldset>
              {fieldError(shownReviewProblems, 'subject', ids.choiceError)}
            </>
          ) : (
            <p className="lede">{t('request.review.lede')}</p>
          )}

          {subject ? (
            <form action={confirmForm} onSubmit={submitConfirm} noValidate className="invite-form request-form">
              <input type="hidden" name="commandId" defaultValue=""/>
              <input type="hidden" name="description" value={description}/>
              <input type="hidden" name="personalization" value={wording}/>
              <input type="hidden" name="subjectId" value={subject.id}/>
              {understood.outcome === 'ambiguous' ? <p className="lede">{t('request.review.lede')}</p> : null}
              {understood.outcome === 'ambiguous' ? null : fieldError(shownReviewProblems, 'subject', ids.choiceError)}
              {(['description', 'personalization'] as const).map((field) => {
                // These fields are on the other step: the problem is told here, with the way back to it (every value is kept).
                const kind = problemOf(shownReviewProblems, field);
                return kind ? (
                  <div className="invite-notice" key={field}>
                    <Notice tone="danger" role="alert" action={<Button variant="secondary" onClick={edit}>{t('request.review.edit')}</Button>}>
                      {problemText({field, problem: kind})}
                    </Notice>
                  </div>
                ) : null;
              })}
              <dl className="project-facts request-facts">
                <div>
                  <dt>{t('request.review.subject')}</dt>
                  <dd><bdi>{subject.displayName}</bdi></dd>
                </div>
                <div>
                  <dt>{t('request.review.mode')}</dt>
                  <dd>{t('request.mode.evidence_text')}</dd>
                </div>
                <div>
                  <dt>{t('request.review.description')}</dt>
                  <dd className="request-quote"><bdi>{description}</bdi></dd>
                </div>
                <div>
                  <dt>{t('request.review.personalization')}</dt>
                  <dd className="request-wish">{wish ? <PersonalizationSummary wish={storedPersonalization(wish)}/> : null}</dd>
                </div>
              </dl>
              <div className="invite-field request-field">
                <label htmlFor={ids.scope} className="auth-label">{t('request.review.scope')}</label>
                <input
                  ref={scopeRef}
                  id={ids.scope}
                  name="scope"
                  type="text"
                  className="invite-input"
                  dir="auto"
                  value={scope}
                  autoComplete="off"
                  aria-required="true"
                  aria-describedby={describedBy(ids.scopeHelp, !!problemOf(shownReviewProblems, 'scope') && ids.scopeError)}
                  aria-invalid={problemOf(shownReviewProblems, 'scope') ? true : undefined}
                  onChange={(event) => {
                    setEdits({subjectId: subject.id, scope: event.target.value, outcome: edited?.outcome ?? null});
                    setConfirmEdited(confirmed);
                    setReviewProblems([]);
                  }}
                />
                <p id={ids.scopeHelp} className="auth-hint">{t('request.review.scopeHelp')}</p>
                {fieldError(shownReviewProblems, 'scope', ids.scopeError)}
              </div>
              <div className="invite-field request-field">
                <label htmlFor={ids.outcome} className="auth-label">{t('request.review.outcome')}</label>
                <input
                  ref={outcomeRef}
                  id={ids.outcome}
                  name="outcome"
                  type="text"
                  className="invite-input"
                  dir="auto"
                  value={outcome}
                  autoComplete="off"
                  aria-required="true"
                  aria-describedby={describedBy(ids.outcomeHelp, !!problemOf(shownReviewProblems, 'outcome') && ids.outcomeError)}
                  aria-invalid={problemOf(shownReviewProblems, 'outcome') ? true : undefined}
                  onChange={(event) => {
                    setEdits({subjectId: subject.id, scope: edited?.scope ?? null, outcome: event.target.value});
                    setConfirmEdited(confirmed);
                    setReviewProblems([]);
                  }}
                />
                <p id={ids.outcomeHelp} className="auth-hint">{t('request.review.outcomeHelp')}</p>
                {fieldError(shownReviewProblems, 'outcome', ids.outcomeError)}
              </div>
              <p className="project-muted request-note">{t('request.review.confirmNote')}</p>
              {confirmFailure(shownConfirm, t)}
              <div className="request-actions">
                <Button variant="primary" type="submit" aria-disabled={saving ? true : undefined}>{t('request.review.confirm')}</Button>
                <Button variant="secondary" onClick={edit}>{t('request.review.edit')}</Button>
              </div>
              <p className="auth-hint auth-status" role="status">{saving ? t('request.confirm.pending') : null}</p>
            </form>
          ) : (
            <div className="request-actions">
              <Button variant="secondary" onClick={edit}>{t('request.review.edit')}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The message of an answer to Confirm that did not go through, or null when it needs none (nothing yet). An `invalid` answer with no
 * problem to point at (a form that is not the screen's) is the same as the description no longer fitting: review it again.
 */
function confirmKey(state: ConfirmState): MessageKey | null {
  switch (state.outcome) {
    case 'invalid':
      return state.problems.length ? 'request.confirm.invalid' : 'request.confirm.changed';
    case 'changed':
      return 'request.confirm.changed';
    case 'reused':
      return 'request.confirm.reused';
    case 'gone':
      return 'request.confirm.gone';
    case 'unavailable':
      return state.unknown ? 'request.confirm.unknown' : 'request.confirm.unavailable';
    default:
      return null;
  }
}

function confirmFailure(state: ConfirmState, t: (key: MessageKey) => string) {
  const key = confirmKey(state);
  if (!key) return null;
  return (
    <div className="invite-notice">
      <Notice tone="danger" role="alert">{t(key)}</Notice>
    </div>
  );
}
