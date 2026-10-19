'use client';

import {useActionState, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent} from 'react';
import {recordPictureReview} from '@/app/projects/[projectId]/pictures/review/actions';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {decodePicture} from '@/lib/picture-decode';
import {loadPicture, releaseFiles} from '@/lib/picture-fetch';
import {
  blurText,
  percentOf,
  thresholds,
  viewLabels,
  isViewLabel,
  type QualityProblem,
  type ViewLabel,
} from '@/lib/picture-quality';
import {
  badgeKeys,
  coverageOf,
  firstStepIssue,
  incompleteKey,
  incompleteSentences,
  itemsIncomplete,
  labelKeys,
  listOf,
  problemsOf,
  reasonRetryable,
  reviewFields,
  reviewItems,
  unusableRemedy,
  updateReviewItem,
  type FirstStepIssue,
  type ReviewItem,
  type ReviewableImage,
  type UnusableReason,
} from '@/lib/picture-review';
import {formatBytes, formatParams, typeLabel} from '@/lib/picture-set';
import {canHash} from '@/lib/picture-upload';
import {
  attemptReview,
  browserStorage,
  commandIdFor,
  forgetCommandId,
  newCommandId,
  requestKey,
  reviewIdle,
  reviewKey,
  settleReview,
  type ReviewState,
} from '@/lib/picture-view';
import {picturesPath, projectPath, type RequestPicture} from '@/lib/project-view';
import type {RequestMode} from '@/lib/request-intake';
import {fieldText, lineProblem, maxOutcomeLength, maxScopeLength} from '@/lib/request-intake';
import {limitOf, problemKey} from '@/lib/request-view';
import {useAnnounce} from '../ui/announcer';
import {Button, LinkButton} from '../ui/button';
import {Choice} from '../ui/choice';
import {Icon} from '../ui/icon';
import {StatusBadge} from '../ui/status-badge';
import {Notice} from '../ui/states';
import {LtrToken} from '../ui/text-span';

/** The two ways pictures can be used: `evidence_images` (research-assisted reconstruction) and `image_direct` (direct image-derived conversion). */
export type PathChoice = 'evidence_images' | 'image_direct';
type Step = 1 | 2 | 3;
const steps = 3;

/**
 * Where the screen starts. Only the tests give any of this (as the text flow's `initial` is only the tests'): they render a state the browser would reach, to see a
 * screen without one. A person's screen always starts at the first step, with the pictures waiting to be measured, no path chosen and nothing confirmed.
 */
export type InitialReview = {
  step?: Step;
  items?: ReviewItem[];
  obstruction?: boolean;
  choice?: PathChoice | null;
  scope?: string;
  outcome?: string;
  acknowledged?: boolean;
  /** The first step was tried (Next was pressed), so its issue is shown. */
  tried?: boolean;
  /** The second step was tried, so its issue is shown. */
  chose?: boolean;
  /** The Confirm of the last step was tried with an acknowledgment missing. */
  confirmTried?: boolean;
  state?: ReviewState;
  /** Whether the pictures are measured when the screen opens (the default). The tests switch it off to see a state without a browser. */
  measure?: boolean;
  /** Whether the page can hash a file (otherwise decided after hydration: a secure context is required). */
  secure?: boolean;
};

/** What the screen needs of the Project's request: the revision reviewed (its `seq` is the command's expected revision), its mode, whether it is confirmed, and its pictures. */
export type ReviewedRequest = {
  seq: number;
  mode: RequestMode;
  confirmed: boolean;
  scope: string | null;
  outcome: string | null;
  images: RequestPicture[];
};

const never = () => () => undefined;

const measureKeys = {resolution: 'review.measure.resolution', blur: 'review.measure.blur', exposure: 'review.measure.exposure'} as const satisfies Record<QualityProblem, MessageKey>;
const remedyKeys = {resolution: 'review.remedy.resolution', blur: 'review.remedy.blur', exposure: 'review.remedy.exposure'} as const satisfies Record<QualityProblem, MessageKey>;
const detailKeys = {resolution: 'review.detail.resolution', blur: 'review.detail.blur', exposure: 'review.detail.exposure'} as const satisfies Record<QualityProblem, MessageKey>;

const unusableKeys = {
  lapsed: 'review.unusable.lapsed',
  changed: 'review.unusable.changed',
  reload: 'review.unusable.reload',
  refused: 'review.unusable.refused',
  unavailable: 'review.unusable.unavailable',
  network: 'review.unusable.network',
  undecodable: 'review.unusable.undecodable',
  too_large_pixels: 'review.unusable.too_large_pixels',
  busy: 'review.unusable.busy',
} as const satisfies Record<UnusableReason, MessageKey>;

