// Story 1.11. What the Administrator's invitation page (app/admin/invitations), its three Server Actions
// (actions.ts beside it) and the components under components/admin agree on, with nothing that reaches the server:
// the label rules, the state an action answers with, how a call that did not answer is read, and how a row's
// creation time is written. A client component imports this file, so it imports no Node or Next.js server code and
// not lib/accounts.ts (whose types this file repeats by shape instead).
import {unstable_rethrow} from 'next/navigation';
import type {MessageKey} from '@/lib/i18n';
import {reloadHere, unexpectedResponseMessage} from '@/lib/session-actions';

// Labels ----------------------------------------------------------------------------------------------------

/** The longest name a code can carry. The database refuses more (api.issue_invitation); the form says so first. */
export const maxLabelLength = 80;

// Characters that draw nothing: controls (\p{Cc}), format characters (\p{Cf}: the zero-width space, joiners, bidi marks, the
// byte order mark), every kind of space and separator (\p{Z}), and four fill characters that are letters or marks in
// Unicode but render blank (the Braille blank, the Hangul fillers).
const invisible = /[\p{Cc}\p{Cf}\p{Z}\u2800\u3164\u115F\u1160]/gu;
const controls = /\p{Cc}+/gu;

/**
 * A name as it is sent: each run of control characters (tabs and newlines included, a NUL too) replaced by one space,
 * then the surrounding whitespace removed. Format characters stay: a Hebrew name legitimately carries a right-to-left
 * mark, and one beside visible text is part of the name. Anything that is not text is an empty name.
 */
export function normalizeLabel(input: unknown): string {
  return typeof input === 'string' ? input.replace(controls, ' ').trim() : '';
}

export type LabelProblem = 'empty' | 'too_long';

/**
 * What is wrong with a (normalized) name, if anything: empty, which includes a name of nothing but characters that draw
 * nothing, or more than 80 characters (code points, as the database counts them).
 */
export function labelProblem(label: string): LabelProblem | null {
  if (!label.replace(invisible, '')) return 'empty';
  return [...label].length > maxLabelLength ? 'too_long' : null;
}

export const labelErrorKeys = {
  empty: 'invitations.named.error.empty',
  too_long: 'invitations.named.error.tooLong',
} as const satisfies Record<LabelProblem, MessageKey>;

// The list ---------------------------------------------------------------------------------------------------

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An invitation ID as the database spells one, or null for anything else (including anything that is not text). */
export function invitationIdOf(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const id = input.trim();
  return idPattern.test(id) ? id.toLowerCase() : null;
}

export type InvitationStatus = 'unused' | 'redeemed' | 'revoked';

/** One row of the list, as the page passes it to the browser. Never a hash and never a code. */
export type InvitationRow = {
  invitationId: string;
  kind: 'named' | 'general';
  label: string | null;
  state: InvitationStatus;
  createdAt: string;
};

/** Words for the status, in the catalog: Unused, Used, Revoked. The page pairs each with its own shape. */
export const statusKeys = {
  unused: 'invitations.status.unused',
  redeemed: 'invitations.status.redeemed',
  revoked: 'invitations.status.revoked',
} as const satisfies Record<InvitationStatus, MessageKey>;

/**
 * A creation time as `2026-10-12 00:24 UTC`: the same text on the server and in the browser (no locale, no time
 * zone of the machine), and unambiguous. An unreadable time is an empty string, never an exception.
 */
