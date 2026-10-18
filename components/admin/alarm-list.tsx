'use client';

import {useId} from 'react';
import {formatCreatedAt, isoOf} from '@/lib/administration';
import {useI18n} from '@/lib/i18n/react';
import type {Translator} from '@/lib/i18n';
import {conditionTitleKey, detailLabelKey, detailValuesOf, emailNoteKeyOf, emailStateKeys, emailStateOf, hasReceipt, receiptOf, receiptOutcomeKey, type AlarmView, type EmailState} from '@/lib/operations';
import {EmptyState, ErrorState} from '../ui/states';
import {StatusBadge, type StatusTone} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';

/** A time as `2026-10-12 00:24 UTC` in a `<time>`, always left to right; a time that cannot be read is a dash. */
function Moment({at}: {at: string | null}) {
  const written = at === null ? '' : formatCreatedAt(at);
  return written ? <LtrToken><time dateTime={isoOf(at as string)}>{written}</time></LtrToken> : <>-</>;
}

/** What the title of an alarm says: the catalog's words for a condition it knows, and the condition's own ID, left to right, for one it does not. */
function Title({condition, t}: {condition: string; t: Translator}) {
  const key = conditionTitleKey(condition);
  return key ? <>{t(key)}</> : <LtrToken>{condition}</LtrToken>;
}

const emailTones: Record<EmailState['state'], StatusTone> = {sent: 'success', pending: 'info', failing: 'warning'};

/** The email state of an open alarm: a word and a shape (never a colour alone), the time it went out, or why it has not (the line is true of what happened: lib/operations.ts `emailNoteKeyOf`). */
function EmailRow({alarm, t}: {alarm: AlarmView; t: Translator}) {
  const state = emailStateOf(alarm);
  const note = emailNoteKeyOf(alarm);
  return (
    <div>
      <dt>{t('operations.row.email')}</dt>
      <dd>
        <span className="alarm-email">
          <StatusBadge tone={emailTones[state.state]}>{t(emailStateKeys[state.state])}</StatusBadge>
          {state.state === 'sent' ? <Moment at={state.at}/> : note ? <span>{t(note)}</span> : null}
        </span>
      </dd>
    </div>
  );
}

/** The last receipt an alarm names: its task, how that run ended and when. An alarm that names none says so. */
function ReceiptRows({alarm, t}: {alarm: AlarmView; t: Translator}) {
  const receipt = receiptOf(alarm.detail);
  if (!hasReceipt(receipt)) {
    return (
      <div>
        <dt>{t('operations.row.receipt')}</dt>
        <dd>{t('operations.row.receipt.none')}</dd>
      </div>
    );
  }
  const outcomeKey = receipt.outcome === null ? null : receiptOutcomeKey(receipt.outcome);
  // `never` is how a task that has not finished a run says so; its time is the same word, so it is said once, in the outcome.
  const neverRan = receipt.at === 'never';
  return (
    <>
      {receipt.task !== null ? (
        <div>
          <dt>{t('operations.row.receiptTask')}</dt>
          <dd><LtrToken>{receipt.task}</LtrToken></dd>
        </div>
      ) : null}
      {receipt.outcome !== null ? (
        <div>
          <dt>{t('operations.row.receiptOutcome')}</dt>
          <dd>{outcomeKey ? t(outcomeKey) : <LtrToken>{receipt.outcome}</LtrToken>}</dd>
        </div>
      ) : null}
      {receipt.at !== null && !neverRan ? (
        <div>
          <dt>{t('operations.row.receiptAt')}</dt>
          <dd>{formatCreatedAt(receipt.at) ? <Moment at={receipt.at}/> : <LtrToken>{receipt.at}</LtrToken>}</dd>
        </div>
      ) : null}
    </>
  );
}

