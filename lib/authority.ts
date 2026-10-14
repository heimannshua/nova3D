// Story 1.5. The authority contract every Job and every file path must pass: may THIS operation take THIS step NOW?
// docs/authority-contract.md is the short version for the people who write Jobs and the file gateway.
//
// An operation (a Job's attempt, a file transfer) registers under the authorization epoch of the live authorization
// that started it (`operationOf(access.account)`: api.authorize_session carries the epoch). Disabling an Account raises
// its epoch, and enabling it raises it again, so an operation registered before a disable is denied from then on, and
// stays denied after the Account is enabled again: re-enabling gives the PERSON a new sign-in, never an old operation a
// new life. Before each step that publishes or reaches outside (claiming, an external call, a file chunk, a result's
// publication) the operation asks `authorizeStep`:
//
//   allowed      the Account exists, is active, and is still under the epoch the operation registered under
//   disabled     the Account is disabled
//   stale_epoch  the Account's epoch is not the one the operation registered under
//   no_account   no such Account
//   tombstoned   the Account is deleted (Story 1.8's tombstone guard, decided first)
//   unreachable  the database did not answer, or answered in a way that is not an answer; invalid: the operation is
//                not shaped like one. Both are denials: a check that cannot be made is a check that fails.
//
// A step that acts on a named target (a record of the Account's Workspace, later its files and Jobs) asks `authorizeTarget` instead:
// the same answers, and `unavailable` for a target that is another Account's, unknown, deleted or tombstoned, all one answer with
// nothing in it.
//
// SQL that publishes does not ask from the application. It calls `identity.assert_operation_authority(account, epoch)` in
// the transaction of the write, before the write: that refuses a tombstoned Account first, then takes the Account row FOR SHARE and
// raises N3010 unless the Account is active under that epoch, and a disable (which takes the row FOR UPDATE) cannot commit between
// the check and the write.
//
// Disabling revokes this authority FIRST, in one database transaction (api.disable_account). Only after it has committed
// does the application send cancellation signals, to the cancellers that later stories register here: best effort, counted,
// never a reason to undo the disable. A canceller that asks `authorizeStep` therefore always finds it denying.
//
// SERVER-ONLY (it imports lib/accounts.ts). Like lib/accounts.ts it uses erasable TypeScript syntax and relative `.ts`
// imports, so a worker outside Next.js can import it through Node type stripping.
import {guardOperation, type AccountsOptions} from './accounts.ts';
import {guardTarget, targetKinds, type TargetKind} from './lifecycle.ts';

// Operations ----------------------------------------------------------------------------------------------------

/** An operation as the guard knows it: the Account it acts for and the authorization epoch it registered under. */
export type Operation = {accountId: string; epoch: number};

/**
 * Registers an operation under the epoch of the live authorization that started it. Pass `access.account` of an active
 * access (lib/access.ts): its `accountId` and `epoch` are the database's, never a request's.
 */
export function operationOf(account: {accountId: string; epoch: number}): Operation {
  return {accountId: account.accountId, epoch: account.epoch};
}

export type DeniedReason = 'disabled' | 'stale_epoch' | 'no_account' | 'tombstoned' | 'unreachable' | 'invalid';
/** `allowed` carries the Account's current epoch, which equals the operation's. Anything else is a denial, with the reason. */
export type StepDecision = {allowed: true; epoch: number} | {allowed: false; reason: DeniedReason};

export type StepOptions = AccountsOptions & {
  /** Called, with a name and message only, when the check could not be made. Defaults to console.error. */
  log?: (message: string, detail: string) => void;
};

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/**
 * Whether the operation may take its next step: `api.guard_operation`, with an answer that cannot be got meaning no. It
 * never throws and never answers `allowed` unless the database said so. Ask before EVERY step that publishes or reaches
 * outside, not once at the start: an operation outlives the request that began it.
 */
export async function authorizeStep(operation: Operation, options: StepOptions = {}): Promise<StepDecision> {
  const {log = (message: string, detail: string) => console.error(message, detail), ...accountsOptions} = options;
  try {
    const guard = await guardOperation(operation, accountsOptions);
    if (guard.outcome === 'allowed' && guard.epoch !== null) return {allowed: true, epoch: guard.epoch};
    return {allowed: false, reason: guard.outcome === 'allowed' ? 'unreachable' : guard.outcome};
  } catch (error) {
    // A malformed operation (not a UUID, not a positive epoch) is a bug in the caller, and is refused like any other.
    if (error instanceof TypeError) {
      log('An operation step was denied (the operation is malformed).', describe(error));
      return {allowed: false, reason: 'invalid'};
    }
    log('An operation step was denied (the authority check could not be made).', describe(error));
    return {allowed: false, reason: 'unreachable'};
  }
}

// Cancellation --------------------------------------------------------------------------------------------------

/** What a canceller is asked to cancel: the Account's operations registered under an epoch lower than `epoch`, the one the disable raised it to. */
export type CancellationTarget = {accountId: string; epoch: number};