export function formatCreatedAt(createdAt: string): string {
  const moment = new Date(createdAt);
  if (Number.isNaN(moment.getTime())) return '';
  return `${moment.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The time as an attribute for <time>, or undefined when it cannot be read. */
export function isoOf(createdAt: string): string | undefined {
  const moment = new Date(createdAt);
  return Number.isNaN(moment.getTime()) ? undefined : moment.toISOString();
}

/**
 * Whether the page has seen the Administrator confirm it is them (a marker for `administration` that is still valid
 * when the page rendered). It only decides whether "Confirm it is you" is shown beforehand: the Server Action
 * checks the marker itself, every time, and is the authority.
 */
export type Confirmation = 'confirmed' | 'needed' | 'unknown';

// What an action answers -------------------------------------------------------------------------------------

/** A code that was just made. It exists in the one response that carries it, and in the browser's memory until it is hidden. */
export type IssuedCode = {
  invitationId: string;
  kind: 'named' | 'general';
  label: string | null;
  code: string;
  /** The general code this one replaced (it was revoked in the same step), or null. */
  replacedInvitationId: string | null;
};

/**
 * What the three Server Actions answer (issue a named code, make or replace the general code, revoke), and what the
 * forms keep.
 *
 *  - `issued` is the ONLY answer that carries a code. The form hands it to the page and keeps `created` instead, so
 *    the code is held in one place in the browser.
 *  - `invalid` is a name the server would not take (the form checks first, so this is a request that did not come
 *    from the form).
 *  - `exists` is "a general code already exists" (another window made it first): nothing was made.
 *  - `revoked`, `already_revoked`, `redeemed` and `not_found` are the four answers to a revoke.
 *  - `refused` is "no valid fresh sign-in": nothing was changed. `stepUp` says whether to offer the sign-in (there was
 *    no marker or it ran out) or not (the marker could not be used for another reason).
 *  - `denied` is an Account that is not the Administrator.
 *  - `unavailable` is a service that did not answer. `unknown` is true when the change may have been made anyway: the
 *    person is told to check the list before trying again.
 */
export type InvitationActionState =
  | {outcome: 'idle'}
  | {outcome: 'invalid'; problem: LabelProblem}
  | ({outcome: 'issued'} & IssuedCode)
  | {outcome: 'created'}
  | {outcome: 'exists'}
  | {outcome: 'revoked'}
  | {outcome: 'already_revoked'}
  | {outcome: 'redeemed'}
  | {outcome: 'not_found'}
  | {outcome: 'refused'; stepUp: boolean}
  | {outcome: 'denied'}
  | {outcome: 'unavailable'; unknown: boolean};

export const invitationActionIdle: InvitationActionState = {outcome: 'idle'};

export type InvitationAction = (previous: InvitationActionState, formData: FormData) => Promise<InvitationActionState>;

/**
 * Calls an invitation action and reads what comes back.
 *
 *  - A redirect travels as a thrown error and is rethrown for Next.js to follow.
 *  - The one answer that is not the action's own is "an unexpected response": what a redirect by the proxy looks like
 *    to a Server Action, because this session no longer has access. Loading the page again lets the proxy say so. It
 *    happens at most once for each attempt, so it can never become a reload loop.
 *  - Anything else, a dropped connection or a real server error, is an answer that did not come: the change may
 *    have been made, so the person is told to check the list (`unknown`).
 */
export async function attemptInvitationAction(
  action: InvitationAction,
  previous: InvitationActionState,
  formData: FormData,
  navigate: () => void = reloadHere,
): Promise<InvitationActionState> {
  try {
    return await action(previous, formData);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof Error && error.message === unexpectedResponseMessage) {
      navigate();
      return previous;
    }
    return {outcome: 'unavailable', unknown: true};
  }
}

/** The catalog key for an answer that is one fixed message. The others carry something: `invalid` its problem (labelErrorKeys), a failure what to do next (failureKey). */
export const invitationMessageKeys = {
  exists: 'invitations.general.exists',
  revoked: 'invitations.revoke.done',
  already_revoked: 'invitations.revoke.alreadyRevoked',
  redeemed: 'invitations.revoke.redeemed',
  not_found: 'invitations.revoke.notFound',
  denied: 'invitations.error.denied',
} as const satisfies Partial<Record<InvitationActionState['outcome'], MessageKey>>;

export function failureKey(state: Extract<InvitationActionState, {outcome: 'refused' | 'unavailable'}>): MessageKey {
  if (state.outcome === 'refused') return state.stepUp ? 'invitations.error.needsConfirm' : 'invitations.error.refused';
  return state.unknown ? 'invitations.error.unknown' : 'invitations.error.unavailable';
}
