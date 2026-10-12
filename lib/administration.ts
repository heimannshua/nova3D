// Story 1.5. What the Administrator's pages (the invitation page, Story 1.11, and the Accounts page, Story 1.5) have in
// common, with nothing that reaches the server: whether the person has just confirmed it is them, how a row's
// creation time is written, and how a call to one of their Server Actions that did not answer is read. A client component
// imports this file, so it imports no Node or Next.js server code.
import {unstable_rethrow} from 'next/navigation';
import {reloadHere, unexpectedResponseMessage} from '@/lib/session-actions';

/**
 * Whether the page has seen the Administrator confirm it is them (a marker for `administration` that is still valid
 * when the page rendered). It only decides whether "Confirm it is you" is shown beforehand: the Server Action
 * checks the marker itself, every time, and is the authority.
 */
export type Confirmation = 'confirmed' | 'needed' | 'unknown';

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
 * Calls an administrator Server Action and reads what comes back.
 *
 *  - A redirect travels as a thrown error and is rethrown for Next.js to follow.
 *  - The one answer that is not the action's own is "an unexpected response": what a redirect by the proxy looks like
 *    to a Server Action, because this session no longer has access. Loading the page again lets the proxy say so. It
 *    happens at most once for each attempt, so it can never become a reload loop.
 *  - Anything else, a dropped connection or a real server error, is an answer that did not come: the change may
 *    have been made, so the action's state for that (`unknownFailure`) tells the person to check the list.
 */
export async function attemptAdministeredAction<S>(
  action: (previous: S, formData: FormData) => Promise<S>,
  previous: S,
  formData: FormData,
  unknownFailure: S,
  navigate: () => void = reloadHere,
): Promise<S> {
  try {
    return await action(previous, formData);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof Error && error.message === unexpectedResponseMessage) {
      navigate();
      return previous;
    }
    return unknownFailure;
  }
}
