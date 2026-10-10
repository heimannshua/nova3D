// What the registration action and the registration form agree on. No imports from lib/accounts or
// lib/access: the form is a client component and must not reach server-only code (a test keeps it that way).
import type {MessageKey} from './i18n';

/**
 * The ways an attempt can end without registering. `refused` and `unavailable` are deliberately generic;
 * `empty` is the form's own answer to a blank field and never reaches the server.
 */
export type RegisterError = 'refused' | 'unavailable' | 'empty';

/**
 * The form's state. `commandId` is the UUID the next attempt will carry. It is kept only to retry an
 * attempt whose outcome is unknown (the database could not be reached) and replaced after any definitive
 * answer. It never holds a code.
 */
export type RegisterState = {commandId: string; error: RegisterError | null};

/** Kept as catalog keys, not text, so a message follows the language if it changes. */
export const registerErrorKeys = {
  refused: 'register.error.refused',
  unavailable: 'register.error.unavailable',
  empty: 'register.error.empty',
} as const satisfies Record<RegisterError, MessageKey>;

/** The most a submitted code may hold. A real code is 39 characters; the action refuses anything longer than this before doing any work. */
export const maxCodeLength = 256;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCommandId = (value: unknown): value is string => typeof value === 'string' && uuidPattern.test(value);

/**
 * A new random command ID. `crypto.randomUUID` exists only in secure contexts (https, localhost), so a
 * page served over plain http on a LAN address falls back to `getRandomValues`, which exists everywhere.
 */
export function newCommandId(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
