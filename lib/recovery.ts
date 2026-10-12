// Story 1.6. The two sequences of Administrator recovery, written once with every collaborator injected, so each
// order, each failure and each log line is tested without a database, Auth or a mail provider. The Server Actions in
// app/recover/actions.ts are thin: they wire the real collaborators, set cookies and redirect.
//
//   requestRecoveryLink   /recover. A token is issued (the database stores only its keyed hash and knows the eligible
//                         Administrator from the server's own configuration), the link `<origin>/recover/confirm#<token>`
//                         is mailed to the configured Administrator address through lib/mailer.ts (whose recipient is not
//                         a parameter), and the page learns only `sent`, `limited` or `unavailable`. No eligible
//                         Administrator and a mail failure both read `unavailable`; the audit holds the cause.
//
//   redeemRecoveryLink    /recover/confirm, on a POST. In this order: the token is checked (read-only), Auth's Admin API
//                         makes a magic link for the Auth user's own address, `verifyOtp` turns it into a session on the
//                         cookie-bound client, and ONE database transaction redeems the token and gives that session its
//                         grant and its marker. Until that transaction commits only an inert, grant-less Auth session can
//                         exist; a failure after `verifyOtp` ends it; the token stays unused unless the transaction
//                         committed. A database that does not answer AFTER the transaction was handed to it is `unknown`:
//                         it may have committed, so the session is kept and the person is told to open Administration.
//
// SERVER-ONLY (it imports lib/accounts.ts, lib/auth-admin.ts and lib/mailer.ts). It imports nothing from Next.js, so it is
// tested directly. No function here logs a token, a link, an address or a hash: a log line is a name and a message only,
// and the messages of the errors it prints name a variable or a status and never a value.
import type {AccessUser, UserRead} from '@/lib/access';
import {
  AccountsUnavailableError,
  checkRecovery,
  issueRecovery,
  redeemRecoveryToken,
  voidRecovery,
  type RecoveryCheck,
  type RecoveryIssuance,
  type RecoveryRedemption,
  type RecoveryVoidOutcome,
} from '@/lib/accounts';
import {generateMagicLink, type MagicLink} from '@/lib/auth-admin';
import {createBudget, DeadlineError, withinBudget, type Budget} from '@/lib/deadline';
import {appOriginProblem, isPlaceholder, type Env} from '@/lib/environment';
import {sendRecoveryMail, type MailOutcome} from '@/lib/mailer';
import {recoveryConfirmPath, type RecoveryRequestState} from '@/lib/recovery-state';

/** How long the whole of a redemption (the check, the link, the session, the user, the transaction) may take. */
export const recoveryTimeoutMs = 15_000;

type Log = (message: string, detail: string) => void;
const defaultLog: Log = (message, detail) => console.error(message, detail);
/** A name and a message, never a request, a token, a link, an address or a hash. */
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/**
 * The origin of the link the mail carries. Staging and production use APP_ORIGIN (an https origin that the environment check
 * requires), never anything a request said, so no request can choose where the link points. Locally it is the origin the
 * request came in on (`requestOrigin`, from lib/step-up.server.ts), which is what lets the browser tests open the mail
 * Mailpit received. Null when there is none to use: the caller then does not issue a token at all.
 */
export function recoveryLinkOrigin(env: Env, requestOrigin: string | null): string | null {
  if (env.APP_ENV === 'local') return requestOrigin;
  // Only the two hosted environments have an origin of their own; anything else has no link to build.
  if (env.APP_ENV !== 'staging' && env.APP_ENV !== 'production') return null;
  const configured = env.APP_ORIGIN?.trim();
  if (!configured || isPlaceholder(configured) || appOriginProblem(configured, env.APP_ENV)) return null;
  return configured;
}

/** The link in the mail: the token in the FRAGMENT, so no server, proxy, platform log, `Referer` or audit row ever sees it. */
export function recoveryLink(origin: string, token: string) {
  return `${origin}${recoveryConfirmPath}#${token}`;
}

// The request -----------------------------------------------------------------------------------------------------------

export type RecoveryRequestDeps = {
  /** The origin the link points at (`recoveryLinkOrigin`), or null: then nothing is issued. */
  origin: string | null;
  issue?: () => Promise<RecoveryIssuance>;
  send?: (link: string) => Promise<MailOutcome>;
  voidToken?: (token: string, definitive: boolean) => Promise<RecoveryVoidOutcome>;
  log?: Log;
};

