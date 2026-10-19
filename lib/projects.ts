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
import {isPictureType, maxPictures} from '@/lib/picture-set';
import {isViewLabel, type ViewLabel} from '@/lib/picture-quality';
import {projectIdOf, type ProjectRequestRow, type ProjectRow, type RequestPicture} from '@/lib/project-view';
import {declineReasons, requestModes, type ConfirmedRequest, type DeclineReason, type PersonalizationStyle, type RequestMode} from '@/lib/request-intake';

export type {ProjectRequestRow, ProjectRow};

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

// Request revisions (Story 2.1) -----------------------------------------------------------------------------------------------

/**
 * What api.create_project_request answers. `created` and `replayed` carry the IDs of the Project and of its first request revision
 * (`replayed`: the same command sent again with the same payload, the original receipt, nothing written now). `reused`: the command
 * ID was used before for another payload, or by a rename; nothing was written. `unavailable`: the command was a replay, but the Project
 * it created has since been deleted or tombstoned (a receipt does not outlive its Project's visibility); nothing was written and there is
 * no Project to go to. `denied`: the Account has no authority for this request; nothing was written.
 */
export type CreateRequestReceipt =
  | {outcome: 'created' | 'replayed'; projectId: string; requestId: string}
  | {outcome: 'reused'}
  | {outcome: 'unavailable'}
  | {outcome: 'denied'};

/**
 * Confirms a request: ONE database transaction creates the Project (titled with the subject's display name, in the stage
 * `request_confirmed`) and its request revision 1, holding exactly the values given. `request` is what `checkRequest`
 * (lib/request-intake.ts) worked out from the submitted fields; the database checks every shape again. The command ID makes a retry
 * safe: sent again with the same payload it answers the original receipt, and with another payload it is `reused`. If this throws an
 * AccountsUnavailableError with `outcomeUnknown`, the Project may or may not have been created: the caller tells the person to check
 * My Projects, and may send the same command again. Nothing here starts research, approves a plan or spends anything.
 */
