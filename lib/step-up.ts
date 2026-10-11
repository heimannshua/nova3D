// Story 1.4b. What the step-up page, its Server Action and the sign-in callback agree on, with nothing that
// reaches the server: the action classes, where each one returns to, and the page's state. A client component
// imports this file (the page's form), so it imports no Node or Next.js server code, and
// lib/accounts.ts imports the class list from here so the two cannot drift.
//
// Like lib/environment.ts it uses erasable TypeScript syntax only (scripts import lib/accounts.ts through
// Node type stripping, and that module imports this one).
import type {MessageKey} from './i18n';

/**
 * What a fresh sign-in is for. administration and owner_deletion markers stay usable for their 5 minutes;
 * account_deletion and close_instance markers are consumed by the one command that uses them. The names are
 * the database's own (a check constraint on identity.step_up_nonces and identity.fresh_authentications).
 */
export const stepUpClasses = ['administration', 'owner_deletion', 'account_deletion', 'close_instance'] as const;
export type StepUpClass = (typeof stepUpClasses)[number];

/** The classes whose marker is consumed by use, and so needs a step-up started after the confirmation was shown. */
export const consumedStepUpClasses: readonly StepUpClass[] = ['account_deletion', 'close_instance'];

export function isStepUpClass(value: unknown): value is StepUpClass {
  return typeof value === 'string' && (stepUpClasses as readonly string[]).includes(value);
}

/**
 * Where the person lands after a step-up, by class. The SERVER derives it from the class and nothing else: no
 * return path is ever read from a URL, a form or a cookie. Until the stories that own the sensitive areas
 * exist, every class returns to Settings; each of those stories changes its own line here.
 */
export const stepUpReturnPaths: Record<StepUpClass, string> = {
  administration: '/settings',
  owner_deletion: '/settings',
  account_deletion: '/settings',
  close_instance: '/settings',
};

/** The page that starts a step-up for a class. The class is a closed list; the page refuses anything else. */
export const stepUpPath = '/step-up';

/**
 * The URL that starts a step-up for a class: `/step-up?for=<class>`. Later stories send a person without a fresh
 * marker here instead of spelling the query string themselves. A class that is not on the closed list is a
 * mistake in the caller, not a URL: it throws.
 */
export function stepUpUrl(actionClass: StepUpClass): string {
  if (!isStepUpClass(actionClass)) throw new TypeError('actionClass must be one of the step-up classes');
  return `${stepUpPath}?for=${actionClass}`;
}

/** What the step-up page's Server Action answers when it does not redirect to Google. */
export type StepUpState = {outcome: 'idle'} | {outcome: 'unavailable'} | {outcome: 'limited'};

export const stepUpIdle: StepUpState = {outcome: 'idle'};

/** Kept as catalog keys, not text, so a message follows the language if it changes. */
export const stepUpErrorKeys = {
  unavailable: 'stepUp.error.unavailable',
  limited: 'stepUp.error.limited',
} as const satisfies Record<Exclude<StepUpState['outcome'], 'idle'>, MessageKey>;
