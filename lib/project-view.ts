// Story 1.7. What the Project pages (app/page.tsx, app/projects), the Rename Server Action (app/projects/actions.ts) and the
// components under components/projects agree on, with nothing that reaches the server: a Project as a page shows it, how an ID
// from a URL or a form is read, the rules for a title, the state the Rename action answers with, how a call that did not answer
// is read, and how an update time is written. A client component imports this file, so it imports no Node or Next.js server code
// and not lib/accounts.ts or lib/projects.ts (whose shapes this file repeats instead).
import {attemptAdministeredAction, formatCreatedAt, isoOf} from '@/lib/administration';
import type {MessageKey, Translator} from '@/lib/i18n';
import type {SavedPicture} from '@/lib/picture-set';
import type {ProjectStage} from '@/lib/project-stage';
import type {DeclineReason, PersonalizationStyle, RequestMode} from '@/lib/request-intake';
import {reloadHere} from '@/lib/session-actions';

/**
 * One Project as a page shows it. Everything a person may read about one, and nothing else: the database returns no more (the
 * status handle in particular is returned by no function).
 */
export type ProjectRow = {
  id: string;
  title: string;
  stage: ProjectStage;
  /** The Version the Project is at; 0 means it has none yet. */
  currentVersion: number;
  /** Rises by one with each committed command. The Rename form sends the one it saw, and a stale one is refused. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * The request a Project holds (Story 2.1, Story 2.2), as its page shows it: the latest request revision. Everything a person may read about it, and no
 * approval, permission or payment (a revision has none). The wish is `applied` (text and style set), or declined (a wording and the `reason` it was not
 * applied), or there is none (no wording).
 *
 * A request is `confirmed` (a text request always is; it has a subject, a scope, an outcome, a description and the time) or it is a picture request saved
 * on the picture screen (Story 2.2), which claims none of those until a later story records the choice of how the pictures are used and the person's
 * confirmation: then `subjectId`, `scope`, `outcome`, `description` and `confirmedAt` are null, `mode` is the provisional `evidence_images`, and `images`
 * holds the pictures in the person's order (a revision made from text has none).
 */
export type ProjectRequestRow = {
  id: string;
  projectId: string;
  /** 1 for the first revision. */
  seq: number;
  mode: RequestMode;
  confirmed: boolean;
  /** The subject's ID in its domain package; the page shows the subject's display name for it. */
  subjectId: string | null;
  scope: string | null;
  outcome: string | null;
  description: string | null;
  personalization: {
    wording: string | null;
    text: string | null;
    style: PersonalizationStyle | null;
    applied: boolean;
    reason: DeclineReason | null;
  };
  confirmedAt: string | null;
  images: SavedPicture[];
};

// Where things are ---------------------------------------------------------------------------------------------------

export {projectsPath, projectPath, sourcesPath, newProjectPath, newPicturesPath, picturesPath} from '@/lib/project-paths';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A UUID as the database spells one, in lower case, or null for anything else (including anything that is not text). It is NOT
 * trimmed: an ID from a URL path that has white space (or anything else) around it is not a canonical ID, so it is a malformed one,
 * and a malformed ID is the unavailable page, not the Project it would name once cleaned up. Hex digits may be in either case.
 */
export function uuidOf(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  return idPattern.test(input) ? input.toLowerCase() : null;
}

/** A Project ID from a URL or a form, or null: foreign, deleted and unknown IDs are well-formed too, and only the database tells them apart. */
export const projectIdOf = uuidOf;
/** A command ID from a form, or null. */
export const commandIdOf = uuidOf;

/** A revision as a positive whole number, or null for anything else. The form sends text. */
export function revisionOf(input: unknown): number | null {
  if (typeof input !== 'string' || !/^[1-9][0-9]{0,14}$/.test(input.trim())) return null;
  return Number(input.trim());
}

// Titles -------------------------------------------------------------------------------------------------------------------

/** The longest title a Project can have. The database refuses more (api.rename_project); the form says so first. */
export const maxTitleLength = 120;

// Characters that draw nothing: controls (\p{Cc}), format characters (\p{Cf}: the zero-width space, joiners, bidi marks, the
// byte order mark), every kind of space and separator (\p{Z}), and four fill characters that are letters or marks in Unicode but
// render blank (the Braille blank, the Hangul fillers).
const invisible = /[\p{Cc}\p{Cf}\p{Z}⠀ㅤᅟᅠ]/gu;
const control = /\p{Cc}/u;

/** A title as it is sent: the surrounding white space removed. Anything that is not text is an empty title. */
export function normalizeTitle(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export type TitleProblem = 'empty' | 'too_long' | 'control';

/**
 * What is wrong with a (normalized) title, if anything: a control character anywhere in it (a tab or a new line inside the
 * name; the ones around it were trimmed), nothing that draws (which includes a name of only invisible characters), or more than
 * 120 characters (code points, as the database counts them). A control character is refused, not replaced by a space: the
 * person typed something the name cannot hold, and is told.
 */
export function titleProblem(title: string): TitleProblem | null {
  if (control.test(title)) return 'control';
  if (!title.replace(invisible, '')) return 'empty';
  return [...title].length > maxTitleLength ? 'too_long' : null;
}

export const titleErrorKeys = {
  empty: 'project.rename.error.empty',
  too_long: 'project.rename.error.tooLong',
  control: 'project.rename.error.control',
} as const satisfies Record<TitleProblem, MessageKey>;

// What the Rename action answers ---------------------------------------------------------------------------------------------

/**
 * What the Rename Server Action answers, and what the dialog keeps.
 *
 *  - `renamed` is a rename that happened (or, with `replayed`, the original receipt of the same command sent again: nothing
 *    changed now). It carries the title and revision the Project now has.
 *  - `invalid` is a title the server would not take, or (`request`) a form that is not shaped like the dialog's. The dialog
 *    checks a title first, so `request` is a request that did not come from the dialog.
 *  - `stale` is "someone renamed it first": the expected revision was not the current one, nothing changed, and the answer
 *    carries the title and revision it has now.
 *  - `reused` is a command ID that was used before for another change: nothing changed.
 *  - `gone` is a Project that is not (or is no longer) the person's to rename: another Account's, deleted, unknown.
 *  - `unavailable` is a service that did not answer. `unknown` is true when the rename may have been made anyway: the person
 *    is told to check the name before trying again.
 */
export type RenameState =
  | {outcome: 'idle'}
  | {outcome: 'renamed'; title: string; revision: number; replayed: boolean}
  | {outcome: 'invalid'; problem: TitleProblem | 'request'}
  | {outcome: 'stale'; title: string; revision: number}
  | {outcome: 'reused'}
  | {outcome: 'gone'}
  | {outcome: 'unavailable'; unknown: boolean};

export const renameIdle: RenameState = {outcome: 'idle'};

export type RenameAction = (previous: RenameState, formData: FormData) => Promise<RenameState>;

/** Calls the Rename action and reads what comes back (see `attemptAdministeredAction`): a call that did not answer is `unavailable`, and the rename may have been made. */
export function attemptRename(action: RenameAction, previous: RenameState, formData: FormData, navigate: () => void = reloadHere): Promise<RenameState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true}, navigate);
}

// Commands ---------------------------------------------------------------------------------------------------------------------

/**
 * A new command ID: a random (version 4) UUID from the browser's random source, which works in any context, a plain-http one
 * included (`crypto.randomUUID` does not). A command is identified once per change the person asks for: sent again with the same
 * Project, revision and title it is the same command, and the database answers the original receipt.
 */
export function newCommandId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Versions ---------------------------------------------------------------------------------------------------------------------

/** The Version in words: "Version 3", or that there is none yet (a Project at Version 0 has none). */
export function versionWords(t: Translator, currentVersion: number): string {
  return currentVersion > 0 ? t('project.version', {version: currentVersion}) : t('project.versionNone');
}

// Time -----------------------------------------------------------------------------------------------------------------------

/** An update time as `2026-10-12 00:24 UTC`: the same text on the server and in the browser. An unreadable time is an empty string. */
export const formatUpdated = formatCreatedAt;
/** The time as an attribute for <time>, or undefined when it cannot be read. */
export const updatedIso = isoOf;
