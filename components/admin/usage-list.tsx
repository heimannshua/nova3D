'use client';

import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {changeUsageLimit, resetUsageCount} from '@/app/admin/usage/actions';
import {useI18n} from '@/lib/i18n/react';
import {isolateLtr, type Translator} from '@/lib/i18n';
import {
  figuresOf,
  formatDollars,
  formatMonth,
  limitBounds,
  limitProblemKeys,
  newCommandId,
  parseDollars,
  usageCauseKeys,
  usageMessageKeys,
  usageNameOf,
  usageStateKeys,
  usageStateTones,
  type LimitProblem,
  type UsageActionState,
  type UsageRow,
} from '@/lib/usage-view';
import {useUsageAction} from '../use-usage-action';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {ConfirmDialog} from '../ui/dialog';
import {EmptyState, ErrorState, Notice, type NoticeTone} from '../ui/states';
import {StatusBadge} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';
import {UsageFailureNotice} from './usage-failure-notice';
import {UsageMeter} from './usage-meter';

export type UsageMessage = {tone: NoticeTone; text: string};

/**
 * What an answer that is about the card's period says (a change that was made, or turned out not to need making, a page that was out of date), or null for
 * an answer that is not: a refusal, a service that did not answer (UsageFailureNotice says those) and a typed limit that is not one (the field says that).
 */
export function messageFor(state: UsageActionState, name: string, t: Translator): UsageMessage | null {
  switch (state.outcome) {
    case 'changed':
      return {tone: 'success', text: t('usage.change.done', {name, limit: isolateLtr(formatDollars(state.limit))})};
    case 'unchanged':
      return {tone: 'info', text: t('usage.change.unchanged', {name, limit: isolateLtr(formatDollars(state.limit))})};
    case 'reset':
      return {tone: 'success', text: t(usageMessageKeys.reset, {name})};
    case 'replayed':
      return {tone: 'info', text: t(usageMessageKeys.replayed, {name})};
    case 'stale':
    case 'reused':
    case 'disabled':
    case 'not_found':
      return {tone: 'warning', text: t(usageMessageKeys[state.outcome], {name})};
    case 'invalid_limit':
      return {tone: 'danger', text: t(usageMessageKeys.invalid_limit, {name, ...limitBounds()})};
    default:
      return null;
  }
}

/** The answers after which the Account's controls are gone (it was disabled, or it no longer exists): the list says them, not the card. */
const takesControlsAway = (state: UsageActionState) => state.outcome === 'disabled' || state.outcome === 'not_found';

/**
 * Every Account, newest first (AD-03): its month, its monthly limit, what is settled and reserved, what is available, and whether it is under its limit, nearly
 * at it or at it. Each Account is a card, not a row of a table, so it reads on a phone and at large text. Nothing about any Project or file is in it.
 *
 * `rows` is null when the usage could not be read: the page says so and shows no number.
 */
export function UsageList({rows}: {rows: UsageRow[] | null}) {
  const {t} = useI18n();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // What an answer says when it takes the controls away (the Account was disabled or is gone): the card's own controls are unmounted by the time it
  // could be shown there, so it is shown above the list, as the Accounts page does, and focus moves to the list's heading.
  const [message, setMessage] = useState<UsageMessage | null>(null);
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} ref={title} tabIndex={-1}>{t('usage.list.title')}</h2>
      <p className="settings-help">{t('usage.list.help')}</p>
      {message ? <div className="invite-notice"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      {rows === null ? (
        <div className="invite-state-block">
          <ErrorState title={t('usage.list.error.title')} headingLevel={3} live>{t('usage.list.error.body')}</ErrorState>
        </div>
      ) : rows.length === 0 ? (
        <div className="invite-state-block">
          <EmptyState title={t('usage.list.empty.title')} headingLevel={3}>{t('usage.list.empty.body')}</EmptyState>
        </div>
      ) : (
        <ul className="invite-list">
          {rows.map((row) => <UsageItem key={row.accountId} row={row} onMessage={setMessage} onGone={() => title.current?.focus()}/>)}
        </ul>
      )}
    </section>
  );
}

