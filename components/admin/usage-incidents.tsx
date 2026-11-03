'use client';

import {useId, useRef, useState, type FormEvent} from 'react';
import {clearUsageIncident} from '@/app/admin/usage/actions';
import {useI18n} from '@/lib/i18n/react';
import {isolateLtr, type Translator} from '@/lib/i18n';
import {
  formatDollars,
  formatIncidentTime,
  incidentMessageKeys,
  incidentStateKeys,
  incidentStateOf,
  incidentStateTones,
  incidentTimeIso,
  type UsageActionState,
  type UsageIncident,
  type UsageRow,
} from '@/lib/usage-view';
import {useCommandIds, useUsageAction} from '../use-usage-action';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {ConfirmDialog} from '../ui/dialog';
import {ErrorState, Notice} from '../ui/states';
import {StatusBadge} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';
import {UsageFailureNotice} from './usage-failure-notice';
import type {UsageMessage} from './usage-list';

/**
 * What an answer about an incident that is no longer where it was says (it was cleared, by this press or another window, or it is gone), or what a page that was out of
 * date says; null for an answer that is not one: a refusal or a service that did not answer (UsageFailureNotice says those). The provider is isolated, so Hebrew cannot reorder it.
 */
export function incidentMessageFor(state: UsageActionState, provider: string, t: Translator): UsageMessage | null {
  const params = {provider: isolateLtr(provider)};
  switch (state.outcome) {
    case 'cleared':
      return {tone: 'success', text: t(incidentMessageKeys.cleared, params)};
    case 'already_cleared':
      return {tone: 'info', text: t(incidentMessageKeys.already_cleared, params)};
    case 'stale':
    case 'not_found':
      return {tone: 'warning', text: t(incidentMessageKeys[state.outcome], params)};
    default:
      return null;
  }
}

/** The answers after which the incident's control is gone (it is cleared now or was, or it no longer exists): the list says them, not the card. */
const takesControlAway = (state: UsageActionState) => state.outcome === 'cleared' || state.outcome === 'already_cleared' || state.outcome === 'not_found';

/** A time as `2026-10-12 00:24` in a `<time>`, always left to right; a time that cannot be read is a dash. */
function Moment({at}: {at: string}) {
  const written = formatIncidentTime(at);
  return written ? <LtrToken><time dateTime={incidentTimeIso(at)}>{written}</time></LtrToken> : <>-</>;
}

/**
 * Overrun incidents (Story 2.8): a provider reported more usage than was reserved for a request. Each is a card with its provider, operation, the reserved and reported
 * amounts, the amount over, when it was recorded, whether it is open or cleared and by whom. An open incident blocks its provider for every Account; "Review and clear" asks
 * first, in a dialog that starts on Cancel, and needs the fresh sign-in like every change on this page. Open incidents come first (the database orders them), and nothing about
 * any Project or file is in them.
 *
 * `incidents` is null when they could not be read: the page says so and lists none. `rows` (the Accounts' usage, or null when that could not be read) only names the Account
 * of an incident by its address.
 */
export function UsageIncidents({incidents, rows}: {incidents: UsageIncident[] | null; rows: UsageRow[] | null}) {
  const {t} = useI18n();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // What an answer says when it takes the control away (the incident is cleared, or gone): the card's own control is unmounted by the time it could be shown there, so it
  // is shown above the list, as the Accounts list does, and focus moves to the heading.
  const [message, setMessage] = useState<UsageMessage | null>(null);
  // An Account in the list with no address is one Auth no longer vouches for; an Account NOT in the list (the list could not be read, or the Account is beyond the Accounts it shows)
  // is another thing, and the card says so instead of claiming it has no address.
  const addresses = new Map((rows ?? []).map((row) => [row.accountId, row.email] as const));
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} ref={title} tabIndex={-1}>{t('usage.incidents.title')}</h2>
      <p className="settings-help">{t('usage.incidents.help')}</p>
      {message ? <div className="invite-notice"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      {incidents === null ? (
        <div className="invite-state-block">
          <ErrorState title={t('usage.incidents.error.title')} headingLevel={3} live>{t('usage.incidents.error.body')}</ErrorState>
        </div>
      ) : incidents.length === 0 ? (
        <p className="settings-help usage-incidents-empty">{t('usage.incidents.empty')}</p>
      ) : (
        <ul className="invite-list">
          {incidents.map((incident) => (
            <IncidentItem key={incident.id} incident={incident} address={addresses.get(incident.accountId)} onMessage={setMessage} onGone={() => title.current?.focus()}/>
          ))}
        </ul>
      )}
    </section>
  );
}