const fixKeys = {replace: 'review.unusable.fix', smaller: 'review.unusable.fixSmaller'} as const satisfies Record<'replace' | 'smaller', MessageKey>;

const issueKeys = {
  busy: 'review.issue.busy',
  unusable: 'review.issue.unusable',
  labels: 'review.issue.labels',
  obstruction: 'review.obstruction.remedy',
} as const satisfies Record<FirstStepIssue, MessageKey>;

/**
 * The review of a Project's pictures (Story 2.3): C-04 (quality and coverage), C-05 (the choice of path) and the picture variant of C-06 (the confirmation), in three
 * steps with Back and Next. Every picture is measured HERE, in the browser, one at a time: from the File the picture screen handed over when it has one, and otherwise
 * (after a reload) by a single-use download ticket whose bytes are hashed against the saved SHA-256 and decoded in memory (lib/picture-fetch.ts). What is measured
 * is a claim the database stores and cross-checks only for completeness; nothing is sent to be checked, and nothing is converted, researched, retained or paid for.
 *
 * Direct conversion confirms a scope and an outcome here, and, when the inputs are incomplete, needs the explicit Generate anyway acknowledgment. Research-assisted
 * reconstruction records the choice and nothing more (the subject is identified and the scope confirmed in a later step). Confirming approves no plan and
 * authorizes no cost. After a step focus moves to the new heading, or to the first thing to fix; each result is announced through the page's live region.
 */
