// Route knowledge for the shell, kept apart from React so it can be tested directly.

/**
 * Pages that render without the shell: sign-in and registration happen before there is a workspace to
 * navigate. Registration (/register) is for an identity that has no Account yet, so none of the shell's
 * links, menus or Create button would lead anywhere it may go. The step-up page (/step-up, Story 1.4b) is a
 * single focused question, "sign in with Google again", that either goes to Google or goes back. The recovery pages
 * (/recover and /recover/confirm, Story 1.6) are for the one person who cannot sign in, so they have no workspace to navigate either.
 */
export function isChromeless(pathname: string): boolean {
  return ['/login', '/register', '/auth', '/step-up', '/recover'].some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/** Whether a nav link points at the page (or a page beneath it) that is open now. */
export function isCurrent(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Where contextual Back goes: one level up, ending at Home. Home itself has no Back. The Administration index (`/admin`,
 * Story 1.5) is reached from Settings, so Back from it goes to Settings; the pages beneath it (Invitation codes,
 * Accounts) are one level up from the index, like any other page.
 */
export function parentRoute(pathname: string): string | null {
  if (pathname === '/') return null;
  if (pathname === '/admin') return '/settings';
  const parent = pathname.replace(/\/[^/]*$/, '');
  return parent === '' ? '/' : parent;
}
