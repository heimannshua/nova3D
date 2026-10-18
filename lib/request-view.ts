// Story 2.1. What the two request Server Actions (app/projects/new/actions.ts) and the screens that call them
// (components/projects/request-intake.tsx) agree on, with nothing that reaches the server: the states the actions answer with, the
// messages a field problem has, and how a call that did not answer is read. A client component imports this file, so it imports no
// Node or Next.js server code and not lib/accounts.ts or lib/projects.ts.
//
// Nothing here is stored. The understanding is recomputed by the server from the submitted fields every time, so a state is only ever
// something to show, never something the server trusts back.
import {attemptAdministeredAction} from '@/lib/administration';
import type {MessageKey} from '@/lib/i18n';
import {
  maxDescriptionLength,
  maxOutcomeLength,
  maxScopeLength,
  maxWordingLength,
  type FieldProblem,
  type FieldProblemKind,
  type IntakeField,
  type Personalization,
} from '@/lib/request-intake';

export {newCommandId, newProjectPath} from '@/lib/project-view';

/** A registered subject as a screen shows it: its ID (a form value) and the name a person sees. */
export type SubjectView = {id: string; displayName: string};

// What the actions answer ------------------------------------------------------------------------------------------------------

/**
 * What `understandRequest` answers. It is free and stores nothing.
 *  - `invalid`: named field problems; nothing was understood.
 *  - `no_match`: no registered subject fits; carries the supported subjects, for the explanation.
 *  - `ambiguous`: several fit; carries them, in registry order, for the question.
 *  - `clear`: one subject fits.
 * `personalization` is the wish as understood (none, applied or declined with its reason), for `ambiguous` and `clear`.
 *  - `unavailable`: the access check could not be made; nothing was understood.
 */
export type UnderstandState =
  | {outcome: 'idle'}
  | {outcome: 'invalid'; problems: FieldProblem[]}
  | {outcome: 'no_match'; subjects: SubjectView[]}
  | {outcome: 'ambiguous'; matches: SubjectView[]; personalization: Personalization}
  | {outcome: 'clear'; subject: SubjectView; personalization: Personalization}
  | {outcome: 'unavailable'};

export const understandIdle: UnderstandState = {outcome: 'idle'};

/**
 * What `confirmRequest` answers when it did not redirect to the new Project (it redirects on `created` and on `replayed`).
 *  - `invalid`: a field is wrong (the server checked them all again); nothing was saved.
 *  - `changed`: the description no longer names exactly one subject; nothing was saved.
 *  - `reused`: the command ID was used before for another request; nothing was saved.
 *  - `gone`: the same request was confirmed before, and the Project it made is no longer available (deleted); nothing was saved and
 *    there is no Project to go to. The next Confirm of the request is a new command.
 *  - `unavailable`: the service did not answer. `unknown` is true when the request may have been saved anyway: the person is told
 *    to check My Projects before trying again (a retry carries the same command ID, so it creates at most one Project).
 */
export type ConfirmState =
  | {outcome: 'idle'}
  | {outcome: 'invalid'; problems: FieldProblem[]}
  | {outcome: 'changed'}
  | {outcome: 'reused'}
  | {outcome: 'gone'}
  | {outcome: 'unavailable'; unknown: boolean};

export const confirmIdle: ConfirmState = {outcome: 'idle'};

export type UnderstandAction = (previous: UnderstandState, formData: FormData) => Promise<UnderstandState>;
export type ConfirmAction = (previous: ConfirmState, formData: FormData) => Promise<ConfirmState>;

/** Calls the Understand action and reads what comes back (see `attemptAdministeredAction`): a call that did not answer is `unavailable`. */
export function attemptUnderstand(action: UnderstandAction, previous: UnderstandState, formData: FormData): Promise<UnderstandState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable'});
}

/** Calls the Confirm action and reads what comes back: a call that did not answer is `unavailable`, and the request may have been saved. */
export function attemptConfirm(action: ConfirmAction, previous: ConfirmState, formData: FormData): Promise<ConfirmState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true});
}

// Field problems --------------------------------------------------------------------------------------------------------------