/**
 * A later story's way to stop its own work for an Account: it returns how many Jobs it cancelled. It runs best effort,
 * after the disable has committed, so it may ask `authorizeStep` and will find it denying. It must be safe to run twice.
 */
export type Canceller = {name: string; cancel: (target: CancellationTarget) => Promise<number>};

const registryKey = Symbol.for('nova3d.authority.cancellers');
type Registry = Map<string, Canceller>;

// On globalThis, because Next.js can load this module once for a Server Action and again for a route handler.
function registry(): Registry {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (holder[registryKey] ??= new Map());
}

const cancellerName = /^[a-z][a-z0-9_.-]{0,63}$/;

/** Registers a canceller under a unique name. Returns the function that removes it. */
export function registerCanceller(canceller: Canceller): () => void {
  if (typeof canceller?.name !== 'string' || !cancellerName.test(canceller.name) || typeof canceller.cancel !== 'function') {
    throw new TypeError('a canceller needs a lower-case name and a cancel function');
  }
  const cancellers = registry();
  if (cancellers.has(canceller.name)) throw new Error(`a canceller named ${canceller.name} is already registered`);
  cancellers.set(canceller.name, canceller);
  return () => {
    if (cancellers.get(canceller.name) === canceller) cancellers.delete(canceller.name);
  };
}

/** The registered cancellers' names, for the tests and for a status page. */
export function cancellerNames(): string[] {
  return [...registry().keys()].sort();
}

/** `cancellers` ran, `cancelled` Jobs were stopped in all, and `failed` cancellers did not finish (they threw, or took too long). */
export type CancellationReport = {cancellers: number; cancelled: number; failed: number};

/** How long one canceller may take before it counts as failed. */
export const cancellerTimeoutMs = 5000;

/**
 * Sends the cancellation signals of a disable that has COMMITTED. Every registered canceller runs, together, each with its
 * own time limit; one that throws or hangs is counted as failed and never stops the others. This never throws and never
 * undoes anything: the authority is already gone, so a Job that no canceller reached cannot publish anyway. With none
 * registered (today) it answers zeros.
 */
export async function runCancellers(
  target: CancellationTarget,
  options: {timeoutMs?: number; log?: (message: string, detail: string) => void} = {},
): Promise<CancellationReport> {
  const {timeoutMs = cancellerTimeoutMs, log = (message: string, detail: string) => console.error(message, detail)} = options;
  const running = [...registry().values()];
  const results = await Promise.allSettled(
    running.map((canceller) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      });
      // A canceller that throws synchronously is a failed canceller, not a failed disable.
      const work = Promise.resolve().then(() => canceller.cancel({accountId: target.accountId, epoch: target.epoch}));
      return Promise.race([work, limit]).finally(() => clearTimeout(timer));
    }),
  );
  let cancelled = 0;
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && Number.isSafeInteger(result.value) && result.value >= 0) {
      cancelled += result.value;
      return;
    }
    failed += 1;
    log(`The canceller ${running[index].name} did not finish.`, result.status === 'rejected' ? describe(result.reason) : 'it did not answer with a count');
  });
  return {cancellers: running.length, cancelled, failed};
}

// Targets -------------------------------------------------------------------------------------------------------

export type {TargetKind};
/** What a step names: a kind of target (lib/lifecycle.ts `targetKinds`; `account` is the operation's own) and its ID. */
export type Target = {kind: TargetKind; id: string};

/**
 * `allowed` carries the Account's current epoch. Anything else is a denial, with the reason: those of `authorizeStep`, and
 * `unavailable`, the one answer for a target that is another Account's, unknown, deleted or tombstoned (and for an ID that is not an ID).
 */
export type TargetDecision = {allowed: true; epoch: number} | {allowed: false; reason: DeniedReason | 'unavailable'};

/**
 * Whether the operation may act on this target now: `api.guard_target`, which asks the Account first, exactly as `authorizeStep`
 * does, and then the target, tombstone guard included. Like `authorizeStep` it never throws, never answers `allowed` unless the
 * database said so, and treats an answer it cannot get as a denial. Ask before EVERY step that publishes, moves a file or reaches
 * outside, for each target the step touches.
 */
export async function authorizeTarget(operation: Operation, target: Target, options: StepOptions = {}): Promise<TargetDecision> {
  const {log = (message: string, detail: string) => console.error(message, detail), ...accountsOptions} = options;
  try {
    if (!(targetKinds as readonly unknown[]).includes(target?.kind)) throw new TypeError('kind must be one of the target kinds');
    const guard = await guardTarget({accountId: operation.accountId, epoch: operation.epoch, kind: target.kind, id: target.id}, accountsOptions);
    if (guard.outcome === 'allowed' && guard.epoch !== null) return {allowed: true, epoch: guard.epoch};
    return {allowed: false, reason: guard.outcome === 'allowed' ? 'unreachable' : guard.outcome};
  } catch (error) {
    if (error instanceof TypeError) {
      log('A target step was denied (the operation or the target is malformed).', describe(error));
      return {allowed: false, reason: 'invalid'};
    }
    log('A target step was denied (the authority check could not be made).', describe(error));
    return {allowed: false, reason: 'unreachable'};
  }
}
