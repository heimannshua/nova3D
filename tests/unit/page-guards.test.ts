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

describe('page guards', () => {
  it('finds the pages', () => {
    expect(files).toEqual(expect.arrayContaining(['app/page.tsx', 'app/projects/page.tsx', 'app/progress/page.tsx', 'app/settings/page.tsx', registration, ...Object.keys(exempt)]));
  });

  it('only exempts pages that exist', () => {
    for (const file of Object.keys(exempt)) expect(files, file).toContain(file);
  });

  const guarded = files.filter((file) => !(file in exempt) && file !== registration);
  it('has private pages to check', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(4);
  });

  it.each(guarded)('%s calls requireActiveAccount', (file) => {
    expect(callsRequireActiveAccount(source(file)), `${file} must start with await requireActiveAccount()`).toBe(true);
  });

  it('has the registration page ask for an identity that still needs an Account', () => {
    expect(callsRequireUnregistered(source(registration))).toBe(true);
  });

  it('keeps the exempt pages from asking for an Account they could never require', () => {
    for (const file of Object.keys(exempt)) expect(callsRequireActiveAccount(source(file)), file).toBe(false);
  });

  it('recognises a call and not a comment, an import or a missing await', () => {
    expect(callsRequireActiveAccount('  await requireActiveAccount();')).toBe(true);
    expect(callsRequireActiveAccount("import {requireActiveAccount} from '@/lib/auth';")).toBe(false);
    expect(callsRequireActiveAccount('// await requireActiveAccount();')).toBe(false);
    expect(callsRequireActiveAccount('requireActiveAccount();')).toBe(false);
    expect(callsRequireActiveAccount('const x = 1;')).toBe(false);
  });
});
