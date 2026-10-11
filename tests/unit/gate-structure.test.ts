import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

// Structure the gate depends on, checked by reading the source (the way tests/unit/page-guards.test.ts does
// for pages), because a missing call is silent until the day it matters.
const root = join(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

function files(directory: string, match: (name: string) => boolean): string[] {
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(join(root, path)).isDirectory()) return files(path, match);
    return match(name) ? [path] : [];
  });
}

// Comments name things; only code counts.
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the gate has exactly one decision path: api.authorize_session', () => {
  // accountStatus (api.account_status) is the Account read of Story 1.3. It stays for later stories, but the
  // gate must not ask it anything: a second way of deciding is a second way of getting it wrong.
  const production = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)).filter((file) => file !== 'lib/accounts.ts'),
    'proxy.ts',
    'instrumentation.ts',
    'instrumentation-node.ts',
    'next.config.ts',
  ];

  it('finds the production code it reads', () => {
    expect(production).toEqual(expect.arrayContaining(['proxy.ts', 'lib/access.ts', 'lib/auth.ts', 'app/auth/callback/route.ts', 'app/account/actions.ts', 'app/register/actions.ts']));
    expect(production).not.toContain('lib/accounts.ts');
  });

  it.each(production)('%s neither imports nor calls accountStatus or api.account_status', (file) => {
    expect(withoutComments(read(file)), file).not.toMatch(/\baccountStatus\b|\baccount_status\b/);
  });

  it('is still exported by lib/accounts.ts for the stories that need it', () => {
    expect(read('lib/accounts.ts')).toMatch(/export async function accountStatus\b/);
  });

  it('is asked for authorization by the gate: the proxy and the pages reach authorizeSession through resolveAccess only', () => {
    const users = files('app', (name) => /\.(ts|tsx)$/.test(name))
      .concat(files('components', (name) => /\.(ts|tsx)$/.test(name)), files('lib', (name) => /\.(ts|tsx)$/.test(name)), ['proxy.ts'])
      .filter((file) => /\bauthorizeSession\b/.test(withoutComments(read(file))))
      .sort();
    expect(users).toEqual(['lib/access.ts', 'lib/accounts.ts']);
  });
});

describe('every route handler under app/api answers only an active Account', () => {
  // Public on purpose, with the reason. Keep this list short; a new route is private unless it is added here.
  // (There is no separate kit probe route: /kit is a page, public only while synthetic data is on.)
  const exempt: Record<string, string> = {
    'app/api/health/route.ts': 'the health check is public (lib/public-paths.ts) and reports no private data',
  };
  const routes = files('app/api', (name) => /^route\.(ts|js|tsx|jsx)$/.test(name));
  const guarded = routes.filter((file) => !(file in exempt));
  const callsGuard = (source: string) => /^[^/\n]*\bawait\s+requireApiAccess\(\)/m.test(source);

  it('finds the routes', () => {
    expect(routes).toContain('app/api/health/route.ts');
  });

  it('only exempts routes that exist', () => {
    for (const file of Object.keys(exempt)) expect(routes, file).toContain(file);
  });

  it.each(guarded.length ? guarded : ['(no private route handler exists yet)'])('%s starts from requireApiAccess', (file) => {
    if (!guarded.length) return;
    expect(callsGuard(read(file)), `${file} must call await requireApiAccess() and return its denial`).toBe(true);
    expect(read(file)).toMatch(/\.denied\b/);
  });

  it('recognises a call and not a comment, an import or a missing await', () => {
    expect(callsGuard('  const guard = await requireApiAccess();')).toBe(true);
    expect(callsGuard("import {requireApiAccess} from '@/lib/auth';")).toBe(false);
    expect(callsGuard('// await requireApiAccess();')).toBe(false);
    expect(callsGuard('const guard = requireApiAccess();')).toBe(false);
  });

  it('keeps the exempt routes from using a guard they could never satisfy', () => {
    for (const file of Object.keys(exempt)) expect(callsGuard(read(file)), file).toBe(false);
  });

  it('is listed as public only where the proxy says so', () => {
    const publicPaths = read('lib/public-paths.ts');
    for (const file of Object.keys(exempt)) {
      const path = `/${relative('app', file.replace(/\/route\.ts$/, ''))}`;
      expect(publicPaths, file).toContain(`'${path}'`);
    }
  });
});