function IncidentItem({incident, address, onMessage, onGone}: {incident: UsageIncident; address: string | null | undefined; onMessage: (message: UsageMessage) => void; onGone: () => void}) {
  const {t} = useI18n();
  const state = incidentStateOf(incident);
  const keys = incidentStateKeys[state];
  return (
    <li className="invite-item usage-incident" data-state={state}>
      <div className="invite-item-head">
        <h3 className="invite-name"><LtrToken>{incident.provider}</LtrToken></h3>
        <StatusBadge tone={incidentStateTones[state]}>{t(keys.label)}</StatusBadge>
      </div>
      <dl className="invite-meta usage-incident-meta">
        <div>
          <dt>{t('usage.incident.row.account')}</dt>
          <dd>{address === undefined ? t('usage.incident.row.accountUnlisted') : address ? <LtrToken>{address}</LtrToken> : t('usage.row.noAddress')}</dd>
        </div>
        <div>
          <dt>{t('usage.incident.row.operation')}</dt>
          <dd><LtrToken>{incident.operationId}</LtrToken></dd>
        </div>
        <div>
          <dt>{t('usage.incident.row.reserved')}</dt>
          <dd><LtrToken>{formatDollars(incident.reserved)}</LtrToken></dd>
        </div>
        <div>
          <dt>{t('usage.incident.row.evidence')}</dt>
          <dd><LtrToken>{formatDollars(incident.evidence)}</LtrToken></dd>
        </div>
        <div>
          <dt>{t('usage.incident.row.over')}</dt>
          <dd><LtrToken>{formatDollars(incident.over)}</LtrToken></dd>
        </div>
        <div>
          <dt>{t('usage.incident.row.when')}</dt>
          <dd><Moment at={incident.createdAt}/></dd>
        </div>
        {incident.clearedAt !== null ? (
          <>
            <div>
              <dt>{t('usage.incident.row.clearedAt')}</dt>
              <dd><Moment at={incident.clearedAt}/></dd>
            </div>
            <div>
              <dt>{t('usage.incident.row.clearedBy')}</dt>
              <dd>{incident.clearedByEmail ? <LtrToken>{incident.clearedByEmail}</LtrToken> : t('usage.row.noAddress')}</dd>
            </div>
          </>
        ) : null}
      </dl>
      <p className="settings-help usage-note">{t(keys.note, {provider: isolateLtr(incident.provider)})}</p>
      {state === 'open' ? <ClearControl incident={incident} onMessage={onMessage} onGone={onGone}/> : null}
    </li>
  );
}

/**
 * "Review and clear": clears the incident once the Administrator has looked at it. Pressing it asks first, in a dialog that states the amounts and what clearing does and starts
 * on Cancel. The command ID is made when the form is sent: the same one for a retry of this incident (a double press, a lost answer), a new one for the next. A cleared incident
 * stays in the record and cannot be reopened.
 */
function ClearControl({incident, onMessage, onGone}: {incident: UsageIncident; onMessage: (message: UsageMessage) => void; onGone: () => void}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const form = useRef<HTMLFormElement>(null);
  const commandIdFor = useCommandIds();
  const [confirming, setConfirming] = useState(false);
  const provider = isolateLtr(incident.provider);

  const {state, formAction, pending, onSubmit} = useUsageAction(clearUsageIncident, (next) => {
    const said = incidentMessageFor(next, incident.provider, t);
    if (said) announce(said.text, locale);
    if (said && takesControlAway(next)) {
      onMessage(said);
      onGone();
    }
    return next;
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const field = event.currentTarget.elements.namedItem('commandId');
    if (field instanceof HTMLInputElement) field.value = commandIdFor(`clear|${incident.id}`);
    onSubmit(event);
  };

  const said = pending || takesControlAway(state) ? null : incidentMessageFor(state, incident.provider, t);
  return (
    <div className="usage-control">
      <form ref={form} action={formAction} onSubmit={submit} className="invite-form">
        <input type="hidden" name="accountId" value={incident.accountId}/>
        <input type="hidden" name="incidentId" value={incident.id}/>
        <input type="hidden" name="commandId" defaultValue=""/>
        <Button
          variant="secondary"
          aria-label={t('usage.incident.clear.label', {provider, operation: isolateLtr(incident.operationId.slice(0, 8)), when: isolateLtr(formatIncidentTime(incident.createdAt))})}
          aria-disabled={pending ? true : undefined}
          onClick={() => !pending && setConfirming(true)}
        >
          {pending ? t('usage.incident.clear.pending') : t('usage.incident.clear.button')}
        </Button>
        <p className="auth-hint auth-status" role="status">{pending ? t('usage.incident.clear.pendingStatus') : null}</p>
      </form>
      {said ? <div className="invite-notice"><Notice tone={said.tone}>{said.text}</Notice></div> : null}
      {pending ? null : <UsageFailureNotice state={state} about="incident"/>}
      {confirming ? (
        <ConfirmDialog
          title={t('usage.incident.clear.title')}
          description={t('usage.incident.clear.body', {
            provider,
            over: isolateLtr(formatDollars(incident.over)),
            reserved: isolateLtr(formatDollars(incident.reserved)),
            evidence: isolateLtr(formatDollars(incident.evidence)),
          })}
          confirmLabel={t('usage.incident.clear.confirm')}
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
