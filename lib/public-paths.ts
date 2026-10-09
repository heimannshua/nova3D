// Which paths the proxy lets through without a signed-in Account.
export const publicPaths = ['/login', '/auth/callback', '/api/health'];

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