export async function createProjectRequest(
  operation: Operation,
  input: {commandId: string; request: ConfirmedRequest},
  options: AccountsOptions = {},
): Promise<CreateRequestReceipt> {
  const {request} = input;
  const row = await callRow(
    'create_project_request',
    {
      ...requireOperation(operation),
      p_command_id: requireUuid('commandId', input.commandId),
      p_title: request.title,
      p_mode: request.mode,
      p_subject_id: request.subjectId,
      p_scope: request.scope,
      p_outcome: request.outcome,
      p_description: request.description,
      p_personalization_wording: request.personalization.wording,
      p_personalization_text: request.personalization.text,
      p_personalization_style: request.personalization.style,
      p_personalization_applied: request.personalization.applied,
      p_personalization_reason: request.personalization.reason,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['created', 'replayed', 'reused', 'unavailable', 'denied'] as const);
  if (outcome === 'reused' || outcome === 'unavailable' || outcome === 'denied') return {outcome};
  const projectId = text(row.project_id);
  const requestId = text(row.request_id);
  // An answer that does not say which Project and revision it made is not an answer.
  if (!projectId || !projectIdOf(projectId) || !requestId || !projectIdOf(requestId)) throw unexpected();
  return {outcome, projectId: projectId.toLowerCase(), requestId: requestId.toLowerCase()};
}

/**
 * `found`: the latest request revision of the Project (confirmed, or an unconfirmed picture request with its pictures). `none`: the Project has no
 * revision (one that was made before requests were recorded, or by a seed). `unavailable`: the Project is another Account's, deleted, tombstoned, unknown or not an ID, and the four
 * cannot be told apart. `denied`: the Account has no authority for this request.
 */
export type ProjectRequestRead = {outcome: 'found'; request: ProjectRequestRow} | {outcome: 'none'} | {outcome: 'unavailable'} | {outcome: 'denied'};

const oneOfModes = (value: unknown): RequestMode => oneOf(value, requestModes);
const styleOf = (value: unknown): PersonalizationStyle | null => (value === 'raised' || value === 'recessed' ? value : null);
const reasonOf = (value: unknown): DeclineReason | null => (typeof value === 'string' && (declineReasons as readonly string[]).includes(value) ? (value as DeclineReason) : null);

/**
 * The label and measurements of a picture as the database returned them, checked: all four are present (a picture of a revision that was reviewed) or all four are
 * null (a set that was never reviewed). They are claims of the browser, stored as sent; here only their shape and range are checked.
 */
function reviewOf(picture: Row): Pick<RequestPicture, 'label' | 'shortEdgePx' | 'blurVariance' | 'clippedFraction'> {
  const {label, short_edge_px: shortEdge, blur_variance: blur, clipped_fraction: clipped} = picture;
  if (label === null && shortEdge === null && blur === null && clipped === null) return {label: null, shortEdgePx: null, blurVariance: null, clippedFraction: null};
  if (
    !isViewLabel(label) || typeof shortEdge !== 'number' || !Number.isSafeInteger(shortEdge) || shortEdge < 1 ||
    typeof blur !== 'number' || !Number.isFinite(blur) || blur < 0 || blur > 1040400 ||
    typeof clipped !== 'number' || !Number.isFinite(clipped) || clipped < 0 || clipped > 1
  ) {
    throw unexpected();
  }
  return {label, shortEdgePx: shortEdge, blurVariance: blur, clippedFraction: clipped};
}

/** The pictures of a revision as the database returned them, checked: positions 1, 2, 3... in order, each with a SHA-256, a length and a type a picture can have, and its label and measurements or none. */
function picturesOf(value: unknown): RequestPicture[] {
  if (!Array.isArray(value) || value.length > maxPictures) throw unexpected();
  return value.map((entry, index): RequestPicture => {
    const picture = (typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry : {}) as Row;
    const uploadId = text(picture.upload_id);
    const sha256 = text(picture.sha256);
    const contentType = picture.content_type;
    const length = wholeNumber(picture.length);
    const expiresAt = picture.expires_at === null ? null : text(picture.expires_at);
    if (
      picture.position !== index + 1 || !uploadId || !projectIdOf(uploadId) || !sha256 || !/^[0-9a-f]{64}$/.test(sha256) ||
      !isPictureType(contentType) || length === null || length < 1 || (picture.expires_at !== null && !expiresAt) || typeof picture.available !== 'boolean'
    ) {
      throw unexpected();
    }
    return {position: index + 1, uploadId: uploadId.toLowerCase(), sha256, length, contentType, expiresAt, available: picture.available, ...reviewOf(picture)};
  });
}

/** A request revision as the database returned it, checked: one that contradicts itself is no answer. */
function requestOf(row: Row): ProjectRequestRow {
  const requestId = text(row.request_id);
  const projectId = text(row.project_id);
  const seq = wholeNumber(row.seq);
  const mode = oneOfModes(row.mode);
  const subjectId = row.subject_id === null ? null : text(row.subject_id);
  const scope = row.scope === null ? null : text(row.scope);
  const outcome = row.intended_outcome === null ? null : text(row.intended_outcome);
  const description = row.description === null ? null : text(row.description);
  const wording = row.personalization_wording === null ? null : text(row.personalization_wording);
  const wishText = row.personalization_text === null ? null : text(row.personalization_text);
  const style = row.personalization_style === null ? null : styleOf(row.personalization_style);
  const reason = row.personalization_reason === null ? null : reasonOf(row.personalization_reason);
  const confirmedAt = row.confirmed_at === null ? null : text(row.confirmed_at);
  const images = picturesOf(row.images);
  const obstructionConfirmedAt = row.obstruction_confirmed_at === null ? null : text(row.obstruction_confirmed_at);
  const acknowledgedAt = row.acknowledged_at === null ? null : text(row.acknowledged_at);
  if (
    !requestId || !projectId || !projectIdOf(requestId) || !projectIdOf(projectId) || seq === null || seq < 1 || typeof row.confirmed !== 'boolean' ||
    typeof row.obstruction_confirmed !== 'boolean' || typeof row.acknowledged !== 'boolean' ||
    (row.obstruction_confirmed_at !== null && !obstructionConfirmedAt) || (row.acknowledged_at !== null && !acknowledgedAt) ||
    row.obstruction_confirmed !== (obstructionConfirmedAt !== null) || row.acknowledged !== (acknowledgedAt !== null) ||
    (row.subject_id !== null && subjectId === null) ||
    (row.scope !== null && !scope) || (row.intended_outcome !== null && !outcome) || (row.description !== null && !description) || (row.confirmed_at !== null && !confirmedAt) ||
    (row.personalization_wording !== null && !wording) || (row.personalization_text !== null && !wishText) ||
    (row.personalization_style !== null && style === null) || (row.personalization_reason !== null && reason === null) ||
    typeof row.personalization_applied !== 'boolean'
  ) {
    throw unexpected();
  }
  const confirmed = row.confirmed;
  // A revision is confirmed with everything it confirmed, or claims none of it: the record's own rule (request_revisions_confirmed_shape). A confirmed revision
  // has a time, a scope and an outcome; its description is required unless the revision is direct image-derived conversion, which has no subject to describe.
  if (confirmed ? !confirmedAt || !scope || !outcome || (!description && mode !== 'image_direct') : confirmedAt !== null || description !== null || scope !== null || outcome !== null) throw unexpected();
  // The review (Story 2.3) belongs to a picture request, and an acknowledgment to a confirmed direct one that also had its obstruction question answered.
  if ((obstructionConfirmedAt !== null && mode === 'evidence_text') || (acknowledgedAt !== null && (mode !== 'image_direct' || !confirmed || obstructionConfirmedAt === null))) throw unexpected();
  const applied = row.personalization_applied;
  // The record's own rules: an applied wish has its wording, text and style, a wish that was not applied has no text or style, and a reason
  // belongs to a wording that was not applied.
  if (applied ? !wording || !wishText || !style || reason !== null : wishText !== null || style !== null || (reason !== null) !== (wording !== null)) throw unexpected();
  // An unconfirmed revision says nothing about a subject or a wish, and a text request is always confirmed.
  if (!confirmed && (subjectId !== null || wording !== null || applied || mode === 'evidence_text')) throw unexpected();
  return {
    id: requestId.toLowerCase(),
    projectId: projectId.toLowerCase(),
    seq,
    mode,
    confirmed,
    subjectId,
    scope,
    outcome,
    description,
    personalization: {wording, text: wishText, style, applied, reason},
    confirmedAt,
    images,
    obstructionConfirmed: obstructionConfirmedAt !== null,
    obstructionConfirmedAt,
    acknowledged: acknowledgedAt !== null,
    acknowledgedAt,
  };
}

/**
 * The latest request revision of a Project of the Account. Anything that is not a Project ID is `unavailable` without asking the
 * database. Fails closed: if the database cannot be reached this throws, and the caller shows a retryable error, never `unavailable`.
 */
export async function readProjectRequest(operation: Operation, projectId: unknown, options: AccountsOptions = {}): Promise<ProjectRequestRead> {
  const id = projectIdOf(projectId);
  const args = requireOperation(operation);
  if (!id) return {outcome: 'unavailable'};
  const row = await callRow('read_project_request', {...args, p_project_id: id}, options);
  const outcome = oneOf(row.outcome, ['found', 'none', 'unavailable', 'denied'] as const);
  if (outcome !== 'found') return {outcome};
  const request = requestOf(row);
  // The revision of another Project than the one asked for is not an answer.
  if (request.projectId !== id) throw unexpected();
  return {outcome, request};
}

// Picture sets (Story 2.2) ---------------------------------------------------------------------------------------------------

/**
 * What api.record_picture_set answers.
 *  - `created`: the Project was born with its first picture revision; `revised`: a successor was recorded; `replayed`: the same command sent again, the
 *    original receipt (nothing written now); `unchanged`: the same pictures in the same order as the latest revision (no revision is written and nothing
 *    is released, but the included uploads' leases are renewed within the usual bound). All four carry the Project and the revision. `released` counts the
 *    uploads a successor released.
 *  - `unknown_upload`, `not_ready`, `expired_upload`, `duplicate_image`: the upload at `position` (1 is the first) is not the Account's own picture, is
 *    not complete, has expired, or holds the same SHA-256 (read from its lease) as an earlier picture of the set. Nothing was written.
 *  - `too_large`: the lengths read from the leases add up to more than 60 MiB. `reused`: the command ID was used before for something else (another
 *    set, or a rename). `unavailable`: the Project is another Account's, deleted, tombstoned or unknown (one answer), or a replay whose Project has
 *    since gone. `not_editable`: the Project's request is not an unconfirmed picture request. `denied`: the Account has no authority for this request.
 */
export type PictureSetReceipt =
  | {outcome: 'created' | 'revised' | 'replayed' | 'unchanged'; projectId: string; requestId: string; seq: number; released: number}
  | {outcome: 'unknown_upload' | 'not_ready' | 'expired_upload' | 'duplicate_image'; position: number}
  | {outcome: 'too_large' | 'reused' | 'unavailable' | 'not_editable' | 'denied'};

const pictureSetOutcomes = ['created', 'revised', 'replayed', 'unchanged', 'unknown_upload', 'not_ready', 'expired_upload', 'duplicate_image', 'too_large', 'reused', 'unavailable', 'not_editable', 'denied'] as const;

/** Upload IDs for a call: 1 to 12 UUIDs, none repeated, in the order the person gave. */
function requireUploadIds(uploadIds: readonly string[]): string[] {
  if (uploadIds.length < 1 || uploadIds.length > maxPictures) throw new TypeError(`uploadIds must hold 1 to ${maxPictures} IDs`);
  const ids = uploadIds.map((id) => requireUuid('uploadId', id));
  if (new Set(ids).size !== ids.length) throw new TypeError('uploadIds must not repeat an ID');
  return ids;
}

/**
 * Records the ordered pictures as an unconfirmed request revision: ONE database transaction creates the Project (`projectId` null, with its `title`, in
 * the stage `request_draft`) and revision 1, or appends a successor to an existing unconfirmed picture Project (no `title`). The database reads each
 * upload's SHA-256, length and type from its lease, so nothing the browser said about a file is used; it enforces the limits, renews the leases within a
 * bound and releases the uploads that left the set. The command ID makes a retry safe: sent again with the same set it answers the original receipt. If
 * this throws an AccountsUnavailableError with `outcomeUnknown`, the set may or may not have been recorded: the caller tells the person to check My
 * Projects, and may send the same command again. Nothing here confirms, researches or charges.
 */
export async function recordPictureSet(
  operation: Operation,
  input: {commandId: string; projectId: string | null; title: string | null; uploadIds: readonly string[]},
  options: AccountsOptions = {},
): Promise<PictureSetReceipt> {
  const row = await callRow(
    'record_picture_set',
    {
      ...requireOperation(operation),
      p_command_id: requireUuid('commandId', input.commandId),
      p_project_id: input.projectId === null ? null : requireUuid('projectId', input.projectId),
      p_title: input.title,
      p_upload_ids: requireUploadIds(input.uploadIds),
    },
    options,
  );
  const outcome = oneOf(row.outcome, pictureSetOutcomes);
  if (outcome === 'too_large' || outcome === 'reused' || outcome === 'unavailable' || outcome === 'not_editable' || outcome === 'denied') return {outcome};
  if (outcome === 'unknown_upload' || outcome === 'not_ready' || outcome === 'expired_upload' || outcome === 'duplicate_image') {
    const position = wholeNumber(row.position);
    // An answer about an upload that does not say which one is not an answer.
    if (position === null || position < 1 || position > input.uploadIds.length) throw unexpected();
    return {outcome, position};
  }
  const projectId = text(row.project_id);
  const requestId = text(row.request_id);
  const seq = wholeNumber(row.seq);
  const released = row.released === null || row.released === undefined ? 0 : wholeNumber(row.released);
  if (!projectId || !projectIdOf(projectId) || !requestId || !projectIdOf(requestId) || seq === null || seq < 1 || released === null) throw unexpected();
  return {outcome, projectId: projectId.toLowerCase(), requestId: requestId.toLowerCase(), seq, released};
}

/**
 * Releases the Account's own picture uploads that no request revision uses (a picture replaced or removed before it was saved), at once: they stop
 * counting toward the Account's staging quota. Answers how many were released; `denied` when the Account has no authority for this request. Anything else
 * in the list (another Account's upload, an unknown one, one a revision uses) is left alone and not counted.
 */
export async function releaseStagedPictures(operation: Operation, uploadIds: readonly string[], options: AccountsOptions = {}): Promise<{outcome: 'released'; released: number} | {outcome: 'denied'}> {
  const row = await callRow('release_staged_pictures', {...requireOperation(operation), p_upload_ids: requireUploadIds(uploadIds)}, options);
  const outcome = oneOf(row.outcome, ['released', 'denied'] as const);
  if (outcome === 'denied') return {outcome};
  const released = wholeNumber(row.released);
  if (released === null || released > uploadIds.length) throw unexpected();
  return {outcome, released};
}

// Picture reviews (Story 2.3) ---------------------------------------------------------------------------------------------------

/** The modes a picture review can record: `evidence_images` (research-assisted reconstruction) or `image_direct` (direct image-derived conversion). */
export type ReviewMode = 'evidence_images' | 'image_direct';

/** One picture of a review, in the person's order: its upload, the label the person gave it, and the three numbers the browser measured (claims, stored as sent). */
export type ReviewedImage = {uploadId: string; label: ViewLabel; shortEdgePx: number; blurVariance: number; clippedFraction: number};

/**
 * What api.record_picture_review answers.
 *  - `created`: the successor revision was recorded; `replayed`: the same command sent again, the original receipt (nothing written now); `unchanged`: the latest
 *    revision already holds exactly this review (a lost answer, then Confirm pressed again under a new command): nothing was recorded, the leases were renewed. All
 *    three carry the Project, the revision and its `seq`.
 *  - `stale`: the Project's latest revision is not the one that was reviewed (another window saved a newer set or review, or the pictures changed); nothing was
 *    written. `seq` is the latest revision's when the database says (null when the Project has no revision).
 *  - `unknown_upload`, `not_ready`, `expired_upload`: the upload at `position` (1 is the first) is not the Account's own picture, is not complete, or has expired.
 *  - `obstruction_not_confirmed`: the person did not confirm that nothing blocks the subject. `acknowledgment_required`: direct conversion with incomplete inputs
 *    (the database decides from the labels and measurements) without the Generate anyway acknowledgment. Nothing was written for any of these.
 *  - `reused`: the command ID was used before for something else. `unavailable`: the Project is another Account's, deleted, tombstoned or unknown (one answer), or a
 *    replay whose Project has since gone. `not_editable`: the Project's request is a text request. `denied`: the Account has no authority for this request.
 */
export type PictureReviewReceipt =
  | {outcome: 'created' | 'replayed' | 'unchanged'; projectId: string; requestId: string; seq: number}
  | {outcome: 'stale'; seq: number | null}
  | {outcome: 'unknown_upload' | 'not_ready' | 'expired_upload'; position: number}
  | {outcome: 'reused' | 'unavailable' | 'not_editable' | 'obstruction_not_confirmed' | 'acknowledgment_required' | 'denied'};

const pictureReviewOutcomes = [
  'created', 'replayed', 'unchanged', 'stale', 'unknown_upload', 'not_ready', 'expired_upload', 'obstruction_not_confirmed', 'acknowledgment_required', 'reused', 'unavailable', 'not_editable', 'denied',
] as const;

/** The images of a call as the database takes them: 1 to 12, none repeated, each with a label from the seven and measurements in range. A call that is not shaped like this is a bug. */
function requireReviewedImages(images: readonly ReviewedImage[]) {
  if (images.length < 1 || images.length > maxPictures) throw new TypeError(`images must hold 1 to ${maxPictures} pictures`);
  const ids = new Set<string>();
  return images.map((image) => {
    const uploadId = requireUuid('uploadId', image.uploadId);
    if (ids.has(uploadId)) throw new TypeError('images must not repeat an upload');
    ids.add(uploadId);
    if (!isViewLabel(image.label)) throw new TypeError('label must be one of the seven views');
    if (!Number.isSafeInteger(image.shortEdgePx) || image.shortEdgePx < 1) throw new TypeError('shortEdgePx must be a positive integer');
    if (!Number.isFinite(image.blurVariance) || image.blurVariance < 0 || image.blurVariance > 1040400) throw new TypeError('blurVariance must be from 0 to 1,040,400');
    if (Number(image.blurVariance.toFixed(3)) !== image.blurVariance) throw new TypeError('blurVariance has at most 3 decimals');
    if (!Number.isFinite(image.clippedFraction) || image.clippedFraction < 0 || image.clippedFraction > 1) throw new TypeError('clippedFraction must be from 0 to 1');
    if (Number(image.clippedFraction.toFixed(4)) !== image.clippedFraction) throw new TypeError('clippedFraction has at most 4 decimals');
    return {upload_id: uploadId, label: image.label, short_edge_px: image.shortEdgePx, blur_variance: image.blurVariance, clipped_fraction: image.clippedFraction};
  });
}

/**
 * Records the review of a Project's pictures: ONE database transaction raises the Project's revision by one and appends a successor request revision (`expectedSeq` + 1)
 * holding the mode, the person's labels and the browser's measurements of each picture in order (the database stores them as sent and trusts none of them), that the
 * person confirmed nothing blocks the subject, and, for `image_direct`, the confirmed scope and outcome (and, when the database finds the inputs incomplete, the
 * Generate anyway acknowledgment pinned to the ordered pictures and the scope). Research-assisted (`evidence_images`) records the choice and nothing else: no scope.
 * The command ID makes a retry safe. If this throws an AccountsUnavailableError with `outcomeUnknown`, the review may or may not have been recorded: the caller
 * tells the person to check the Project, and may send the same command again. Nothing here converts, researches, retains or charges.
 */
export async function recordPictureReview(
  operation: Operation,
  input: {
    commandId: string;
    projectId: string;
    expectedSeq: number;
    mode: ReviewMode;
    scope: string | null;
    outcome: string | null;
    images: readonly ReviewedImage[];
    obstructionConfirmed: boolean;
    acknowledge: boolean;
  },
  options: AccountsOptions = {},
): Promise<PictureReviewReceipt> {
  if (!Number.isSafeInteger(input.expectedSeq) || input.expectedSeq < 1) throw new TypeError('expectedSeq must be a positive integer');
  // A scope and an outcome belong to direct conversion exactly: research-assisted reconstruction confirms none until the subject is identified.
  if (input.mode !== 'evidence_images' && input.mode !== 'image_direct') throw new TypeError('mode must be evidence_images or image_direct');
  if (input.mode === 'evidence_images' && (input.scope !== null || input.outcome !== null)) throw new TypeError('research-assisted reconstruction has no scope or outcome');
  if (input.mode === 'image_direct' && (input.scope === null || input.outcome === null)) throw new TypeError('direct conversion needs a scope and an outcome');
  const row = await callRow(
    'record_picture_review',
    {
      ...requireOperation(operation),
      p_command_id: requireUuid('commandId', input.commandId),
      p_project_id: requireUuid('projectId', input.projectId),
      p_expected_seq: input.expectedSeq,
      p_mode: input.mode,
      p_scope: input.scope,
      p_outcome: input.outcome,
      p_images: requireReviewedImages(input.images),
      p_obstruction_confirmed: input.obstructionConfirmed,
      p_acknowledge: input.acknowledge,
    },
    options,
  );
  const outcome = oneOf(row.outcome, pictureReviewOutcomes);
  if (outcome === 'reused' || outcome === 'unavailable' || outcome === 'not_editable' || outcome === 'obstruction_not_confirmed' || outcome === 'acknowledgment_required' || outcome === 'denied') {
    return {outcome};
  }
  if (outcome === 'stale') {
    const seq = row.seq === null || row.seq === undefined ? null : wholeNumber(row.seq);
    if (row.seq !== null && row.seq !== undefined && (seq === null || seq < 1)) throw unexpected();
    return {outcome, seq};
  }
  if (outcome === 'unknown_upload' || outcome === 'not_ready' || outcome === 'expired_upload') {
    const position = wholeNumber(row.position);
    // An answer about an upload that does not say which one is not an answer.
    if (position === null || position < 1 || position > input.images.length) throw unexpected();
    return {outcome, position};
  }
  const projectId = text(row.project_id);
  const requestId = text(row.request_id);
  const seq = wholeNumber(row.seq);
  if (!projectId || !projectIdOf(projectId) || !requestId || !projectIdOf(requestId) || seq === null || seq < 2) throw unexpected();
  return {outcome, projectId: projectId.toLowerCase(), requestId: requestId.toLowerCase(), seq};
}