function UsageItem({row, onMessage, onGone}: {row: UsageRow; onMessage: (message: UsageMessage) => void; onGone: () => void}) {
  const {t} = useI18n();
  const figures = figuresOf(row);
  const name = usageNameOf(row, t('usage.row.noAddress'));
  const month = formatMonth(row.monthStart);
  const keys = usageStateKeys[figures.state];
  return (
    <li className="invite-item usage-item" data-state={figures.state}>
      <div className="invite-item-head">
        <h3 className="invite-name">{row.email ? <LtrToken>{row.email}</LtrToken> : name}</h3>
        <StatusBadge tone={usageStateTones[figures.state]}>{t(keys.label)}</StatusBadge>
      </div>
      <p className="settings-help usage-role">
        {row.role === 'administrator' ? t('usage.row.role.administrator') : t('usage.row.role.member')}
        {row.status === 'disabled' ? <> · {t('usage.row.disabled')}</> : null}
      </p>
      <UsageMeter figures={figures} name={name}/>
      <dl className="invite-meta usage-meta">
        <div>
          <dt>{t('usage.row.month')}</dt>
          <dd>{month ? <LtrToken><time dateTime={row.monthStart}>{month}</time></LtrToken> : '-'}</dd>
        </div>
        <div>
          <dt>{t('usage.row.limit')}</dt>
          <dd><LtrToken>{formatDollars(figures.limit)}</LtrToken></dd>
        </div>
        <div>
          <dt>{t('usage.row.settled')}</dt>
          <dd><LtrToken>{formatDollars(figures.settled)}</LtrToken></dd>
        </div>
        <div>
          <dt>{t('usage.row.reserved')}</dt>
          <dd><LtrToken>{formatDollars(figures.reserved)}</LtrToken></dd>
        </div>
        <div>
          <dt>{t('usage.row.available')}</dt>
          <dd><LtrToken>{formatDollars(figures.available)}</LtrToken></dd>
        </div>
        {figures.over > 0 ? (
          <div>
            <dt>{t('usage.row.over')}</dt>
            <dd><LtrToken>{formatDollars(figures.over)}</LtrToken></dd>
          </div>
        ) : null}
        <div>
          <dt>{t('usage.row.began')}</dt>
          <dd>{t(usageCauseKeys[row.cause])}</dd>
        </div>
      </dl>
      <p className="settings-help usage-note">{t(keys.note)}</p>
      {row.status === 'active' ? (
        <div className="usage-controls">
          <ChangeLimitForm row={row} name={name} onMessage={onMessage} onGone={onGone}/>
          <ResetControl row={row} name={name} onMessage={onMessage} onGone={onGone}/>
        </div>
      ) : (
        <p className="settings-help usage-disabled-note">{t('usage.row.disabledNote')}</p>
      )}
    </li>
  );
}

/** Names the command a form is about, so one command keeps one ID (a retry, a double press) and the next one gets another. */
function useCommandIds() {
  const sent = useRef<{signature: string; id: string} | null>(null);
  return (signature: string) => {
    if (sent.current?.signature !== signature) sent.current = {signature, id: newCommandId()};
    return sent.current.id;
  };
}

/**
 * "Change limit": the new monthly limit in dollars, whole cents, from $0.00 to $10,000.00. A limit that is not one is answered here, in the person's language,
 * before anything is sent. The Administrator may set a limit below what is already used: the Account is then at its limit, and nothing already reserved
 * or settled is touched. The field is emptied only when the change was made (or already was); every other answer leaves what was typed where it was.
 */