/** The message for a field problem, by field and kind. `not_a_match` is a problem of the subject only; the others are of the text fields. */
export function problemKey(problem: FieldProblem): MessageKey {
  switch (problem.field) {
    case 'description':
      return problem.problem === 'empty' ? 'request.error.description.empty' : problem.problem === 'control' ? 'request.error.description.control' : 'request.error.description.tooLong';
    case 'personalization':
      return problem.problem === 'control' ? 'request.error.personalization.control' : 'request.error.personalization.tooLong';
    case 'scope':
      return problem.problem === 'empty' ? 'request.error.scope.empty' : problem.problem === 'control' ? 'request.error.scope.control' : 'request.error.scope.tooLong';
    case 'outcome':
      return problem.problem === 'empty' ? 'request.error.outcome.empty' : problem.problem === 'control' ? 'request.error.outcome.control' : 'request.error.outcome.tooLong';
    case 'subject':
      return 'request.error.subject.notAMatch';
  }
}

/** The limit a field's message names. */
export function limitOf(field: IntakeField): number {
  switch (field) {
    case 'description':
      return maxDescriptionLength;
    case 'personalization':
      return maxWordingLength;
    case 'scope':
      return maxScopeLength;
    case 'outcome':
      return maxOutcomeLength;
    case 'subject':
      return 0;
  }
}

/** The problem a field has among a list of them, or null. */
export function problemOf(problems: readonly FieldProblem[], field: IntakeField): FieldProblemKind | null {
  return problems.find((problem) => problem.field === field)?.problem ?? null;
}

// One command ID for one confirmation, across tabs -------------------------------------------------------------------------------

/**
 * How long a confirmation that was attempted keeps its command ID for the same request, in every tab of this browser. The same request
 * confirmed twice inside the window (from two tabs, or again after a reload that lost the answer) is ONE command, so the database answers
 * the second with the first's Project and creates nothing. After the window the same words are a new request, and a new Project.
 */
export const commandWindowMs = 15 * 60_000;
const storageKey = 'nova3d-request-commands';
const keptCommands = 20;

/** The part of the browser's storage this uses, so a test can hand it a fake. */
export type CommandStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * A short, non-reversible name for a request (the text of the request itself is never stored). It is not a security measure: if two
 * requests ever shared one, the second Confirm would be answered `reused`, and the screen would drop the ID and send it again with a new one.
 */
export function requestKey(parts: readonly string[]): string {
  const text = parts.join('\u0000');
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(16);
}

type Kept = Record<string, {id: string; at: number}>;

function readKept(storage: CommandStorage, now: number): Kept {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const kept: Kept = {};
    for (const [key, entry] of Object.entries(parsed)) {
      const candidate = entry as {id?: unknown; at?: unknown} | null;
      if (candidate && typeof candidate.id === 'string' && typeof candidate.at === 'number' && now - candidate.at >= 0 && now - candidate.at < commandWindowMs) kept[key] = {id: candidate.id, at: candidate.at};
    }
    return kept;
  } catch {
    return {};
  }
}

function writeKept(storage: CommandStorage, kept: Kept) {
  try {
    const newest = Object.entries(kept).sort((a, b) => b[1].at - a[1].at).slice(0, keptCommands);
    storage.setItem(storageKey, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Storage is a convenience: without it the ID stays in this tab, which is how it worked before.
  }
}

/**
 * The command ID to confirm a request with, at the moment of Confirm: the ID another attempt of the same request (`key`) used within the
 * window, or else `proposed`, which is then kept for the next attempt. Nothing is stored before a confirmation is attempted. Storage that
 * cannot be read or written (a private window, blocked site data) leaves `proposed` in force.
 */
export function commandIdFor(key: string, proposed: string, storage: CommandStorage | null, now: number = Date.now()): string {
  if (!storage) return proposed;
  const kept = readKept(storage, now);
  const found = kept[key];
  if (found) return found.id;
  kept[key] = {id: proposed, at: now};
  writeKept(storage, kept);
  return proposed;
}

/** Forgets a command ID the database refused as used for something else, so the request is sent again under a new one. */
export function forgetCommandId(id: string, storage: CommandStorage | null, now: number = Date.now()) {
  if (!storage) return;
  const kept = readKept(storage, now);
  const remaining = Object.fromEntries(Object.entries(kept).filter(([, entry]) => entry.id !== id));
  writeKept(storage, remaining);
}

/** The browser's local storage, or null where there is none or it cannot be reached. */
export function browserStorage(): CommandStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
