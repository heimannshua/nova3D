// Story 2.12. Retaining the pictures a person is about to confirm: the application's half of "keep the confirmed pictures as immutable Project artifacts". It runs
// FIRST in the sequence of a confirmation, and records nothing itself:
//
//   1. a read-only pre-check (`api.check_picture_retention`, lib/projects.ts `checkPictureRetention`): the Account's authority, the Project, the revision the person
//      reviewed, every upload (foreign, unknown, expired) and the 2 GiB quota over the whole confirmation. It says, per picture, `attach` (no retained copy yet) or
//      `retained` (one exists);
//   2. the attaches, for the pictures that need one, at most 4 in flight, each limited to 30 seconds: one application-signed `attach` command with the transform
//      `strip-picture-metadata` at the file gateway, which reads the staged copy, checks it is the bytes the lease promised, removes every metadata segment except
//      the EXIF orientation and publishes the result as an immutable manifest root;
//   3. (not here) the review writer (`api.record_picture_review`, lib/projects.ts), which pins what was published, read from the database's own manifests;
//   4. (not here) the staged copies expire.
//
// So a failure confirms nothing: a picture that was published but whose confirmation never completed is a harmless orphan, kept, reused by the next attempt (the
// pre-check then says `retained` for it and the gateway is not asked again) and counted against the quota until Epic 8 can delete it. The run is IDEMPOTENT: with
// every picture already retained it asks the gateway for nothing and answers `retained` again.
//
// This module is THE one caller of the gateway's `attach` for pictures (and so the new caller of `configuredGatewayClient`). It answers a named outcome and never
// throws for something the gateway or the database said; it throws only when the database could not be reached for the pre-check (the caller tells the person to try
// again) or for a bug. A retained root or an object key is read from nothing here and is in no answer, no log and no address: the pre-check's roots stay in lib/projects.ts.
//
// SERVER-ONLY (it imports the gateway client, which reads the environment, and lib/projects.ts, which holds the service-role key).
import type {AccountsOptions} from '@/lib/accounts';
import type {Operation} from '@/lib/authority';
import {createBudget, DeadlineError, withDeadline, type Budget} from '@/lib/deadline';
import {configuredGatewayClient, GatewayError, GatewayUnavailableError, type GatewayClient} from '@/lib/gateway-client';
import {checkPictureRetention, type PictureRetentionCheck} from '@/lib/projects';

/** The attach transform that retains a picture: the gateway removes every metadata segment but the EXIF orientation, losslessly for the pixels. */
export const stripTransform = 'strip-picture-metadata';
/** How many attaches are in flight at once, and how long each may take. */
export const maxInFlight = 4;
export const attachLimitMs = 30_000;
/** The whole run's allowance (the review page's `maxDuration` is 60 seconds). */
export const retainBudgetMs = 60_000;

/**
 * What a run of retention answers.
 *  - `retained`: every picture has a retained copy now (`count` pictures, the ones that were already retained included). Nothing else is claimed: nothing is pinned
 *    or confirmed yet.
 *  - `bytes_changed`: the staged bytes of the picture at `position` (1 is the first) are not the bytes the lease promised. `strip_failed`: its structure could not be
 *    parsed, so it was not kept (an unstripped copy is never published). `lease_expired`: its staged copy has expired or is gone. `not_complete`: its upload is
 *    not finished. `manifest_conflict`: a manifest of that upload exists that is not the one this attach would make. `unknown_upload`, `not_ready`, `expired_upload`:
 *    the pre-check's own refusals about a picture (not the Account's own, not complete, expired with no retained copy).
 *  - `unavailable`: the gateway could not keep the picture at `position` (it did not answer in time, was unreachable or failed; `position` is null when it is not about
 *    one: no gateway is configured, or the run ran out of time). Trying again is safe and keeps only what is not kept yet.
 *  - `quota_exceeded`: the Account's kept pictures would pass 2 GiB. `kept` and `asked` are the bytes of each when the pre-check said (null when only the gateway's
 *    backstop for a race did). Nothing more is kept.
 *  - `stale`: the Project's latest revision is not the one that was reviewed (`seq` is the latest when the database says). `not_editable`: a text request, or a Project
 *    that is past the request stages. `gone`: the Project is another Account's, deleted, tombstoned or unknown (one answer). `denied`: the Account has no authority.
 */
export type RetentionResult =
  | {outcome: 'retained'; count: number}
  | {outcome: 'bytes_changed' | 'strip_failed' | 'lease_expired' | 'not_complete' | 'manifest_conflict' | 'unknown_upload' | 'not_ready' | 'expired_upload'; position: number}
  | {outcome: 'unavailable'; position: number | null}
  | {outcome: 'quota_exceeded'; kept: number | null; asked: number | null}
  | {outcome: 'stale'; seq: number | null}
  | {outcome: 'not_editable' | 'gone' | 'denied'};

export type RetentionFailure = Exclude<RetentionResult, {outcome: 'retained'}>;

export type RetentionInput = {projectId: string; expectedSeq: number; uploadIds: readonly string[]};

/** Everything outside the module, so the tests run it without a database or a gateway. */
export type RetentionDeps = {
  /** The pre-check; the typed call by default. */
  check?: (operation: Operation, input: RetentionInput, options?: AccountsOptions) => Promise<PictureRetentionCheck>;
  /** The gateway client, or null when none is configured; `configuredGatewayClient()` by default. Asked only when a picture has to be attached. */
  gateway?: () => GatewayClient | null;
  /** The whole run's allowance of time (60 seconds by default): no attach is started when none is left, and none runs past it. */
  budget?: Budget;
  /** How long one attach may take (30 seconds by default). */
  attachLimitMs?: number;
  /** How many attaches are in flight at once (4 by default). */
  maxInFlight?: number;
};

