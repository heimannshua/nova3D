import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

// Every page under app/ must ask who is asking. The proxy is the first line, not the only one (Next.js
// says so in its authentication guide), so a page that forgets its own check is a hole the day the matcher
// changes. A new page is private unless it is listed here, on purpose, with the reason.
const root = join(import.meta.dirname, '../..');
const app = join(root, 'app');

/**
 * The pages that do not need an active Account, and why. Keep this list short. (not-found.tsx, error.tsx and
 * global-error.tsx are not pages in this sense: they carry no content of their own.)
 */
const exempt: Record<string, string> = {
  'app/login/page.tsx': 'the sign-in page is public',
  'app/kit/page.tsx': 'the design kit is public only while synthetic data is on, and answers 404 otherwise',
};
/** The registration page asks for the opposite: a signed-in identity that has no Account yet. */
const registration = 'app/register/page.tsx';
/**
 * The Administrator's pages (Story 1.11) ask for more than an active Account: an active Administrator, and answer 404 to
 * anyone else. `requireAdministrator` starts from `requireActiveAccount` (checked below), so these pages are private too.
 * Every page under app/admin must be listed here, and nothing else may be.
 */
const administrator = ['app/admin/invitations/page.tsx'];

function pages(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' || name === 'page.ts' || name === 'page.jsx' || name === 'page.js' ? [path] : [];
  });
}

const files = pages(app).map((path) => relative(root, path));
const source = (file: string) => readFileSync(join(root, file), 'utf8');
// A call, not a mention in a comment or an import.
const callsRequireActiveAccount = (text: string) => /^[^/\n]*\bawait\s+requireActiveAccount\(\)/m.test(text);
const callsRequireUnregistered = (text: string) => /^[^/\n]*\bawait\s+requireUnregisteredIdentity\(\)/m.test(text);
const callsRequireAdministrator = (text: string) => /^[^/\n]*\bawait\s+requireAdministrator\(\)/m.test(text);

describe('page guards', () => {
  it('finds the pages', () => {
    expect(files).toEqual(expect.arrayContaining(['app/page.tsx', 'app/projects/page.tsx', 'app/progress/page.tsx', 'app/settings/page.tsx', registration, ...Object.keys(exempt)]));
  });

  it('only exempts pages that exist', () => {
    for (const file of Object.keys(exempt)) expect(files, file).toContain(file);
  });

  const guarded = files.filter((file) => !(file in exempt) && file !== registration && !administrator.includes(file));
  it('has private pages to check', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(4);
  });

  it.each(guarded)('%s calls requireActiveAccount', (file) => {
    expect(callsRequireActiveAccount(source(file)), `${file} must start with await requireActiveAccount()`).toBe(true);
  });

  it('finds the Administrator\'s pages, and lists every page under app/admin and no other', () => {
    for (const file of administrator) expect(files, file).toContain(file);
    expect(files.filter((file) => file.startsWith('app/admin/')).sort()).toEqual([...administrator].sort());
  });

  it.each(administrator)('%s calls requireAdministrator, and so asks for an active Account too', (file) => {
    expect(callsRequireAdministrator(source(file)), `${file} must start with await requireAdministrator()`).toBe(true);
  });

  it('has requireAdministrator start from requireActiveAccount and answer 404, not a redirect, to an Account that is not the Administrator', () => {
    const auth = source('lib/auth.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const body = /export async function requireAdministrator\(\)[^{]*\{([\s\S]*?)\n\}/.exec(auth)?.[1] ?? '';
    expect(body).toMatch(/await requireActiveAccount\(\)/);
    expect(body).toMatch(/access\.account\.role !== 'administrator'/);
    expect(body).toMatch(/return notFound\(\)/);
    expect(body.indexOf('requireActiveAccount')).toBeLessThan(body.indexOf('notFound'));
    expect(body).not.toMatch(/redirect\(/);
  });

  it('has the registration page ask for an identity that still needs an Account', () => {
    expect(callsRequireUnregistered(source(registration))).toBe(true);
  });

  it('keeps the exempt pages from asking for an Account they could never require', () => {
    for (const file of Object.keys(exempt)) expect(callsRequireActiveAccount(source(file)), file).toBe(false);
  });

  it('recognises a call to requireAdministrator and not a comment, an import or a missing await', () => {
    expect(callsRequireAdministrator('  await requireAdministrator();')).toBe(true);
    expect(callsRequireAdministrator('  const access = await requireAdministrator();')).toBe(true);
    expect(callsRequireAdministrator("import {requireAdministrator} from '@/lib/auth';")).toBe(false);
    expect(callsRequireAdministrator('// await requireAdministrator();')).toBe(false);
    expect(callsRequireAdministrator('requireAdministrator();')).toBe(false);
    // An Administrator's page that asks only for an active Account is the hole this test is here for.
    expect(callsRequireAdministrator('await requireActiveAccount();')).toBe(false);
  });

  it('recognises a call and not a comment, an import or a missing await', () => {
    expect(callsRequireActiveAccount('  await requireActiveAccount();')).toBe(true);
    expect(callsRequireActiveAccount("import {requireActiveAccount} from '@/lib/auth';")).toBe(false);
    expect(callsRequireActiveAccount('// await requireActiveAccount();')).toBe(false);
    expect(callsRequireActiveAccount('requireActiveAccount();')).toBe(false);
    expect(callsRequireActiveAccount('const x = 1;')).toBe(false);
  });
});