/** What the condition found, as the detail holds it: each whole number and boolean with a label (a known key has its words, any other shows its key), left to right. */
function DetailRows({alarm, t}: {alarm: AlarmView; t: Translator}) {
  return (
    <>
      {detailValuesOf(alarm.detail).map(({key, value}) => {
        const label = detailLabelKey(key);
        return (
          <div key={key}>
            <dt>{label ? t(label) : <LtrToken>{key}</LtrToken>}</dt>
            <dd>{typeof value === 'boolean' ? t(value ? 'operations.detail.yes' : 'operations.detail.no') : <LtrToken>{String(value)}</LtrToken>}</dd>
          </div>
        );
      })}
    </>
  );
}

function SubjectRow({alarm, t}: {alarm: AlarmView; t: Translator}) {
  if (alarm.subject === null) return null;
  return (
    <div>
      <dt>{t('operations.row.subject')}</dt>
      <dd><LtrToken>{alarm.subject}</LtrToken></dd>
    </div>
  );
}

function OpenItem({alarm}: {alarm: AlarmView}) {
  const {t} = useI18n();
  return (
    <li className="invite-item alarm-item">
      <div className="invite-item-head">
        <h3 className="invite-name"><Title condition={alarm.condition} t={t}/></h3>
      </div>
      <dl className="invite-meta alarm-meta">
        <SubjectRow alarm={alarm} t={t}/>
        <div>
          <dt>{t('operations.row.first')}</dt>
          <dd><Moment at={alarm.firstAt}/></dd>
        </div>
        <div>
          <dt>{t('operations.row.latest')}</dt>
          <dd><Moment at={alarm.latestAt}/></dd>
        </div>
        <DetailRows alarm={alarm} t={t}/>
        <ReceiptRows alarm={alarm} t={t}/>
        <EmailRow alarm={alarm} t={t}/>
      </dl>
    </li>
  );
}

function ResolvedItem({alarm}: {alarm: AlarmView}) {
  const {t} = useI18n();
  return (
    <li className="invite-item alarm-item">
      <div className="invite-item-head">
        <h3 className="invite-name"><Title condition={alarm.condition} t={t}/></h3>
        <StatusBadge tone="success">{t('operations.resolved.badge')}</StatusBadge>
      </div>
      <dl className="invite-meta alarm-meta">
        <SubjectRow alarm={alarm} t={t}/>
        <div>
          <dt>{t('operations.row.first')}</dt>
          <dd><Moment at={alarm.firstAt}/></dd>
        </div>
        <div>
          <dt>{t('operations.row.resolved')}</dt>
          <dd><Moment at={alarm.resolvedAt}/></dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * The open alarms, newest first, each a card (a table would not read on a phone or at large text): its condition's title, the subject, when it was first and
 * last seen, the last receipt it names and its email state. `alarms` is null when the list could not be read: the page says so and nothing else about the alarms.
 */
export function OpenAlarms({alarms}: {alarms: AlarmView[] | null}) {
  const {t} = useI18n();
  const titleId = useId();
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{t('operations.open.title')}</h2>
      <p className="settings-help">{t('operations.open.help')}</p>
      {alarms === null ? (
        <div className="invite-state-block">
          <ErrorState title={t('operations.error.title')} headingLevel={3} live>{t('operations.error.body')}</ErrorState>
        </div>
      ) : alarms.length === 0 ? (
        <div className="invite-state-block">
          <EmptyState title={t('operations.open.empty.title')} headingLevel={3} icon="check-circle">{t('operations.open.empty.body')}</EmptyState>
        </div>
      ) : (
        <ul className="invite-list">
          {alarms.map((alarm) => <OpenItem key={alarm.id} alarm={alarm}/>)}
        </ul>
      )}
    </section>
  );
}

/** The most recently resolved alarms: kept for the record, never emailed again. */
export function ResolvedAlarms({alarms}: {alarms: AlarmView[]}) {
  const {t} = useI18n();
  const titleId = useId();
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{t('operations.resolved.title')}</h2>
      <p className="settings-help">{t('operations.resolved.help')}</p>
      {alarms.length === 0 ? (
        <p className="settings-state">{t('operations.resolved.empty')}</p>
      ) : (
        <ul className="invite-list">
          {alarms.map((alarm) => <ResolvedItem key={alarm.id} alarm={alarm}/>)}
        </ul>
      )}
    </section>
  );
}