export function PictureReview({project, request, initial = {}}: {project: {id: string; title: string}; request: ReviewedRequest; initial?: InitialReview}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const issueRef = useRef<HTMLDivElement>(null);
  const choiceRef = useRef<HTMLFieldSetElement>(null);
  const scopeRef = useRef<HTMLInputElement>(null);
  const outcomeRef = useRef<HTMLInputElement>(null);
  const acknowledgeRef = useRef<HTMLInputElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const ids = {
    obstruction: useId(),
    obstructionHelp: useId(),
    issue: useId(),
    choiceError: useId(),
    scope: useId(),
    scopeHelp: useId(),
    scopeError: useId(),
    outcome: useId(),
    outcomeHelp: useId(),
    outcomeError: useId(),
    acknowledge: useId(),
    acknowledgeError: useId(),
    coverage: useId(),
  };

  // The pictures: kept in a ref as well, so a measurement that finishes later reads them as they are then, not as they were when it began.
  const [items, setItems] = useState<ReviewItem[]>(() => initial.items ?? reviewItems(request.images as ReviewableImage[]));
  const itemsRef = useRef(items);
  const commit = (next: ReviewItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  const [step, setStep] = useState<Step>(initial.step ?? 1);
  const [obstruction, setObstruction] = useState(initial.obstruction ?? false);
  const [choice, setChoice] = useState<PathChoice | null>(initial.choice ?? null);
  const [edits, setEdits] = useState<{scope: string | null; outcome: string | null}>({scope: initial.scope ?? null, outcome: initial.outcome ?? null});
  // The acknowledgment is given for the facts the warning states (lib/picture-review.ts `incompleteKey`): it is void when they change, whatever changed them.
  const [acknowledgedFor, setAcknowledgedFor] = useState<string | null>(() => (initial.acknowledged ? incompleteKey(initial.items ?? reviewItems(request.images as ReviewableImage[])) : null));
  const [tried, setTried] = useState(initial.tried ?? false);
  const [chose, setChose] = useState(initial.chose ?? false);
  const [confirmTried, setConfirmTried] = useState(initial.confirmTried ?? false);
  const [fieldProblems, setFieldProblems] = useState<{field: 'scope' | 'outcome'; problem: 'empty' | 'too_long' | 'control'}[]>([]);
  // The answer to Confirm that the person has moved on from (they changed something after it): it is not shown any more.
  const [dismissed, setDismissed] = useState<ReviewState | null>(null);

  const secureHere = useSyncExternalStore(never, () => canHash(), () => true);
  const secure = initial.secure ?? secureHere;

  const mounted = useRef(false);
  const confirming = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const lastSent = useRef<{key: string; id: string} | null>(null);

  const latest = useRef({announce, t, locale});
  useEffect(() => {
    latest.current = {announce, t, locale};
  });
  const say = (key: MessageKey, params?: Record<string, string | number>) => {
    const {announce: speak, t: words, locale: language} = latest.current;
    speak(words(key, params), language);
  };

  // Measuring ----------------------------------------------------------------------------------------------------------------

  /**
   * Measures ONE picture: from the File the picture screen handed over (checked against the saved SHA-256), or else read back through a download ticket and checked;
   * then decoded in memory. Its bytes are let go of before the next picture is asked for. What came of it is put in the picture, or, when the screen has gone, dropped.
   */
  const measureOne = async (key: string, signal: AbortSignal) => {
    const item = itemsRef.current.find((candidate) => candidate.key === key);
    if (!item || item.state !== 'measuring') return;
    const settle = (patch: Partial<Omit<ReviewItem, 'key' | 'position'>>) => {
      if (!mounted.current || signal.aborted) {
        if (patch.thumbnailUrl) URL.revokeObjectURL(patch.thumbnailUrl);
        return;
      }
      if (patch.thumbnailUrl) urls.current.add(patch.thumbnailUrl);
      commit(updateReviewItem(itemsRef.current, key, patch));
    };

    // The File the picture screen handed over (checked against the saved SHA-256) or else the picture read back by a ticket (checked as well): lib/picture-fetch.ts.
    const loaded = await loadPicture({uploadId: item.uploadId, sha256: item.sha256, length: item.length}, {signal});
    if (!loaded.ok) return settle({state: 'unusable', reason: loaded.problem, measurements: null});
    const decoded = await decodePicture(loaded.blob);
    if (!decoded.ok) return settle({state: 'unusable', reason: decoded.problem, measurements: null});
    settle({state: 'measured', reason: null, measurements: decoded.measurements, thumbnailUrl: decoded.thumbnail ? URL.createObjectURL(decoded.thumbnail) : null});
  };

  /** Says, once no picture is waiting any more, that they are measured (and how many cannot be used). */
  const announceMeasured = (signal: AbortSignal) => {
    if (signal.aborted || itemsRef.current.some((candidate) => candidate.state === 'measuring')) return;
    const unusable = itemsRef.current.filter((candidate) => candidate.state === 'unusable').length;
    say(unusable ? 'review.announce.someUnusable' : 'review.announce.allMeasured', {count: unusable});
  };

  useEffect(() => {
    mounted.current = true;
    const running = new AbortController();
    controller.current = running;
    const collected = urls.current;
    // Where this page cannot hash a file (an insecure context) nothing is read or measured: a picture that cannot be checked against what was saved is not used.
    if (initial.measure !== false && (initial.secure ?? canHash())) {
      void (async () => {
        for (const item of itemsRef.current.filter((candidate) => candidate.state === 'measuring')) {
          if (running.signal.aborted) return;
          await measureOne(item.key, running.signal);
        }
        announceMeasured(running.signal);
      })();
    }
    return () => {
      mounted.current = false;
      running.abort();
      for (const url of collected) URL.revokeObjectURL(url);
      collected.clear();
      // The Files the picture screen handed over are let go of with the screen.
      releaseFiles();
    };
    // The pipeline starts once, with the pictures the screen opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = (key: string) => {
    const running = controller.current;
    if (!running || running.signal.aborted) return;
    commit(updateReviewItem(itemsRef.current, key, {state: 'measuring', reason: null}));
    void measureOne(key, running.signal).then(() => announceMeasured(running.signal));
  };

  // Moving between the steps --------------------------------------------------------------------------------------------------

  const issue: FirstStepIssue | null = firstStepIssue(items, obstruction);
  const incompleteNow = itemsIncomplete(items);
  const acknowledged = acknowledgedFor !== null && acknowledgedFor === incompleteKey(items);
  const direct = choice === 'image_direct';
  const scope = edits.scope ?? request.scope ?? t('review.scopeDefault');
  const outcome = edits.outcome ?? request.outcome ?? t('review.outcomeDefault');

  const [reviewed, reviewForm, saving] = useActionState(async (previous: ReviewState, formData: FormData) => {
    try {
      const result = await attemptReview(recordPictureReview, previous, formData);
      const settled = settleReview(result);
      if (settled.forgetCommand) {
        const used = formData.get('commandId');
        forgetCommandId(typeof used === 'string' ? used : '', browserStorage());
        lastSent.current = null;
      }
      if (settled.failed) {
        say('review.announce.failed');
        if (result.outcome === 'invalid' && result.problems.length) {
          setFieldProblems(result.problems);
          (result.problems[0].field === 'outcome' ? outcomeRef : scopeRef).current?.focus();
        }
      }
      return result;
    } finally {
      confirming.current = false;
    }
  }, initial.state ?? reviewIdle);

  const moveTo = (next: Step) => {
    setStep(next);
    setDismissed(reviewed);
    say('review.announce.step', {step: next, count: steps});
  };

  // After a step: focus the new heading (the issue, when there is one). Nothing here changes state.
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const next = () => {
    if (step === 1) {
      setTried(true);
      if (issue) {
        say('review.announce.issue');
        window.setTimeout(() => issueRef.current?.focus(), 0);
        return;
      }
      moveTo(2);
      return;
    }
    if (step === 2) {
      if (!choice) {
        setChose(true);
        say('review.announce.issue');
        window.setTimeout(() => choiceRef.current?.querySelector<HTMLInputElement>('input')?.focus(), 0);
        return;
      }
      moveTo(3);
    }
  };

  const back = () => {
    if (step === 2) moveTo(1);
    else if (step === 3) moveTo(2);
  };

  const touched = () => {
    setDismissed(reviewed);
    setFieldProblems([]);
    setConfirmTried(false);
  };

  // Confirm: the same checks the server makes are made first, so a field that is wrong is fixed without a round trip.
  const submitConfirm = (event: FormEvent<HTMLFormElement>) => {
    if (confirming.current || saving) {
      event.preventDefault();
      return;
    }
    if (!choice || issue) {
      event.preventDefault();
      return;
    }
    const problems: {field: 'scope' | 'outcome'; problem: 'empty' | 'too_long' | 'control'}[] = [];
    if (direct) {
      const scopeIssue = lineProblem(fieldText(scope), maxScopeLength);
      if (scopeIssue && scopeIssue !== 'not_a_match') problems.push({field: 'scope', problem: scopeIssue});
      const outcomeIssue = lineProblem(fieldText(outcome), maxOutcomeLength);
      if (outcomeIssue && outcomeIssue !== 'not_a_match') problems.push({field: 'outcome', problem: outcomeIssue});
    }
    setFieldProblems(problems);
    if (problems.length) {
      event.preventDefault();
      say('review.announce.failed');
      (problems[0].field === 'outcome' ? outcomeRef : scopeRef).current?.focus();
      return;
    }
    if (direct && incompleteNow && !acknowledged) {
      event.preventDefault();
      setConfirmTried(true);
      say('review.announce.failed');
      acknowledgeRef.current?.focus();
      return;
    }
    // The command ID is chosen now: the one this review was last sent with (a retry after an answer was lost), or a new one. The same review confirmed in another tab a
    // moment ago is the same command. (The form is read after this handler, so the field carries it.)
    const fields = reviewFields(items);
    const key = requestKey([
      project.id,
      String(request.seq),
      choice,
      direct ? fieldText(scope) : '',
      direct ? fieldText(outcome) : '',
      obstruction ? 'o' : '',
      direct && incompleteNow && acknowledged ? 'a' : '',
      ...fields.flatMap((field) => [field.uploadId, field.label, field.shortEdge, field.blur, field.clipped]),
    ]);
    const proposed = lastSent.current?.key === key ? lastSent.current.id : newCommandId();
    const chosen = commandIdFor(key, proposed, browserStorage());
    const field = event.currentTarget.elements.namedItem('commandId');
    if (field instanceof HTMLInputElement) field.value = chosen;
    lastSent.current = {key, id: chosen};
    confirming.current = true;
    say('review.announce.saving');
  };

  // The answer to Confirm: a failure is told, and focus goes to it (a field problem is focused by the action's callback).
  const failureKey = reviewed === dismissed ? null : reviewKey(reviewed);
  const failurePosition = 'position' in reviewed ? reviewed.position : 0;
  useEffect(() => {
    if (failureKey) failureRef.current?.focus();
  }, [failureKey, reviewed]);

  // The screen --------------------------------------------------------------------------------------------------------------

  const coverage = coverageOf(items);
  const labelledViews = coverage.views.map((label) => t(labelKeys[label]));
  const measuredCount = items.filter((item) => item.state === 'measured').length;
  const confirmed = request.confirmed;
  // A confirmed request's pictures cannot be changed here yet: its first-step message about a picture that cannot be used does not send the person to fix it there.
  const issueText = issue ? t(issue === 'unusable' && confirmed ? 'review.issue.unusableConfirmed' : issueKeys[issue]) : '';
  const shownIssue = tried && issue ? issue : null;
  const title =
    step === 1 ? t('review.title.check') : step === 2 ? t('review.title.choose') : direct ? t('review.title.confirmDirect') : t('review.title.confirmResearch');

  // Where this page cannot hash a file (an insecure context) a saved picture cannot be checked against what was saved, so nothing is read or measured and there is
  // nothing to go on with: the warning says why, and the way back to the Project is all there is.
  if (!secure) {
    return (
      <div className="page page-narrow picture-page review-page">
        <p className="eyebrow">
          {t('review.eyebrow')} · <bdi>{project.title}</bdi>
        </p>
        <h1 ref={headingRef} tabIndex={-1} className="request-title">
          {t('review.title.check')}
        </h1>
        <div className="invite-notice">
          <Notice tone="warning" role="note">
            <strong>{t('picture.secure.title')}</strong> {t('picture.secure.body', {scheme: 'https'})}
          </Notice>
        </div>
        <div className="request-actions review-nav">
          <LinkButton variant="quiet" icon="back" href={projectPath(project.id)}>{t('review.back.project')}</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow picture-page review-page">
      <p className="eyebrow">
        {t('review.eyebrow')} · <bdi>{project.title}</bdi>
      </p>
      <p className="review-step">{t('review.step', {step, count: steps})}</p>
      <h1 ref={headingRef} tabIndex={-1} className="request-title">
        {title}
      </h1>

      {step === 1 ? (
        <section className="review-step-body" aria-label={t('review.title.check')}>
          <p className="lede">{t('review.lede.check')}</p>
          <p className="auth-hint">{t('review.privacy')}</p>

          <h2 className="review-list-title">{t('picture.list.title')}</h2>
          <p className="auth-hint">{t('review.label.help')}</p>
          <ol className="picture-list review-list">
            {items.map((item, index) => (
              <ReviewPicture
                key={item.key}
                item={item}
                count={items.length}
                index={index}
                projectId={project.id}
                confirmed={confirmed}
                tried={tried}
                onLabel={(label) => {
                  commit(updateReviewItem(itemsRef.current, item.key, {label}));
                  // A label changes what the warning covers: the acknowledgment given for the old one is void.
                  setAcknowledgedFor(null);
                  setDismissed(reviewed);
                }}
                onRetry={retry}
              />
            ))}
          </ol>

          <section className="review-coverage section" aria-labelledby={ids.coverage} data-coverage={coverage.met ? 'sufficient' : 'insufficient'}>
            <h2 id={ids.coverage}>{t('review.coverage.title')}</h2>
            <p>
              <StatusBadge tone={coverage.met ? 'success' : 'warning'}>{coverage.met ? t('review.coverage.badge.sufficient') : t('review.coverage.badge.insufficient')}</StatusBadge>
            </p>
            <p>{t('review.coverage.count', {count: coverage.count, needed: coverage.needed})}</p>
            <p>{labelledViews.length ? t('review.coverage.shown', {views: listOf(t, labelledViews)}) : t('review.coverage.shownNone')}</p>
            <p className="project-muted">{t('review.coverage.detailNote')}</p>
            {coverage.met ? (
              <p>{t('review.coverage.sufficientNote')}</p>
            ) : (
              <div className="review-add" data-state="additional-view-requested">
                {coverage.missing.length ? <p><strong>{t('review.coverage.add', {views: listOf(t, coverage.missing.map((label) => t(labelKeys[label])))})}</strong></p> : null}
                <p>{t('review.coverage.directNeeds')}</p>
                <p className="project-muted">{t('review.coverage.researchNote')}</p>
                {!confirmed ? (
                  <div className="request-actions">
                    <LinkButton variant="secondary" icon="image" href={picturesPath(project.id)}>{t('review.coverage.addButton')}</LinkButton>
                  </div>
                ) : (
                  <p className="project-muted">{t('review.coverage.addLocked')}</p>
                )}
              </div>
            )}
          </section>

          <section className="review-obstruction section" aria-labelledby={`${ids.obstruction}-title`}>
            <h2 id={`${ids.obstruction}-title`}>{t('review.obstruction.title')}</h2>
            <label className="review-checkbox" htmlFor={ids.obstruction}>
              <input
                id={ids.obstruction}
                type="checkbox"
                checked={obstruction}
                aria-describedby={[ids.obstructionHelp, shownIssue === 'obstruction' ? ids.issue : null].filter(Boolean).join(' ')}
                aria-invalid={shownIssue === 'obstruction' ? true : undefined}
                onChange={(event) => {
                  setObstruction(event.target.checked);
                  setDismissed(reviewed);
                }}
              />
              <span>{t('review.obstruction.label')}</span>
            </label>
            <p id={ids.obstructionHelp} className="auth-hint">{t('review.obstruction.help')}</p>
          </section>

          {shownIssue ? (
            <div className="invite-notice" ref={issueRef} tabIndex={-1} id={ids.issue}>
              <Notice tone="danger" role="alert">{issueText}</Notice>
            </div>
          ) : null}

          <p className="project-muted request-note" aria-live="polite">
            {t('review.measured', {measured: measuredCount, count: items.length})}
          </p>
          <div className="request-actions review-nav">
            <Button variant="primary" iconAfter="arrow" onClick={next}>{t('review.next')}</Button>
            <LinkButton variant="quiet" icon="back" href={projectPath(project.id)}>{t('review.back.project')}</LinkButton>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="review-step-body" aria-label={t('review.title.choose')}>
          <p className="lede">{t('review.choose.lede')}</p>
          <fieldset
            ref={choiceRef}
            className="choice-group review-paths"
            aria-describedby={chose && !choice ? ids.choiceError : undefined}
          >
            <legend className="review-legend">{t('review.choose.legend')}</legend>
            <Choice name="path" value="image_direct" checked={choice === 'image_direct'} onChange={() => { setChoice('image_direct'); setAcknowledgedFor(null); setChose(false); setDismissed(reviewed); }}>
              <span className="review-path">
                <strong className="review-path-title">{t('review.path.direct.title')}</strong>
                <span>{t('review.path.direct.body')}</span>
                <span><strong>{t('review.path.accuracy')}</strong> {t('review.path.direct.accuracy')}</span>
                <span><strong>{t('review.path.plan')}</strong> {t('review.path.direct.plan')}</span>
                <span><strong>{t('review.path.offline')}</strong> {t('review.path.direct.offline')}</span>
              </span>
            </Choice>
            <Choice name="path" value="evidence_images" checked={choice === 'evidence_images'} onChange={() => { setChoice('evidence_images'); setAcknowledgedFor(null); setChose(false); setDismissed(reviewed); }}>
              <span className="review-path">
                <strong className="review-path-title">{t('review.path.research.title')}</strong>
                <span>{t('review.path.research.body')}</span>
                <span><strong>{t('review.path.accuracy')}</strong> {t('review.path.research.accuracy')}</span>
                <span><strong>{t('review.path.plan')}</strong> {t('review.path.research.plan')}</span>
                <span><strong>{t('review.path.offline')}</strong> {t('review.path.research.offline')}</span>
              </span>
            </Choice>
          </fieldset>
          {chose && !choice ? (
            <div className="invite-notice">
              <Notice id={ids.choiceError} tone="danger" role="alert">{t('review.choose.error')}</Notice>
            </div>
          ) : null}
          <p className="project-muted request-note">{t('review.choose.note')}</p>
          <div className="request-actions review-nav">
            <Button variant="primary" iconAfter="arrow" onClick={next}>{t('review.next')}</Button>
            <Button variant="secondary" icon="back" onClick={back}>{t('review.back')}</Button>
          </div>
        </section>
      ) : null}

      {step === 3 && choice ? (
        <form action={reviewForm} onSubmit={submitConfirm} noValidate className="invite-form request-form review-confirm" aria-label={title}>
          <input type="hidden" name="commandId" defaultValue=""/>
          <input type="hidden" name="projectId" value={project.id}/>
          <input type="hidden" name="expectedSeq" value={request.seq}/>
          <input type="hidden" name="mode" value={choice}/>
          {obstruction ? <input type="hidden" name="obstruction" value="on"/> : null}
          {direct && incompleteNow && acknowledged ? <input type="hidden" name="acknowledge" value="on"/> : null}
          {reviewFields(items).map((field) => (
            <span key={field.uploadId}>
              <input type="hidden" name="uploadId" value={field.uploadId}/>
              <input type="hidden" name="label" value={field.label}/>
              <input type="hidden" name="shortEdge" value={field.shortEdge}/>
              <input type="hidden" name="blur" value={field.blur}/>
              <input type="hidden" name="clipped" value={field.clipped}/>
            </span>
          ))}

          <p className="lede">{direct ? t('review.confirm.directLede') : t('review.confirm.researchLede')}</p>

          <dl className="project-facts request-facts">
            <div>
              <dt>{t('request.review.mode')}</dt>
              <dd>{t(direct ? 'request.mode.image_direct' : 'request.mode.evidence_images')}</dd>
            </div>
            <div>
              <dt>{t('review.confirm.pictures')}</dt>
              <dd>{t('review.confirm.picturesValue', {count: items.length, views: listOf(t, items.map((item) => (item.label ? t(labelKeys[item.label]) : '')))})}</dd>
            </div>
          </dl>

          {direct ? (
            <>
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
                  aria-describedby={[ids.scopeHelp, fieldProblems.some((problem) => problem.field === 'scope') ? ids.scopeError : null].filter(Boolean).join(' ')}
                  aria-invalid={fieldProblems.some((problem) => problem.field === 'scope') ? true : undefined}
                  onChange={(event) => {
                    setEdits({...edits, scope: event.target.value});
                    touched();
                  }}
                />
                <p id={ids.scopeHelp} className="auth-hint">{t('request.review.scopeHelp')}</p>
                {fieldProblems.filter((problem) => problem.field === 'scope').map((problem) => (
                  <div className="invite-notice" key="scope"><Notice id={ids.scopeError} tone="danger">{t(problemKey(problem), {max: limitOf('scope')})}</Notice></div>
                ))}
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
                  aria-describedby={[ids.outcomeHelp, fieldProblems.some((problem) => problem.field === 'outcome') ? ids.outcomeError : null].filter(Boolean).join(' ')}
                  aria-invalid={fieldProblems.some((problem) => problem.field === 'outcome') ? true : undefined}
                  onChange={(event) => {
                    setEdits({...edits, outcome: event.target.value});
                    touched();
                  }}
                />
                <p id={ids.outcomeHelp} className="auth-hint">{t('request.review.outcomeHelp')}</p>
                {fieldProblems.filter((problem) => problem.field === 'outcome').map((problem) => (
                  <div className="invite-notice" key="outcome"><Notice id={ids.outcomeError} tone="danger">{t(problemKey(problem), {max: limitOf('outcome')})}</Notice></div>
                ))}
              </div>
              <p className="project-muted request-note">{t('review.confirm.directNote')}</p>
              <p className="project-muted request-note">{t('review.confirm.lapseNote')}</p>

              {incompleteNow ? (
                <section className="review-ack" aria-labelledby={`${ids.acknowledge}-title`}>
                  <h2 id={`${ids.acknowledge}-title`}>{t('review.ack.title')}</h2>
                  <Notice tone="warning" role="note">
                    <strong>{t('review.ack.intro')}</strong>
                  </Notice>
                  <ul className="review-ack-facts">
                    {incompleteSentences(t, items, locale).map((sentence, index) => <li key={index}>{sentence}</li>)}
                  </ul>
                  <p>{t('review.ack.warning')}</p>
                  <label className="review-checkbox" htmlFor={ids.acknowledge}>
                    <input
                      ref={acknowledgeRef}
                      id={ids.acknowledge}
                      type="checkbox"
                      checked={acknowledged}
                      aria-required="true"
                      aria-describedby={confirmTried && !acknowledged ? ids.acknowledgeError : undefined}
                      aria-invalid={confirmTried && !acknowledged ? true : undefined}
                      onChange={(event) => {
                        setAcknowledgedFor(event.target.checked ? incompleteKey(items) : null);
                        touched();
                      }}
                    />
                    <span>{t('review.ack.label')}</span>
                  </label>
                  {confirmTried && !acknowledged ? (
                    <div className="invite-notice"><Notice id={ids.acknowledgeError} tone="danger" role="alert">{t('review.ack.required')}</Notice></div>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : (
            <p className="project-muted request-note">{t('review.confirm.researchNote')}</p>
          )}

          {failureKey ? (
            <div className="invite-notice" ref={failureRef} tabIndex={-1}>
              <Notice tone="danger" role="alert">{t(failureKey, {position: failurePosition})}</Notice>
            </div>
          ) : null}
          <div className="request-actions review-nav">
            <Button variant="primary" type="submit" iconAfter="arrow" aria-disabled={saving ? true : undefined}>{direct ? t('review.confirm.button') : t('review.confirm.save')}</Button>
            <Button variant="secondary" icon="back" onClick={back}>{t('review.back')}</Button>
          </div>
          <p className="auth-hint auth-status" role="status">{saving ? t('review.confirm.pending') : null}</p>
        </form>
      ) : null}
    </div>
  );
}

/** One picture of the first step: its preview, the view the person says it shows, what was measured with what to do about it, or why it could not be measured. */
function ReviewPicture({
  item,
  count,
  index,
  projectId,
  confirmed,
  tried,
  onLabel,
  onRetry,
}: {
  item: ReviewItem;
  count: number;
  index: number;
  projectId: string;
  confirmed: boolean;
  tried: boolean;
  onLabel: (label: ViewLabel | null) => void;
  onRetry: (key: string) => void;
}) {
  const {t} = useI18n();
  const headingId = useId();
  const selectId = useId();
  const errorId = useId();
  const position = item.position;
  const missingLabel = tried && item.label === null;
  const measurements = item.measurements;
  const problems = problemsOf(item);
  const remedy = item.reason ? unusableRemedy(item.reason) : null;

  return (
    <li className="picture-item review-item" data-position={position} data-state={item.state}>
      <div className="picture-media">
        <div className="picture-thumb">
          {item.thumbnailUrl ? (
            // A local object URL of a small JPEG drawn in this browser from the picture: next/image cannot optimize it, and nothing here is ever fetched for display.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnailUrl} alt={t('review.picture.preview', {position})} decoding="async"/>
          ) : (
            <span className="picture-thumb-empty"><Icon name="image" size={28}/></span>
          )}
        </div>
        <p className="picture-nopreview project-muted">
          <LtrToken>{typeLabel(item.contentType)}</LtrToken> · <LtrToken>{formatBytes(item.length)}</LtrToken>
        </p>
      </div>
      <div className="picture-body">
        <h3 id={headingId}>{t('review.picture.title', {position, count})}</h3>

        {item.state === 'measuring' ? <p className="project-muted" role="status">{t('review.picture.measuring')}</p> : null}

        {item.state === 'unusable' && item.reason ? (
          <div className="picture-note">
            <Notice tone="danger" role="alert" id={errorId}>
              <strong>{t('review.unusable.title', {position})}</strong> {t(unusableKeys[item.reason])}{' '}
              {confirmed && remedy ? (
                // A confirmed request's pictures are locked: nothing on the picture screen can fix this one, so it is not offered.
                t('review.unusable.confirmed')
              ) : (
                <>
                  {t('review.unusable.cannotAcknowledge')}
                  {remedy ? ` ${t(fixKeys[remedy])}` : null}
                </>
              )}
            </Notice>
            <div className="picture-actions">
              {reasonRetryable(item.reason) ? (
                <Button variant="primary" onClick={() => onRetry(item.key)} aria-describedby={errorId}>{t('review.unusable.retry')}</Button>
              ) : null}
              {confirmed ? null : (
                <LinkButton variant="secondary" icon="image" href={picturesPath(projectId)} aria-describedby={errorId}>{t('review.unusable.go')}</LinkButton>
              )}
            </div>
          </div>
        ) : null}

        {item.state === 'measured' && measurements ? (
          <dl className="review-results">
            {(['resolution', 'blur', 'exposure'] as const).map((kind) => {
              const fine = !problems.includes(kind);
              const detail =
                kind === 'resolution'
                  ? t(detailKeys.resolution, {size: `${measurements.shortEdgePx} px`, min: `${thresholds.minShortEdgePx} px`})
                  : kind === 'blur'
                    ? t(detailKeys.blur, {value: blurText(measurements.blurVariance), min: thresholds.minBlurVariance})
                    : t(detailKeys.exposure, {percent: percentOf(measurements.clippedFraction), max: percentOf(thresholds.maxClippedFraction)});
              return (
                <div key={kind} data-result={fine ? 'ok' : kind}>
                  <dt>{t(measureKeys[kind])}</dt>
                  <dd>
                    <StatusBadge tone={fine ? 'success' : 'warning'}>{fine ? t('review.badge.ok') : t(badgeKeys[kind])}</StatusBadge>
                    <span className="review-detail"> {detail}</span>
                    {fine ? null : <span className="review-remedy"><strong>{t('review.remedy.title')}</strong> {t(remedyKeys[kind])}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}

        <div className="invite-field review-label">
          <label htmlFor={selectId} className="auth-label">{t('review.picture.label', {position})}</label>
          <select
            id={selectId}
            className="invite-input review-select"
            value={item.label ?? ''}
            aria-required="true"
            aria-invalid={missingLabel ? true : undefined}
            aria-describedby={missingLabel ? `${errorId}-label` : undefined}
            data-index={index}
            onChange={(event) => onLabel(isViewLabel(event.target.value) ? event.target.value : null)}
          >
            <option value="">{t('review.picture.labelChoose')}</option>
            {viewLabels.map((label) => (
              <option key={label} value={label}>{t(labelKeys[label])}</option>
            ))}
          </select>
          {missingLabel ? <div className="invite-notice"><Notice id={`${errorId}-label`} tone="danger">{t('review.issue.labels')}</Notice></div> : null}
        </div>
      </div>
    </li>
  );
}
