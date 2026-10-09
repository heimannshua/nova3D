// Route knowledge for the shell, kept apart from React so it can be tested directly.

/** Pages that render without the shell: sign-in happens before there is a workspace to navigate. */
export function isChromeless(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/login/') || pathname === '/auth' || pathname.startsWith('/auth/');
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
