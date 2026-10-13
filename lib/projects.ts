// Story 1.7. The application side of the Projects functions: typed calls to the `api` schema with the service role.
//
// SERVER-ONLY (it imports lib/accounts.ts, which holds the service-role key and refuses to load in a browser). A client component
// takes a Project from its page as a plain `ProjectRow` (lib/project-view.ts) and never imports this file.
//
// Every call names the Account and the epoch it is made for, and both come from an `Operation` (lib/authority.ts `operationOf`):
// the live authorization of the request that started it, never the request itself. The database begins every function with
// `identity.assert_operation_authority(account, epoch)`, so a disabled Account, a revoked session and a stale epoch are refused
// there as well as at the gate, and answered `denied`. A Project that is another Account's, deleted, unknown or not an ID at all
// is `unavailable`, and the answer says nothing else: it carries no field of any Project.
//
// Nothing here logs. An error that comes out of the database layer names the call and the HTTP status, never a title or an ID
// (lib/accounts.ts), and a title is never part of any message this module makes.
import {callRow, oneOf, requireUuid, unexpected, type AccountsOptions, type Row} from '@/lib/accounts';
import type {Operation} from '@/lib/authority';
import {isProjectStage} from '@/lib/project-stage';
import {projectIdOf, type ProjectRow} from '@/lib/project-view';

export type {ProjectRow};

/** The most Projects a list carries: the 200 most recently updated. `total` still counts every one. */
export const maxListed = 200;

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const wholeNumber = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

function requireOperation(operation: Operation) {
  if (!Number.isSafeInteger(operation.epoch) || operation.epoch < 1) throw new TypeError('epoch must be a positive integer');
  return {p_account_id: requireUuid('accountId', operation.accountId), p_epoch: operation.epoch};
}

/** A Project as the database returned it, checked: a row that is not shaped like one is no answer. */
function rowOf(value: unknown): ProjectRow {
  const row = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Row;
  const id = text(row.id);
  const title = text(row.title);
  const stage = row.stage;
  const currentVersion = wholeNumber(row.current_version);
  const revision = wholeNumber(row.revision);
  const createdAt = text(row.created_at);
  const updatedAt = text(row.updated_at);
  if (!id || !projectIdOf(id) || title === null || !isProjectStage(stage) || currentVersion === null || revision === null || revision < 1 || !createdAt || !updatedAt) throw unexpected();
  return {id: id.toLowerCase(), title, stage, currentVersion, revision, createdAt, updatedAt};
}

// The list ----------------------------------------------------------------------------------------------------------------

/**
 * `listed`: the Account's Projects, newest update first, and `total`, the count of all of them (more than `projects` when the
 * Account has more than `limit`). `denied`: the Account has no authority for this request; nothing is listed.
 */
export type ProjectList = {outcome: 'listed'; projects: ProjectRow[]; total: number} | {outcome: 'denied'};

/**
 * The Account's Projects, newest update first (at most `limit`, never more than 200). Fails closed: if the database cannot be
 * reached this throws an AccountsUnavailableError, and the page says so; it never shows an empty list in place of a list it could
 * not read.
 */
export async function listProjects(operation: Operation, input: {limit?: number} = {}, options: AccountsOptions = {}): Promise<ProjectList> {
  const limit = input.limit ?? maxListed;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListed) throw new TypeError('limit must be a whole number from 1 to 200');
  const row = await callRow('list_projects', {...requireOperation(operation), p_limit: limit}, options);
  const outcome = oneOf(row.outcome, ['listed', 'denied'] as const);
  if (outcome === 'denied') return {outcome};
  const total = wholeNumber(row.total);
  if (total === null || !Array.isArray(row.projects)) throw unexpected();
  const projects = row.projects.map(rowOf);
  // A list that holds more than it was asked for, or than there are, is not an answer.
  if (projects.length > limit || projects.length > total) throw unexpected();
  return {outcome, projects, total};
}

// One Project ---------------------------------------------------------------------------------------------------------------

/**
 * `found`: the Project. `unavailable`: it is another Account's, deleted, unknown or not an ID, and nothing more is known: the
 * four cannot be told apart. `denied`: the Account has no authority for this request.
 */
export type ProjectRead = {outcome: 'found'; project: ProjectRow} | {outcome: 'unavailable'} | {outcome: 'denied'};

/**
 * One Project of the Account. Anything that is not a Project ID is `unavailable` without asking the database (it cannot be any
 * Account's). Fails closed: if the database cannot be reached this throws, and the caller shows a retryable error, never
 * `unavailable`: "the database did not answer" must not look like "this Project is not yours".
 */
export async function readProject(operation: Operation, projectId: unknown, options: AccountsOptions = {}): Promise<ProjectRead> {
  const id = projectIdOf(projectId);
  const args = requireOperation(operation);
  if (!id) return {outcome: 'unavailable'};
  const row = await callRow('get_project', {...args, p_project_id: id}, options);
  const outcome = oneOf(row.outcome, ['found', 'unavailable', 'denied'] as const);
  if (outcome !== 'found') return {outcome};
  const project = rowOf(row);
  // The row of another Project than the one asked for is not an answer.
  if (project.id !== id) throw unexpected();
  return {outcome, project};
}

// Rename ---------------------------------------------------------------------------------------------------------------------

/**
 * What api.rename_project answers. `renamed` carries the title and revision the Project has now (with `replayed`, the original
 * receipt of the same command sent again: nothing changed now). `stale` carries the title and revision it has now and changed
 * nothing. `reused`, `unavailable` and `denied` carry nothing and changed nothing.
 */
export type RenameReceipt =
  | {outcome: 'renamed'; projectId: string; title: string; revision: number; replayed: boolean}
  | {outcome: 'stale'; projectId: string; title: string; revision: number}
  | {outcome: 'reused'}
  | {outcome: 'unavailable'}
  | {outcome: 'denied'};

/**
 * Renames a Project: the first command, carrying the Account (from `operation`), a command ID, the revision the person saw and
 * a typed payload (the title, already normalized and checked by the caller; the database checks it again). The command ID makes
 * a retry safe: sent again with the same Project, revision and title it answers the original receipt, and sent with another
 * payload it is `reused`. If this throws an AccountsUnavailableError with `outcomeUnknown`, the rename may or may not have been
 * made: the caller tells the person to check the name, and may send the same command again.
 */
export async function renameProjectCommand(
  operation: Operation,
  input: {commandId: string; projectId: string; expectedRevision: number; title: string},
  options: AccountsOptions = {},
): Promise<RenameReceipt> {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new TypeError('expectedRevision must be a positive integer');
  const row = await callRow(
    'rename_project',
    {
      ...requireOperation(operation),
      p_command_id: requireUuid('commandId', input.commandId),
      p_project_id: requireUuid('projectId', input.projectId),
      p_expected_revision: input.expectedRevision,
      p_title: input.title,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['renamed', 'stale', 'reused', 'unavailable', 'denied'] as const);
  if (outcome === 'reused' || outcome === 'unavailable' || outcome === 'denied') return {outcome};
  const projectId = text(row.project_id);
  const title = text(row.title);
  const revision = wholeNumber(row.revision);
  // An answer that does not say which Project it is about, or what it holds now, is not an answer.
  if (!projectId || !projectIdOf(projectId) || title === null || revision === null || revision < 1) throw unexpected();
  if (outcome === 'stale') return {outcome, projectId: projectId.toLowerCase(), title, revision};
  return {outcome, projectId: projectId.toLowerCase(), title, revision, replayed: row.replayed === true};
}
