import type {MessageKey} from './i18n';

// Error codes the sign-in routes send back in the query string, each with a catalog message.
const errorMessages: Record<string, MessageKey> = {
  auth_unavailable: 'login.error.auth_unavailable',
  auth_failed: 'login.error.auth_failed',
  not_allowed: 'login.error.not_allowed',
  auth_not_configured: 'login.error.auth_not_configured',
  not_signed_in: 'login.error.not_signed_in',
};

export const signInErrorCodes = Object.keys(errorMessages);

/**
 * The message for an error code from the query string, or null when there is no code. The code comes from
 * a URL anyone can edit, so only own properties count: ?error=constructor or ?error=__proto__ is an
 * unknown code, not a way into Object.prototype.
 */
export function signInErrorKey(code: string | undefined): MessageKey | null {
  if (!code) return null;
  return Object.hasOwn(errorMessages, code) ? errorMessages[code] : 'login.error.unknown';
}

export type OAuthClient = {
  auth: {
    signInWithOAuth(credentials: {provider: 'google'; options: {redirectTo: string}}): Promise<{error: {message: string} | null}>;
  };
};

/**
 * Starts Google sign-in. Returns the catalog message to show when it could not start, or null when the
 * browser is on its way to Google. The provider's own wording goes to the console only: a person sees
 * the localized message and nothing else.
 */
export async function startGoogleSignIn(
  client: OAuthClient | null,
  origin: string,
  log: (message: string, detail: unknown) => void = (message, detail) => console.error(message, detail),
): Promise<MessageKey | null> {
  if (!client) return 'login.error.auth_unavailable';
  try {
    const {error} = await client.auth.signInWithOAuth({provider: 'google', options: {redirectTo: `${origin}/auth/callback`}});
    if (error) {
      log('Google sign-in could not be started', error);
      return 'login.error.startFailed';
    }
    return null;
  } catch (error) {
    log('Google sign-in could not be started', error);
    return 'login.error.startFailed';
  }
}