function ChangeLimitForm({row, name, onMessage, onGone}: {row: UsageRow; name: string; onMessage: (message: UsageMessage) => void; onGone: () => void}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const commandIdFor = useCommandIds();
  // What the field holds. It is controlled: React resets a form's uncontrolled fields when its action settles, which is after the answer has come and the
  // page has been refreshed, and would take with it a limit typed in between.
  const [typed, setTyped] = useState('');
  const [local, setLocal] = useState<LimitProblem | null>(null);

  const {state, formAction, pending, onSubmit} = useUsageAction(changeUsageLimit, (next, formData) => {
    const said = messageFor(next, name, t);
    if (said) announce(said.text, locale);
    if (said && takesControlsAway(next)) {
      onMessage(said);
      onGone();
    }
    if (next.outcome === 'changed' || next.outcome === 'replayed' || next.outcome === 'unchanged') {
      // The field empties, unless the person has already started the next limit: then it is theirs.
      const sent = formData.get('limit');
      setTyped((current) => (current === sent ? '' : current));
    }
    return next;
  });

  const problem = pending ? null : (local ?? (state.outcome === 'invalid' ? state.problem : null));
  useEffect(() => {
    if (state.outcome === 'invalid') input.current?.focus();
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const parsed = parseDollars(new FormData(event.currentTarget).get('limit'));
    if (!parsed.ok) {
      event.preventDefault();
      setLocal(parsed.problem);
      input.current?.focus();
      return;
    }
    setLocal(null);
    // The command ID is chosen now: the one this limit was last sent with for this period (a retry), or a new one. The form is read after this handler,
    // so the field carries it.
    const field = event.currentTarget.elements.namedItem('commandId');
    if (field instanceof HTMLInputElement) field.value = commandIdFor(`change|${row.accountId}|${row.seq}|${parsed.microdollars}`);
    onSubmit(event);
  };

  const said = pending || takesControlsAway(state) ? null : messageFor(state, name, t);
  return (
    <div className="usage-control">
      <form action={formAction} onSubmit={submit} noValidate className="invite-form usage-form">
        <input type="hidden" name="accountId" value={row.accountId}/>
        <input type="hidden" name="expectedSeq" value={row.seq}/>
        <input type="hidden" name="commandId" defaultValue=""/>
        <div className="invite-field">
          <label htmlFor={fieldId} className="auth-label">{t('usage.change.label', {name})}</label>
          <input
            ref={input}
            id={fieldId}
            name="limit"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className="invite-input"
            value={typed}
            autoComplete="off"
            aria-required="true"
            aria-describedby={problem ? `${hintId} ${errorId}` : hintId}
            aria-invalid={problem ? true : undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              if (local) setLocal(null);
            }}
          />
          <p id={hintId} className="auth-hint">
            {t('usage.change.hint', {current: isolateLtr(formatDollars(row.limit)), max: limitBounds().max})}
          </p>
          {problem ? <div className="invite-notice"><Notice id={errorId} tone="danger" role="alert">{t(limitProblemKeys[problem], limitBounds())}</Notice></div> : null}
        </div>
        <Button variant="primary" type="submit" aria-label={t('usage.change.submitLabel', {name})} aria-disabled={pending ? true : undefined}>
          {pending ? t('usage.change.pending') : t('usage.change.submit')}
        </Button>
        <p className="auth-hint auth-status" role="status">{pending ? t('usage.change.pendingStatus') : null}</p>
      </form>
      {said ? <div className="invite-notice"><Notice tone={said.tone}>{said.text}</Notice></div> : null}
      {pending ? null : <UsageFailureNotice state={state}/>}
    </div>
  );
}

/**
 * "Reset count": starts this month's count again from zero. Pressing it asks first, in a dialog that starts on Cancel. What is still reserved stays reserved and
 * the limit stays, so work that is already reserved keeps its reservation; nothing is deleted.
 */
function ResetControl({row, name, onMessage, onGone}: {row: UsageRow; name: string; onMessage: (message: UsageMessage) => void; onGone: () => void}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const form = useRef<HTMLFormElement>(null);
  const commandIdFor = useCommandIds();
  const [confirming, setConfirming] = useState(false);

  const {state, formAction, pending, onSubmit} = useUsageAction(resetUsageCount, (next) => {
    const said = messageFor(next, name, t);
    if (said) announce(said.text, locale);
    if (said && takesControlsAway(next)) {
      onMessage(said);
      onGone();
    }
    return next;
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const field = event.currentTarget.elements.namedItem('commandId');
    if (field instanceof HTMLInputElement) field.value = commandIdFor(`reset|${row.accountId}|${row.seq}`);
    onSubmit(event);
  };

  const said = pending || takesControlsAway(state) ? null : messageFor(state, name, t);
  return (
    <div className="usage-control">
      <form ref={form} action={formAction} onSubmit={submit} className="invite-form">
        <input type="hidden" name="accountId" value={row.accountId}/>
        <input type="hidden" name="expectedSeq" value={row.seq}/>
        <input type="hidden" name="commandId" defaultValue=""/>
        <Button
          variant="secondary"
          aria-label={t('usage.reset.label', {name})}
          aria-disabled={pending ? true : undefined}
          onClick={() => !pending && setConfirming(true)}
        >
          {pending ? t('usage.reset.pending') : t('usage.reset.button')}
        </Button>
        <p className="auth-hint auth-status" role="status">{pending ? t('usage.reset.pendingStatus') : null}</p>
      </form>
      {said ? <div className="invite-notice"><Notice tone={said.tone}>{said.text}</Notice></div> : null}
      {pending ? null : <UsageFailureNotice state={state}/>}
      {confirming ? (
        <ConfirmDialog
          title={t('usage.reset.title')}
          description={t('usage.reset.body', {name})}
          confirmLabel={t('usage.reset.confirm')}
          tone="primary"
          startOn="cancel"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            form.current?.requestSubmit();
          }}
        />
      ) : null}
    </div>
  );
}
