// Story 1.6. What the two public recovery pages (/recover and /recover/confirm), their two Server Actions
// (app/recover/actions.ts) and the components agree on, with nothing that reaches the server: the token's shape and
// where it is read from, the state each action answers with, how a call that did not answer is read, and the words.
// A client component imports this file, so it imports no Node or Next.js server code and not lib/accounts.ts (which
// imports THIS file for the token's shape, relatively and with `.ts`, as it does lib/step-up.ts).
//
// Like lib/step-up.ts it uses erasable TypeScript syntax only: lib/accounts.ts is loaded by scripts through Node
// type stripping, and imports this module.
import type {MessageKey} from './i18n';

/** The public page that asks for a recovery link. */
export const recoverPath = '/recover';
/** The public page the mailed link opens, and the only place a token is ever read from. */
export const recoveryConfirmPath = '/recover/confirm';
/** Where a recovery ends: the Administration index (the new session holds a fresh `administration` marker). */
export const recoveryLandingPath = '/admin';

/**
 * The shape of a recovery token: 32 random bytes as 43 URL-safe characters. The one definition (lib/accounts.ts
 * generates tokens of this shape and the confirmation page recognises one by it).
 */
export const recoveryTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token in a URL fragment (`#<token>`, as `window.location.hash` has it), or null when the fragment is not one. The
 * token is only ever in the fragment: a fragment is never sent to a server, a proxy, a platform log or a `Referer`.
 */
export function tokenFromFragment(fragment: string | null | undefined): string | null {
  if (typeof fragment !== 'string') return null;
  const token = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  return recoveryTokenPattern.test(token) ? token : null;
}

/**
 * What the request action answers: `sent` (a link is on its way to the Administrator's address), `limited` (one was
 * asked for a short while ago, or too many today) or `unavailable` (there is no Administrator to serve, the mail could not
 * be sent, or a service did not answer: one answer for all of them, so nothing is learned from it).
 */
export type RecoveryRequestState = {outcome: 'idle'} | {outcome: 'sent'} | {outcome: 'limited'} | {outcome: 'unavailable'};

export const recoveryRequestIdle: RecoveryRequestState = {outcome: 'idle'};

export type RecoveryRequestAction = (previous: RecoveryRequestState) => Promise<RecoveryRequestState>;

/** Kept as catalog keys, not text, so a message follows the language if it changes. */
export const recoveryRequestKeys = {
  sent: 'recover.sent',
  limited: 'recover.limited',
  unavailable: 'recover.unavailable',
} as const satisfies Record<Exclude<RecoveryRequestState['outcome'], 'idle'>, MessageKey>;

/**
 * What the redeem action answers when it does not redirect to Administration (a recovery that happened never answers: it
 * redirects).
 *
 *  - `invalid`: the link cannot be used. It expired, was used before, was replaced, was never issued, or belongs to
 *    nobody who can be recovered: one answer for all of them. Nothing was changed.
 *  - `unavailable`: a service did not answer, and no recovery was made. The link is as it was, and trying again is safe.
 *  - `unknown`: the database did not answer after the recovery was handed to it, so it may have been made. The person is
 *    told to open Administration; if it asks them to sign in, to ask for a new link.
 */
export type RecoveryRedeemState = {outcome: 'idle'} | {outcome: 'invalid'} | {outcome: 'unavailable'} | {outcome: 'unknown'};

export const recoveryRedeemIdle: RecoveryRedeemState = {outcome: 'idle'};

export type RecoveryRedeemAction = (previous: RecoveryRedeemState, formData: FormData) => Promise<RecoveryRedeemState>;

export const recoveryRedeemKeys = {
  invalid: 'recoverConfirm.invalid',
  unavailable: 'recoverConfirm.unavailable',
  unknown: 'recoverConfirm.unknown',
} as const satisfies Record<Exclude<RecoveryRedeemState['outcome'], 'idle'>, MessageKey>;

/**
 * Where the confirmation sends the person after a recovery: Administration, saying how many other sessions were ended. The
 * number is for the words only: it grants nothing, and a changed one shows a sentence to the person who typed it.
 */
export function recoveryLandingUrl(sessionsEnded: number): string {
  const count = Number.isSafeInteger(sessionsEnded) && sessionsEnded >= 0 ? sessionsEnded : 0;
  return `${recoveryLandingPath}?recovered=${count}`;
}

/** The number of sessions a recovery ended, from the `recovered` query value Administration receives, or null for anything that is not one. */
export function recoveredCountOf(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || !/^\d{1,4}$/.test(text)) return null;
  return Number(text);
}
