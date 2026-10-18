// Which paths the proxy lets through without a signed-in Account. /register is deliberately not one of
// them: registration is for a signed-in Google identity that has no Account yet, and the proxy lets only
// that identity reach it (lib/access.ts). The two recovery pages (Story 1.6) are public because they exist for the one
// person who cannot sign in; they still get the proxy's origin check, and a GET of either changes nothing.
// /api/status (Story 1.8) is the status route: a device whose Account may be gone asks what became of a handle it holds, so it
// cannot be asked of a signed-in Account. It is one POST that reads and changes nothing but a rate-limit counter; the proxy's origin
// check applies to it like any other POST (a request from another site is refused), and it is rate limited by origin and in all.
//
// /api/jobs (Story 1.9) is the scheduled-job route, and the one MACHINE path: a scheduler calls it (a POST with a signed body), so there is no
// session to ask for and no browser Origin to check. It is public in the sense that the proxy asks no Account of it, and it is a machine path
// in that the proxy skips ONLY its origin refusal for it (`isMachinePath`); every other proxy rule still applies, and the signature, checked
// by the route over the raw body, is the only authentication. It is one exact path: nothing beneath or beside it is public.
//
// /api/heartbeat (Story 1.13) is the second machine path: the Railway cron task posts a signed heartbeat to it (a POST with an `Authorization: Heartbeat <token>`
// header and no meaningful body), so the same rule holds: no session, no CSRF cookie, no browser Origin check by the proxy, and the signed token, verified by the
// route (lib/heartbeat.ts), is the only authentication. The route itself refuses a request that carries an `Origin` header, which a worker never sends.
export const machinePaths = ['/api/jobs', '/api/heartbeat'];
export const publicPaths = ['/login', '/auth/callback', '/api/health', '/api/status', '/recover', '/recover/confirm', ...machinePaths];

/**
 * The synthetic design kit route. Public only when synthetic data is on, which production forbids (check-env).
 * Otherwise it is an ordinary private path: signed out means a redirect to sign-in, signed in means the page's own 404.
 */
export const designKitPath = '/kit';

export function isSyntheticDataEnabled(env: Record<string, string | undefined>): boolean {
  return env.SYNTHETIC_DATA_ENABLED === 'true';
}

/** Whether a path is called by a machine, not a browser: the proxy does not check its Origin (the route checks the call's signature). */
export function isMachinePath(pathname: string): boolean {
  return machinePaths.includes(pathname);
}

export function isPublicPath(pathname: string, env: Record<string, string | undefined>): boolean {
  return publicPaths.includes(pathname) || (pathname === designKitPath && isSyntheticDataEnabled(env));
}
