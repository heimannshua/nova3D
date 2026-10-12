// Story 1.5. What the Administrator's Accounts page (app/admin/accounts), its two Server Actions (actions.ts beside it) and
// the components under components/admin agree on, with nothing that reaches the server: a row, the state an action
// answers with, how a call that did not answer is read, and the words for each answer. A client component imports this
// file, so it imports no Node or Next.js server code and not lib/accounts.ts (whose types this file repeats by shape
// instead). A row never carries Workspace content, a project name or usage: the database does not return them.
import {attemptAdministeredAction} from '@/lib/administration';
import type {MessageKey} from '@/lib/i18n';
import {reloadHere} from '@/lib/session-actions';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An Account ID as the database spells one, or null for anything else (including anything that is not text). */
export function accountIdOf(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const id = input.trim();
  return idPattern.test(id) ? id.toLowerCase() : null;
}

/** The database's word for an Account's status; the page says Enabled and Disabled. */
export type AccountStatus = 'active' | 'disabled';

/** One row of the list, as the page passes it to the browser. */
export type AccountRow = {
  accountId: string;
  /** The Google address Auth verified, or null if Auth no longer vouches for one. */
  email: string | null;
  /** The kind of the invitation code that made the Account; null for an Account no code made (the pre-authorized Administrator). */
  invitationKind: 'named' | 'general' | null;
  /** The name of a named code. */
  invitationLabel: string | null;
  role: 'administrator' | 'member';
  status: AccountStatus;
  createdAt: string;
};

/** Words for the status, in the catalog: Enabled, Disabled. The page pairs each with its own shape. */
export const accountStatusKeys = {
  active: 'accounts.status.active',
  disabled: 'accounts.status.disabled',
} as const satisfies Record<AccountStatus, MessageKey>;

/**
 * What the two Server Actions (disable, re-enable) answer, and what the controls keep.
 *
 *  - `disabled` is a disable that happened: how many sessions it ended and how many Jobs the cancellers stopped, after the
 *    disable had committed. `cancellationsFailed` counts cancellers that did not finish (their Jobs cannot publish anyway,
 *    because the authority is already gone).
 *  - `enabled` is a re-enable that happened.
 *  - `already_disabled` and `already_enabled` are "another window got there first": nothing changed.
 *  - `administrator` is "the Administrator's Account cannot be disabled": nothing changed.
 *  - `not_found` is an ID that names no Account.
 *  - `refused` is "no valid fresh sign-in": nothing was changed. `stepUp` says whether to offer the sign-in (there was
 *    none or it ran out) or not (the marker could not be used for another reason).
 *  - `denied` is an Account that is not the Administrator.
 *  - `unavailable` is a service that did not answer. `unknown` is true when the change may have been made anyway: the
 *    person is told to check the list before trying again.
 */
export type AccountActionState =
  | {outcome: 'idle'}
  | {outcome: 'disabled'; sessionsEnded: number; jobsCancelled: number; cancellationsFailed: number}
  | {outcome: 'enabled'}
  | {outcome: 'already_disabled'}
  | {outcome: 'already_enabled'}
  | {outcome: 'administrator'}
  | {outcome: 'not_found'}
  | {outcome: 'refused'; stepUp: boolean}
  | {outcome: 'denied'}
  | {outcome: 'unavailable'; unknown: boolean};

export const accountActionIdle: AccountActionState = {outcome: 'idle'};

export type AccountAction = (previous: AccountActionState, formData: FormData) => Promise<AccountActionState>;

/** Calls an Accounts action and reads what comes back (see `attemptAdministeredAction`): a call that did not answer is `unavailable`, and the change may have been made. */
export function attemptAccountAction(
  action: AccountAction,
  previous: AccountActionState,
  formData: FormData,
  navigate: () => void = reloadHere,
): Promise<AccountActionState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true}, navigate);
}

/** The catalog key for an answer that is one fixed message. The others carry something: `disabled` its counts, a failure what to do next (accountFailureKey). */
export const accountMessageKeys = {
  enabled: 'accounts.enable.done',
  already_disabled: 'accounts.disable.alreadyDisabled',
  already_enabled: 'accounts.enable.alreadyEnabled',
  administrator: 'accounts.disable.administrator',
  not_found: 'accounts.error.notFound',
  denied: 'accounts.error.denied',
} as const satisfies Partial<Record<AccountActionState['outcome'], MessageKey>>;

export function accountFailureKey(state: Extract<AccountActionState, {outcome: 'refused' | 'unavailable'}>): MessageKey {
  if (state.outcome === 'refused') return state.stepUp ? 'accounts.error.needsConfirm' : 'accounts.error.refused';
  return state.unknown ? 'accounts.error.unknown' : 'accounts.error.unavailable';
}

/** The name an Account goes by in the list and in a sentence: its Google address, or a stand-in when Auth no longer vouches for one. */
export function accountLabelOf(account: Pick<AccountRow, 'email'>, standIn: string): string {
  return account.email ?? standIn;
}
