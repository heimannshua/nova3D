import type {MessageKey} from './i18n';

// Error codes the sign-in routes send back in the query string, each with a catalog message.
const errorMessages = {
  auth_unavailable: 'login.error.auth_unavailable',
  auth_failed: 'login.error.auth_failed',
  not_allowed: 'login.error.not_allowed',
  auth_not_configured: 'login.error.auth_not_configured',
  not_signed_in: 'login.error.not_signed_in',
  session_ended: 'login.error.session_ended',
  account_disabled: 'login.error.account_disabled',
  step_up_failed: 'login.error.step_up_failed',
} as const satisfies Record<string, MessageKey>;

/** The codes the sign-in routes, the proxy and the pages send back as /login?error=<code>. */
export type SignInErrorCode = keyof typeof errorMessages;

export const signInErrorCodes = Object.keys(errorMessages);

/** The path that shows a sign-in error. The one place the query string is built. */
export function signInErrorPath(code: SignInErrorCode) {
  return `/login?error=${code}`;
}

// Notices the sign-in page shows in the query string. Unlike an error, a notice reports something that
// worked (a deliberate sign-out), so it is not styled or announced as a failure.
const noticeMessages = {
  signed_out: 'login.notice.signed_out',
} as const satisfies Record<string, MessageKey>;

export type SignInNoticeCode = keyof typeof noticeMessages;

export const signInNoticeCodes = Object.keys(noticeMessages);

/** Where a deliberate sign-out lands: the sign-in page, saying so. */
export const signedOutPath = '/login?notice=signed_out';

/** The message for a notice code from the query string, or null for no code or an unknown one (own properties only). */
export function signInNoticeKey(code: string | undefined): MessageKey | null {
  if (!code || !Object.hasOwn(noticeMessages, code)) return null;
  return noticeMessages[code as SignInNoticeCode];
}

/**
 * The message for an error code from the query string, or null when there is no code. The code comes from
 * a URL anyone can edit, so only own properties count: ?error=constructor or ?error=__proto__ is an
 * unknown code, not a way into Object.prototype.
 */
export function signInErrorKey(code: string | undefined): MessageKey | null {
  if (!code) return null;
  return Object.hasOwn(errorMessages, code) ? errorMessages[code as SignInErrorCode] : 'login.error.unknown';
}

/** What Google is asked for when the person must see the account chooser: Google's own `prompt=select_account`, and no `login_hint` (which would suppress the chooser). */
export const accountChooserParams: Readonly<{readonly prompt: 'select_account'}> = Object.freeze({prompt: 'select_account'} as const);

export type OAuthClient = {
  auth: {
    signInWithOAuth(credentials: {
      provider: 'google';
      options: {redirectTo: string; queryParams?: Record<string, string>};
    }): Promise<{data?: {url?: string | null} | null; error: {message: string} | null}>;
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

/**
 * Builds a Google sign-in on the SERVER (a Server Action cannot navigate the browser itself): the PKCE code
 * verifier is written to this browser's cookies through the client, and the URL to send the browser to comes
 * back. `redirectTo` is exactly `<origin>/auth/callback` (a query string fails Auth's allow-list). With
 * `chooser`, Google is asked for its account chooser (`prompt=select_account`, no `login_hint`).
 */
export async function requestGoogleSignIn(
  client: OAuthClient | null,
  origin: string,
  options: {chooser?: boolean} = {},
  log: (message: string, detail: unknown) => void = (message, detail) => console.error(message, detail),
): Promise<{ok: true; url: string} | {ok: false; error: MessageKey}> {
  if (!client) return {ok: false, error: 'login.error.auth_unavailable'};
  try {
    const {data, error} = await client.auth.signInWithOAuth({
      provider: 'google',
      options: options.chooser ? {redirectTo: `${origin}/auth/callback`, queryParams: {...accountChooserParams}} : {redirectTo: `${origin}/auth/callback`},
    });
    if (error || !data?.url) {
      log('Google sign-in could not be started', error ?? 'no authorize URL');
      return {ok: false, error: 'login.error.startFailed'};
    }
    return {ok: true, url: data.url};
  } catch (error) {
    log('Google sign-in could not be started', error);
    return {ok: false, error: 'login.error.startFailed'};
  }
}