/** Issues a token, mails its link, and answers only `sent`, `limited` or `unavailable`. Never throws. */
export async function requestRecoveryLink(deps: RecoveryRequestDeps): Promise<RecoveryRequestState> {
  const log = deps.log ?? defaultLog;
  const issue = deps.issue ?? (() => issueRecovery());
  const send = deps.send ?? ((link: string) => sendRecoveryMail(link));
  const voidToken = deps.voidToken ?? ((token: string, definitive: boolean) => voidRecovery({token, definitive}));
  const unavailable: RecoveryRequestState = {outcome: 'unavailable'};

  // Without a link origin there is no link to mail, and a token must not be issued for nothing: every issuance counts toward
  // the limits.
  if (!deps.origin) {
    log('Recovery could not be requested: there is no origin for the link.', 'APP_ORIGIN is not usable');
    return unavailable;
  }

  let issuance: RecoveryIssuance;
  try {
    issuance = await issue();
  } catch (error) {
    log('Recovery could not be requested (the database did not answer, or is not configured).', describe(error));
    return unavailable;
  }
  if (issuance.outcome === 'limited') return {outcome: 'limited'};
  if (issuance.outcome !== 'issued') {
    // No eligible Administrator, or a pinned subject that no longer matches: the database audited it. The page says what it
    // says for any other cause.
    log('Recovery was not issued.', 'refused');
    return unavailable;
  }

  let mail: MailOutcome;
  try {
    mail = await send(recoveryLink(deps.origin, issuance.token));
  } catch (error) {
    // The mailer does not throw; if it ever does, nothing is known about the message.
    log('The recovery mail could not be sent.', describe(error));
    mail = {outcome: 'unknown', reason: 'unreachable'};
  }
  if (mail.outcome === 'sent') return {outcome: 'sent'};

  log('The recovery mail was not sent.', `${mail.outcome} (${mail.reason})`);
  try {
    // A definitive refusal voids the token, so nothing usable remains. An unknown outcome (the mail may have gone out) only
    // audits the failure, and leaves the token as it was.
    await voidToken(issuance.token, mail.outcome === 'refused');
  } catch (error) {
    log('The failed recovery mail could not be recorded.', describe(error));
  }
  return unavailable;
}

// The redemption ----------------------------------------------------------------------------------------------------------

/** The session the redemption mints, on the client that holds its cookies back until the redemption is known (lib/supabase/server.ts). */
export type RecoverySessionClient = {
  /** Turns Auth's hashed link token into a session on the cookie-bound client: its access token, or why not (`outage`: Auth did not answer). */
  verify(hashedToken: string, budget: Budget): Promise<{ok: true; accessToken: string} | {ok: false; outage: boolean}>;
  /** Auth's verified user for the session just minted, and the ID of that session. */
  readUser(accessToken: string, budget: Budget): Promise<UserRead>;
  /** Ends the session just minted, at Auth, on this client only. Never throws. */
  end(): Promise<void>;
};

/**
 * How long a redemption whose link Auth refused waits, between asks, for the token to be used by the window that made Auth refuse
 * it (see `redeemRecoveryLink`): about a second and a half in all, which is more than the winner's own verification and
 * transaction need, and little enough to cost nothing when the cause was something else.
 */
export const recheckDelaysMs: readonly number[] = [150, 250, 400, 700];

export type RecoveryRedeemDeps = {
  session: RecoverySessionClient;
  /** The waits between the asks that follow a link Auth refused. Defaults to `recheckDelaysMs`; a test passes none. */
  recheckDelaysMs?: readonly number[];
  /** How the wait is made. Defaults to a timer. */
  sleep?: (milliseconds: number) => Promise<void>;
  check?: (token: string, timeoutMs: number) => Promise<RecoveryCheck>;
  mint?: (email: string, timeoutMs: number) => Promise<MagicLink>;
  redeem?: (input: {token: string; userId: string; sessionId: string}, timeoutMs: number) => Promise<RecoveryRedemption>;
  log?: Log;
  timeoutMs?: number;
};

/**
 * What a redemption came to.
 *  - `redeemed`: the transaction committed. The session it minted holds its grant and its marker; `sessionsEnded` is how many
 *    other Auth sessions of the person it ended.
 *  - `invalid`: the link cannot be used (expired, used, replaced, never issued, or for nobody who can be recovered). Nothing
 *    changed, and no session is left: the one that was minted, if any, has been ended.
 *  - `unavailable`: a service did not answer, or the recovery could not be made. No session is left, and the token is as it was.
 *  - `unknown`: the database did not answer after the transaction was handed to it, so it may have committed. The session
 *    that was minted is kept: if it did commit, it is the person's way in.
 */
export type RecoveryRedemptionResult =
  | {outcome: 'redeemed'; sessionsEnded: number}
  | {outcome: 'invalid'}
  | {outcome: 'unavailable'}
  | {outcome: 'unknown'};

/**
 * The redemption, in its order (see the top of this file). `token` is whatever the confirmation page's form carried: it is
 * never trusted, only hashed, and an unknown token is simply refused. Never throws.
 */