/** A picture that was not kept, and whether trying again can help. */
type Failure = {result: RetentionFailure; retryable: boolean; position: number};

/** The gateway statuses that mean "not now" and not "no": the gateway failed or was busy. */
const transient = (status: number) => status >= 500 || status === 408 || status === 429;

/** What an error out of one attach means for that picture. */
function failureOf(error: unknown, position: number): Failure {
  if (error instanceof GatewayUnavailableError || error instanceof DeadlineError) return {result: {outcome: 'unavailable', position}, retryable: true, position};
  if (error instanceof GatewayError) {
    if (transient(error.status)) return {result: {outcome: 'unavailable', position}, retryable: true, position};
    switch (error.code) {
      case 'bytes_changed':
      case 'strip_failed':
      case 'lease_expired':
      case 'not_complete':
      case 'manifest_conflict':
        return {result: {outcome: error.code, position}, retryable: false, position};
      case 'quota_exceeded':
        return {result: {outcome: 'quota_exceeded', kept: null, asked: null}, retryable: false, position};
      case 'not_found':
        return {result: {outcome: 'unknown_upload', position}, retryable: false, position};
      case 'forbidden':
        return {result: {outcome: 'denied'}, retryable: false, position};
      default:
        // A refusal this application does not know: not a "try again", but not something to name to the person either.
        return {result: {outcome: 'unavailable', position}, retryable: false, position};
    }
  }
  // Anything else (a claim the signer refused, a bug) is not the gateway's answer: nothing is known to have been kept, and nothing is retried.
  return {result: {outcome: 'unavailable', position}, retryable: false, position};
}

/** Which failure to tell first: the Account's lost authority, then the quota (it concerns the whole confirmation), then a picture that cannot be kept, then one that could not be reached; the lowest position within each. */
function worst(failures: readonly Failure[]): RetentionFailure {
  const rank = (failure: Failure) => (failure.result.outcome === 'denied' ? 0 : failure.result.outcome === 'quota_exceeded' ? 1 : failure.retryable ? 3 : 2);
  return [...failures].sort((a, b) => rank(a) - rank(b) || a.position - b.position)[0].result;
}

/** The pre-check's refusals as the run's own outcomes. */
function refusalOf(check: Exclude<PictureRetentionCheck, {outcome: 'checked'}>): RetentionFailure {
  switch (check.outcome) {
    case 'unavailable':
      return {outcome: 'gone'};
    case 'quota_exceeded':
      return {outcome: 'quota_exceeded', kept: check.kept, asked: check.asked};
    case 'stale':
      return {outcome: 'stale', seq: check.seq};
    case 'unknown_upload':
    case 'not_ready':
    case 'expired_upload':
      return {outcome: check.outcome, position: check.position};
    default:
      return {outcome: check.outcome};
  }
}

/**
 * Retains the pictures of a Project's latest revision for the Account of `operation`: the pre-check, then the attaches for the pictures that have no retained copy yet
 * (at most 4 in flight, each limited to 30 seconds, all within the run's budget), and an answer. A failure of ONE picture that trying again may cure (the gateway did
 * not answer) does not stop the others from being attached, only to report it: what was kept stays kept for the retry. A failure that trying again cannot cure stops
 * new attaches from starting (the ones in flight finish). The pre-check itself is read-only and the attach of a picture that is already retained is never asked for, so a
 * second run is a read.
 */
export async function retainPictures(operation: Operation, input: RetentionInput, deps: RetentionDeps = {}): Promise<RetentionResult> {
  const budget = deps.budget ?? createBudget(retainBudgetMs);
  const check = deps.check ?? checkPictureRetention;
  const checked = await check(operation, input, {timeoutMs: Math.max(1, budget.remaining())});
  if (checked.outcome !== 'checked') return refusalOf(checked);

  const pending = checked.pictures.filter((picture) => picture.action === 'attach');
  if (pending.length === 0) return {outcome: 'retained', count: checked.pictures.length};

  const gateway = (deps.gateway ?? (() => configuredGatewayClient()))();
  // No gateway is configured: nothing can be kept, and nothing is claimed. (The pre-check above did not need it, and neither does a run that attaches nothing.)
  if (!gateway) return {outcome: 'unavailable', position: null};

  const limit = deps.attachLimitMs ?? attachLimitMs;
  const width = Math.max(1, Math.min(deps.maxInFlight ?? maxInFlight, pending.length));
  const failures: Failure[] = [];
  let next = 0;
  let stopped = false;

  const attachOne = async (position: number, uploadId: string): Promise<void> => {
    const left = budget.remaining();
    // The run is out of time: this picture is not attempted, and is reported as one that could not be reached (the retry keeps the ones that were).
    if (left <= 0) {
      failures.push({result: {outcome: 'unavailable', position}, retryable: true, position});
      return;
    }
    try {
      await withDeadline(gateway.attach({accountId: operation.accountId, epoch: operation.epoch, uploadId, transform: stripTransform}), Math.min(limit, left));
    } catch (error) {
      const failure = failureOf(error, position);
      failures.push(failure);
      if (!failure.retryable) stopped = true;
    }
  };

  const worker = async () => {
    while (!stopped && next < pending.length) {
      const picture = pending[next];
      next += 1;
      await attachOne(picture.position, picture.uploadId);
    }
  };
  await Promise.all(Array.from({length: width}, worker));

  if (failures.length > 0) return worst(failures);
  // Pictures that were never started (a run stopped early) can only exist alongside a failure, which was answered above.
  return {outcome: 'retained', count: checked.pictures.length};
}
