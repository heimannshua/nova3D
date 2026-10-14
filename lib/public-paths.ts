// Which paths the proxy lets through without a signed-in Account. /register is deliberately not one of
// them: registration is for a signed-in Google identity that has no Account yet, and the proxy lets only
// that identity reach it (lib/access.ts). The two recovery pages (Story 1.6) are public because they exist for the one
// person who cannot sign in; they still get the proxy's origin check, and a GET of either changes nothing.
// /api/status (Story 1.8) is the status route: a device whose Account may be gone asks what became of a handle it holds, so it
// cannot be asked of a signed-in Account. It is one POST that reads and changes nothing but a rate-limit counter; the proxy's origin
// check applies to it like any other POST (a request from another site is refused), and it is rate limited by origin and in all.
export const publicPaths = ['/login', '/auth/callback', '/api/health', '/api/status', '/recover', '/recover/confirm'];

/**
 * The synthetic design kit route. Public only when synthetic data is on, which production forbids (check-env).
 * Otherwise it is an ordinary private path: signed out means a redirect to sign-in, signed in means the page's own 404.
 */
export const designKitPath = '/kit';

export function isSyntheticDataEnabled(env: Record<string, string | undefined>): boolean {
  return env.SYNTHETIC_DATA_ENABLED === 'true';
}

export function isPublicPath(pathname: string, env: Record<string, string | undefined>): boolean {
  return publicPaths.includes(pathname) || (pathname === designKitPath && isSyntheticDataEnabled(env));
}
