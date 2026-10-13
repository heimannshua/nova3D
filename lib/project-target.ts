// Story 1.7. The Project target resolver: may THIS operation act on THIS Project NOW, and what is it? Story 1.12's file gateway
// and Story 1.8's status route register it for the kind of target "project"; until they do, nothing calls it but the tests.
// docs/authority-contract.md is the short version for the people who write them.
//
// It sits on top of the authority contract (lib/authority.ts). An operation acts for an Account under an epoch
// (`operationOf(access.account)`), and asks the resolver before a step that publishes, moves a file or reaches outside, once for
// each step. The answer is the database's, asked afresh every time (`api.get_project`, which begins with
// `identity.assert_operation_authority`): live ownership and lifecycle, nothing remembered from the request that started the
// operation and nothing cached.
//
//   resolved     the Project exists, is this Account's and is not deleted; it carries its current revision
//   unavailable  the Project is another Account's, deleted, unknown or not an ID at all. These four are ONE answer, with
//                nothing in it: a caller that shows it shows the same page for each, so a link cannot be used to find out
//                whether a Project exists
//   denied       the Account has no authority for this request (disabled, or under another epoch than the operation's)
//   unreachable  the database did not answer, or answered something that is not an answer
//
// Only `resolved` is permission. `denied` and `unreachable` are denials, and `unreachable` is NOT `unavailable`: a page that
// cannot reach the database says "try again", it never says "this Project is not yours".
//
// SERVER-ONLY (it imports lib/projects.ts).
import type {AccountsOptions} from '@/lib/accounts';
import type {Operation} from '@/lib/authority';
import {readProject} from '@/lib/projects';

export type TargetResolution =
  | {outcome: 'resolved'; accountId: string; projectId: string; revision: number}
  | {outcome: 'unavailable'}
  | {outcome: 'denied'}
  | {outcome: 'unreachable'};

export type ResolveOptions = AccountsOptions & {
  /** Called, with a name and message only, when the check could not be made. Defaults to console.error. */
  log?: (message: string, detail: string) => void;
};

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/**
 * Resolves a Project target for an operation. It never throws and never answers `resolved` unless the database said so; an
 * operation that is not shaped like one, or a database that cannot answer, is `unreachable`.
 */
export async function resolveProjectTarget(operation: Operation, projectId: unknown, options: ResolveOptions = {}): Promise<TargetResolution> {
  const {log = (message: string, detail: string) => console.error(message, detail), ...accountsOptions} = options;
  try {
    const read = await readProject(operation, projectId, accountsOptions);
    if (read.outcome === 'found') return {outcome: 'resolved', accountId: operation.accountId, projectId: read.project.id, revision: read.project.revision};
    return {outcome: read.outcome};
  } catch (error) {
    log('A Project target could not be resolved; the step is denied.', describe(error));
    return {outcome: 'unreachable'};
  }
}
