// Route knowledge for the shell, kept apart from React so it can be tested directly.

/**
 * Pages that render without the shell: sign-in and registration happen before there is a workspace to
 * navigate. Registration (/register) is for an identity that has no Account yet, so none of the shell's
 * links, menus or Create button would lead anywhere it may go.
 */
export function isChromeless(pathname: string): boolean {
  return ['/login', '/register', '/auth'].some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/** Whether a nav link points at the page (or a page beneath it) that is open now. */
export function isCurrent(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Where contextual Back goes: one level up, ending at Home. Home itself has no Back. */
export function parentRoute(pathname: string): string | null {
  if (pathname === '/') return null;
  const parent = pathname.replace(/\/[^/]*$/, '');
  return parent === '' ? '/' : parent;
}