export async function redeemRecoveryLink(token: string, deps: RecoveryRedeemDeps): Promise<RecoveryRedemptionResult> {
  const log = deps.log ?? defaultLog;
  const budget = createBudget(deps.timeoutMs ?? recoveryTimeoutMs);
  const check = deps.check ?? ((value: string, timeoutMs: number) => checkRecovery({token: value}, {timeoutMs}));
  const mint = deps.mint ?? ((email: string, timeoutMs: number) => generateMagicLink(email, {timeoutMs}));
  const redeem = deps.redeem ?? ((input: {token: string; userId: string; sessionId: string}, timeoutMs: number) => redeemRecoveryToken(input, {timeoutMs}));
  const {session} = deps;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const unavailable: RecoveryRedemptionResult = {outcome: 'unavailable'};
  // Ending the session must never be what makes a recovery throw.
  const endSession = async () => {
    try {
      await session.end();
    } catch (error) {
      log('The recovery session could not be ended.', describe(error));
    }
  };

  // Whether the token has stopped being valid, asked after a failure: another window of the same link got there first. Two windows
  // pressed together make Auth refuse one's link (it keeps one pending link per person) or delete one's session (the winner's
  // transaction ends every other session of the person), and both read as "could not finish" from this side, though the token is
  // by then used. Waits `delays` before each ask, and stops at the first answer that is not `valid`. Never throws.
  const tokenIsGone = async (delays: readonly number[]) => {
    for (const delay of delays) {
      try {
        await sleep(Math.min(delay, budget.remaining()));
        const again = await withinBudget(budget, (remaining) => check(token, remaining));
        if (again.outcome !== 'valid') return true;
      } catch (error) {
        log('The recovery link could not be checked again; nothing was changed.', describe(error));
        return false;
      }
    }
    return false;
  };

  // 1. The token, read-only. Nothing has been made yet, so a failure here leaves nothing behind.
  let checked: RecoveryCheck;
  try {
    checked = await withinBudget(budget, (remaining) => check(token, remaining));
  } catch (error) {
    log('The recovery link could not be checked; nothing was changed.', describe(error));
    return unavailable;
  }
  if (checked.outcome !== 'valid') return {outcome: 'invalid'};

  // 2. Auth's Admin API makes a magic link for the Auth user's own address.
  let link: MagicLink;
  try {
    link = await withinBudget(budget, (remaining) => mint(checked.email, remaining));
  } catch (error) {
    log('Auth could not make the recovery link; nothing was changed.', describe(error));
    return unavailable;
  }
  if (link.userId !== checked.userId) {
    log('Auth made the recovery link for another user; nothing was changed.', 'user mismatch');
    return unavailable;
  }

  // 3. The session, on the cookie-bound client. From here on a session exists that has no grant and so reaches nothing,
  // and every failure below ends it.
  const verified = await session.verify(link.hashedToken, budget).catch((): {ok: false; outage: boolean} => ({ok: false, outage: true}));
  if (!verified.ok) {
    log('The recovery session could not be made; nothing was changed.', verified.outage ? 'Auth did not answer' : 'Auth refused the link');
    // Auth keeps one pending link per person, so a link made a moment ago is refused when another window made its own link in
    // between. That other window is then on its way to recovering: ask again, a few times over a second or so, whether the token has
    // been used. If it has, this window's answer is the one every other bad link gets; if it never is, the cause was something
    // else, and trying again is safe. (Not when Auth did not answer at all: that is not another window's link.)
    if (!verified.outage && (await tokenIsGone(deps.recheckDelaysMs ?? recheckDelaysMs))) return {outcome: 'invalid'};
    return unavailable;
  }
  let user: AccessUser;
  try {
    const read = await session.readUser(verified.accessToken, budget);
    if (read.kind !== 'user' || read.user.id !== checked.userId) {
      log('The recovery session is not the Administrator\'s; ending it.', read.kind);
      await endSession();
      // The winner's transaction deletes this window's session when it commits first: the token is then used.
      return (await tokenIsGone([0])) ? {outcome: 'invalid'} : unavailable;
    }
    user = read.user;
  } catch (error) {
    log('The recovery session could not be read; ending it.', describe(error));
    await endSession();
    return (await tokenIsGone([0])) ? {outcome: 'invalid'} : unavailable;
  }

  // 4. The one database transaction. The session is kept ONLY when the call was dispatched and its outcome cannot be known: the
  // database did not answer, answered with a server error or with something unreadable (an AccountsUnavailableError that says its
  // outcome is unknown), or did not answer in time while the call was in flight (a DeadlineError). Anything else means the
  // transaction either was refused by the database (it understood the call and rejected it) or was never sent at all: the budget
  // was spent before the call (withinBudget rejects without starting it), the configuration is unusable, or an argument was
  // rejected before any request. None of those can have committed, so the session ends, no cookie is written, and the token is as
  // it was.
  let redemption: RecoveryRedemption;
  try {
    redemption = await withinBudget(budget, (remaining) => redeem({token, userId: user.id, sessionId: user.sessionId}, remaining));
  } catch (error) {
    const mayHaveCommitted = error instanceof AccountsUnavailableError ? error.outcomeUnknown : error instanceof DeadlineError;
    if (!mayHaveCommitted) {
      log('The recovery was not made (the call was refused or never sent); ending the session.', describe(error));
      await endSession();
      return unavailable;
    }
    log('The recovery may or may not have been made (the database did not answer in time); keeping the session.', describe(error));
    return {outcome: 'unknown'};
  }
  if (redemption.outcome !== 'redeemed') {
    // The loser of a race, an expired link, a subject that no longer matches: only this window's own session ends.
    await endSession();
    return {outcome: 'invalid'};
  }
  return {outcome: 'redeemed', sessionsEnded: redemption.sessionsEnded};
}
