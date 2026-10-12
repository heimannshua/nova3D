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

// The methods a route handler may export (Next.js), and which of them change something. The proxy and
// requireMutationAccess treat GET, HEAD and OPTIONS as safe; every other method needs the origin and the token.
const handlerMethods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];
const safeHandlerMethods = ['GET', 'HEAD', 'OPTIONS'];
const names = handlerMethods.join('|');

type Handler = {method: string; source: string};

/**
 * The route handlers a route file declares in place, each with its source up to the next one, and what it could
 * not read. Recognised: `export function POST`, `export async function POST`, `export const POST =`,
 * `export const POST: Type =`, and `export let/var POST =`. Anything else that exports a handler name (a
 * `export {POST}` or `export {x as POST}`, a destructured `export const {POST} = h`, `export const [POST] = h`,
 * a declaration with no initialiser, `export * from`) cannot be classified, and a file that has one fails.
 */
function readHandlers(file: string): {handlers: Handler[]; unclassified: string[]} {
  const code = withoutComments(file);
  const declared = [
    ...code.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s*\\*?\\s*(${names})\\b`, 'g')),
    ...code.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(${names})\\s*(?::[^=;]+?)?=`, 'g')),
  ].sort((a, b) => a.index - b.index);
  const handlers = declared.map((match, index) => ({method: match[1], source: code.slice(match.index, declared[index + 1]?.index ?? code.length)}));
  const unclassified = [
    ...code.matchAll(new RegExp(`export\\s*\\{[^}]*\\b(?:${names})\\b[^}]*\\}`, 'g')),
    ...code.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s*[{\\[][^=]*\\b(?:${names})\\b[^=]*=`, 'g')),
    ...code.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(?:${names})\\s*(?::[^=;]+?)?\\s*[;,\\n]`, 'g')),
    ...code.matchAll(/export\s*\*/g),
  ].map((match) => match[0].replace(/\s+/g, ' ').slice(0, 60));
  return {handlers, unclassified};
}
const handlersOf = (file: string) => readHandlers(file).handlers;
const hidesHandlers = (file: string) => readHandlers(file).unclassified.length > 0;

/** The handler's own first parameter, as a plain name, or null when it has none or destructures it. */
function firstParameter(handler: Handler): string | null {
  const header = /^export\s+(?:async\s+)?function\s*\*?\s*\w+\s*([\s\S]*)$/.exec(handler.source);
  if (header) return /^\(\s*(\w+)\s*[:,)=?]/.exec(header[1])?.[1] ?? null;
  // `export const NAME: Type = <function>`: the function starts after the first `=` that is not part of `=>`.
  const declaration = /^export\s+(?:const|let|var)\s+\w+\s*(?::[^=]*(?:=>[^=]*)*?)?(?<![=!<>])=(?![=>])\s*([\s\S]*)$/.exec(handler.source);
  if (!declaration) return null;
  const value = declaration[1];
  return (
    /^(?:async\s+)?function\s*\*?\s*\w*\s*\(\s*(\w+)\s*[:,)=?]/.exec(value)?.[1] ??
    /^(?:async\s+)?\(\s*(\w+)\s*[:,)=?]/.exec(value)?.[1] ??
    /^(?:async\s+)?(\w+)\s*=>/.exec(value)?.[1] ??
    null
  );
}

/** Where a handler's body begins: just after the `{` that follows its parameter list. */
function bodyOf(handler: Handler): string {
  const opening = /\)\s*(?::\s*[^{=]+?)?\s*\{|=>\s*\{/.exec(handler.source);
  return opening ? handler.source.slice(opening.index + opening[0].length).trimStart() : '';
}

// The one line a synthetic-only route may put ahead of its guard (app/api/kit/mutation/route.ts): it answers 404
// before any access, token or database call, so a deployment without the route spends nothing on it. It is
// allowed only in the files named in `syntheticOnly`.
const syntheticGate = /^if\s*\(\s*!isSyntheticDataEnabled\(process\.env\)\s*\)\s*return\s+notFound\(\)\s*;\s*/;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const denies = (guard: string) => `(?:const|let)\\s+(\\w+)\\s*=\\s*await\\s+${guard}\\s*;\\s*if\\s*\\(\\s*\\1\\.denied\\s*\\)\\s*return\\s+\\1\\.denied\\s*;`;

/** Whether the handler starts from `requireMutationAccess(<its own first parameter>)` and returns its denial. */
function startsFromMutationGuard(handler: Handler, options: {allowSyntheticGate?: boolean} = {}): boolean {
  const parameter = firstParameter(handler);
  if (!parameter) return false;
  const body = options.allowSyntheticGate ? bodyOf(handler).replace(syntheticGate, '') : bodyOf(handler);
  return new RegExp(`^${denies(`requireMutationAccess\\(\\s*${escaped(parameter)}\\s*\\)`)}`).test(body);
}
function startsFromApiGuard(handler: Handler, options: {allowSyntheticGate?: boolean} = {}): boolean {
  const body = options.allowSyntheticGate ? bodyOf(handler).replace(syntheticGate, '') : bodyOf(handler);
  return new RegExp(`^${denies('requireApiAccess\\(\\s*\\)')}`).test(body);
}
const startsFromGuard = (handler: Handler, options: {allowSyntheticGate?: boolean} = {}) =>
  safeHandlerMethods.includes(handler.method) ? startsFromApiGuard(handler, options) || startsFromMutationGuard(handler, options) : startsFromMutationGuard(handler, options);

describe('every route handler answers only an active Account, and every one that changes something also checks the origin and the token', () => {
  // Public on purpose, with the reason. Keep this list short; a new route is private unless it is added here.
  // (There is no separate kit probe route: /kit is a page, public only while synthetic data is on.)
  const exempt: Record<string, string> = {
    'app/api/health/route.ts': 'the health check is public (lib/public-paths.ts) and reports no private data',
  };
  // Routes that may put the synthetic check (and nothing else) ahead of their guard.
  const syntheticOnly: Record<string, string> = {
    'app/api/kit/mutation/route.ts': 'a test-only route: 404 unless synthetic data is on, before any access or database call',
  };
  // EVERY route under app, not only app/api: a mutation does not become safe by living at /auth or /webhooks.
  const routes = files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name));
  const apiRoutes = routes.filter((file) => file.startsWith('app/api/'));
  const guarded = routes.filter((file) => !(file in exempt));

  it('finds the routes, under app/api and elsewhere', () => {
    expect(routes).toEqual(expect.arrayContaining(['app/api/health/route.ts', 'app/api/kit/mutation/route.ts', 'app/auth/callback/route.ts']));
    expect(apiRoutes.length).toBeGreaterThan(0);
  });

  it('only exempts, and only relaxes, routes that exist', () => {
    for (const file of [...Object.keys(exempt), ...Object.keys(syntheticOnly)]) expect(routes, file).toContain(file);
  });

  it.each(routes)('%s exports its handlers in a way that can be read', (file) => {
    const { unclassified } = readHandlers(read(file));
    expect(unclassified, `${file} exports a handler in a way this test cannot classify (use export function / export const NAME =)`).toEqual([]);
  });

  it.each(guarded)('%s starts every handler that changes something from requireMutationAccess(its own first parameter)', (file) => {
    const handlers = handlersOf(read(file));
    for (const handler of handlers.filter((candidate) => !safeHandlerMethods.includes(candidate.method))) {
      expect(firstParameter(handler), `${file} ${handler.method} must take its request as a plain first parameter`).not.toBeNull();
      expect(startsFromMutationGuard(handler, {allowSyntheticGate: file in syntheticOnly}), `${file} ${handler.method} must start with: const guard = await requireMutationAccess(${firstParameter(handler)}); if (guard.denied) return guard.denied;`).toBe(true);
      expect(handler.source, `${file} ${handler.method}`).not.toMatch(/\brequireApiAccess\b/);
    }
  });

  it.each(apiRoutes.filter((file) => !(file in exempt)))('%s starts every handler that changes nothing from its guard too: under /api nothing is public by accident', (file) => {
    const handlers = handlersOf(read(file));
    expect(handlers.length, `${file} exports no route handler`).toBeGreaterThan(0);
    for (const handler of handlers.filter((candidate) => safeHandlerMethods.includes(candidate.method))) {
      expect(startsFromGuard(handler, {allowSyntheticGate: file in syntheticOnly}), `${file} ${handler.method} must start with await requireApiAccess() (or requireMutationAccess(request)) and return its denial`).toBe(true);
    }
  });

  it('allows the synthetic gate ahead of the guard in the files that name it, and nowhere else', () => {
    for (const file of Object.keys(syntheticOnly)) {
      const handlers = handlersOf(read(file));
      expect(handlers.map((handler) => handler.method).sort()).toEqual(['GET', 'POST']);
      for (const handler of handlers) {
        expect(bodyOf(handler), `${file} ${handler.method}`).toMatch(syntheticGate);
        // ... and the gate is that one line: with it removed, the guard is first.
        expect(startsFromGuard(handler, {allowSyntheticGate: true}), `${file} ${handler.method}`).toBe(true);
        expect(startsFromGuard(handler), `${file} ${handler.method} without the allowance`).toBe(false);
      }
    }
    for (const file of guarded.filter((candidate) => !(candidate in syntheticOnly))) {
      for (const handler of handlersOf(read(file))) expect(bodyOf(handler), `${file} ${handler.method}`).not.toMatch(/^if\s*\(\s*!isSyntheticDataEnabled/);
    }
  });

  it('keeps the public routes to methods that change nothing', () => {
    for (const file of Object.keys(exempt)) {
      const methods = handlersOf(read(file)).map((handler) => handler.method);
      expect(methods.length, file).toBeGreaterThan(0);
      for (const method of methods) expect(safeHandlerMethods, `${file} ${method}`).toContain(method);
    }
  });

  it('keeps every route outside app/api that changes something from existing unless it is guarded: none today', () => {
    // The callback is a public GET. A POST route anywhere else must pass the guard test above or be exempted with a reason.
    const outside = routes.filter((file) => !file.startsWith('app/api/'));
    for (const file of outside) {
      for (const handler of handlersOf(read(file))) if (!safeHandlerMethods.includes(handler.method)) expect(file in exempt, `${file} ${handler.method}`).toBe(false);
    }
  });

  it('reads handlers however they are declared, and their first parameter, and fails on a guard it does not recognise', () => {
    const post = (body: string, signature = 'export async function POST(request: Request)') => `${signature} {\n${body}\n}\n`;
    const guard = (parameter: string, variable = 'guard') => `  const ${variable} = await requireMutationAccess(${parameter});\n  if (${variable}.denied) return ${variable}.denied;\n  return Response.json({});`;

    // Positive: every way to declare a handler that is read in place.
    for (const [signature, parameter] of [
      ['export async function POST(request: Request)', 'request'],
      ['export function POST(req)', 'req'],
      ['export async function POST(request: Request, context: {params: Promise<{id: string}>})', 'request'],
      ['export const POST = async (request: Request) =>', 'request'],
      ['export const POST = async (req) =>', 'req'],
      ['export const POST = async request =>', 'request'],
      ['export const POST: RouteHandler = async (request: Request) =>', 'request'],
      ['export const POST: (request: Request) => Promise<Response> = async (request) =>', 'request'],
      ['export let POST = async (r: Request) =>', 'r'],
      ['export var POST = async function (r: Request)', 'r'],
      ['export const POST = function handler(r: Request)', 'r'],
    ] as [string, string][]) {
      const source = post(guard(parameter, 'g'), signature);
      const handlers = handlersOf(source);
      expect(handlers.map((handler) => handler.method), signature).toEqual(['POST']);
      expect(readHandlers(source).unclassified, signature).toEqual([]);
      expect(firstParameter(handlers[0]), signature).toBe(parameter);
      expect(startsFromGuard(handlers[0]), signature).toBe(true);
    }

    // Negative: not the handler's own first parameter, not first, not returned, not awaited, not called.
    for (const bad of [
      post(guard('somethingElse')),
      post(guard('request.clone()')),
      post(guard('')),
      post(guard('new Request("https://evil.example")')),
      post('  const guard = requireMutationAccess(request);\n  if (guard.denied) return guard.denied;'),
      post('  // const guard = await requireMutationAccess(request);\n  return Response.json({});'),
      post('  const body = await request.json();\n' + guard('request')),
      post('  const guard = await requireApiAccess();\n  if (guard.denied) return guard.denied;'),
      post('  const guard = await requireMutationAccess(request);\n  doTheThing();\n  if (guard.denied) return guard.denied;'),
      post('  const guard = await requireMutationAccess(request);\n  if (guard.denied) return Response.json({});'),
      post("  return Response.json({}); // await requireMutationAccess(request)"),
      post(guard('request'), 'export async function POST()'),
      post(guard('request'), 'export async function POST({headers}: Request)'),
      post(guard('request'), 'export const POST = async ({headers}: Request) =>'),
    ]) {
      const handlers = handlersOf(bad);
      expect(handlers.length, bad).toBe(1);
      expect(startsFromGuard(handlers[0]), bad).toBe(false);
    }

    // A safe method may start from either guard; a mutation may not start from the read guard alone.
    const get = (guardCall: string) => `export async function GET(request: Request) {\n  const g = await ${guardCall};\n  if (g.denied) return g.denied;\n}`;
    expect(startsFromGuard(handlersOf(get('requireApiAccess()'))[0])).toBe(true);
    expect(startsFromGuard(handlersOf(get('requireMutationAccess(request)'))[0])).toBe(true);
    expect(startsFromGuard(handlersOf(get('requireMutationAccess(other)'))[0])).toBe(false);
    expect(startsFromGuard(handlersOf(post(guard('request')).replace('POST', 'PATCH').replace('requireMutationAccess(request)', 'requireApiAccess()'))[0])).toBe(false);

    // The synthetic gate is allowed ahead of a guard only where asked, and only that one line.
    const gated = post(`  if (!isSyntheticDataEnabled(process.env)) return notFound();\n${guard('request')}`);
    expect(startsFromGuard(handlersOf(gated)[0])).toBe(false);
    expect(startsFromGuard(handlersOf(gated)[0], {allowSyntheticGate: true})).toBe(true);
    for (const other of ['  if (!isSyntheticDataEnabled(process.env)) return Response.json({});', '  if (isSyntheticDataEnabled(process.env)) return notFound();', '  doTheThing();', '  const x = await fetch("/");']) {
      expect(startsFromGuard(handlersOf(post(`${other}\n${guard('request')}`))[0], {allowSyntheticGate: true}), other).toBe(false);
    }

    // Each method is found, and every one.
    const many = handlerMethods.map((method) => `export async function ${method}() {}`).join('\n');
    expect(handlersOf(many).map((handler) => handler.method)).toEqual(handlerMethods);
    const mixed = `export const runtime = "nodejs";\nexport function helper() {}\nexport const POSTER = 1;\nexport const GETTER = async (r: Request) => {};`;
    expect(handlersOf(mixed)).toEqual([]);
    expect(readHandlers(mixed).unclassified).toEqual([]);
  });

  it('fails on an export it cannot classify, and on nothing else', () => {
    for (const unreadable of [
      'export {POST} from "./other";',
      'export { handler as DELETE };',
      'export {GET, POST};',
      'export { a, handler as PATCH, b } from "./other";',
      'export * from "./other";',
      'export const {POST} = handlers;',
      'export const { GET, POST } = handlers;',
      'export const [POST] = list;',
      'export let POST;',
      'export var DELETE\n',
      'export const PUT: Handler;',
    ]) {
      expect(hidesHandlers(unreadable), unreadable).toBe(true);
    }
    for (const fine of [
      'export async function POST() {}',
      'export const POST = async () => {};',
      'export const POST: H = async () => {};',
      'export let POST = async () => {};',
      '// export {POST} from "./other";',
      '/* export const {POST} = handlers; */',
      'export {helper};',
      'export {helper as POSTER};',
      'export const runtime = "edge";',
      'export const dynamic = "force-dynamic";',
      'export default function () {}',
    ]) {
      expect(hidesHandlers(fine), fine).toBe(false);
    }
  });

  it('keeps the exempt routes from using a guard they could never satisfy', () => {
    for (const file of Object.keys(exempt)) {
      expect(read(file), file).not.toMatch(/\brequireApiAccess\b|\brequireMutationAccess\b/);
    }
  });

  it('is listed as public only where the proxy says so', () => {
    const publicPaths = read('lib/public-paths.ts');
    for (const file of Object.keys(exempt)) {
      const path = `/${relative('app', file.replace(/\/route\.ts$/, ''))}`;
      expect(publicPaths, file).toContain(`'${path}'`);
    }
  });

  it('is private, not public, wherever it is not exempt: the synthetic mutation route is no public path', () => {
    const publicPaths = read('lib/public-paths.ts');
    expect(publicPaths).not.toContain('/api/kit');
  });
});

describe('request integrity (Story 1.4c) has one definition and one way to check', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();

  it('reaches the database for a token in lib/accounts.ts and the two places that use one: issue in the access module, verify in the route helper', () => {
    expect(callers('issueCsrf')).toEqual(['lib/access.ts', 'lib/accounts.ts']);
    expect(callers('verifyCsrf')).toEqual(['lib/accounts.ts', 'lib/auth.ts']);
  });

  it('asks the database for a token through the proxy only, and checks one through requireMutationAccess only', () => {
    expect(callers('issueCsrfToken')).toEqual(['lib/access.ts', 'proxy.ts']);
    expect(callers('requireMutationAccess')).toEqual(['app/api/kit/mutation/route.ts', 'lib/auth.ts']);
  });

  it('decides the origin in one pure function, used by the proxy and the route helper and by nothing else', () => {
    expect(callers('decideOrigin')).toEqual(['lib/auth.ts', 'lib/request-integrity.ts', 'proxy.ts']);
  });

  it('names the cookie and the header in one file, and spells them nowhere else', () => {
    for (const file of sources.filter((candidate) => candidate !== 'lib/request-integrity.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(/['"`]nova3d-csrf['"`]|['"`]x-csrf-token['"`]/i);
    }
    expect(read('lib/request-integrity.ts')).toMatch(/csrfCookieName = 'nova3d-csrf'/);
    expect(read('lib/request-integrity.ts')).toMatch(/csrfHeaderName = 'x-csrf-token'/);
  });

  it('keeps the pure module and the browser helper free of Node, Next.js and every server-only module', () => {
    for (const file of ['lib/request-integrity.ts', 'lib/csrf-client.ts']) {
      const source = withoutComments(read(file));
      expect(source, file).not.toMatch(/from '(?:node:|next\/|@\/lib\/(?:accounts|access|auth|csrf\.server|supabase)|\.\/(?:accounts|access|auth))|from '[^']*\/(?:accounts|access)(?:\.ts)?'|\brequire\(|process\.env|\bBuffer\b|\bcookies\(\)/);
    }
    expect(withoutComments(read('lib/request-integrity.ts'))).not.toMatch(/^import /m);
    expect(withoutComments(read('lib/csrf-client.ts')).match(/^import .*$/gm)).toEqual(["import {csrfCookieName, csrfHeaderName, isCsrfToken} from './request-integrity';"]);
  });

  it('sends the database a hash and never a token', () => {
    // (That nothing prints a token is checked where the code runs: proxy-gating, access and auth unit tests.)
    expect(withoutComments(read('lib/accounts.ts'))).not.toMatch(/p_csrf_token|p_token/);
    expect(withoutComments(read('lib/accounts.ts'))).toMatch(/p_csrf_hash: input\.hash/);
  });

  it('removes the cookie where a browser changes session, and nowhere else', () => {
    expect(callers('clearCsrfCookie')).toEqual(['app/account/actions.ts', 'app/auth/callback/route.ts', 'lib/csrf.server.ts']);
  });

  it('needs no token for a Server Action: none checks one', () => {
    for (const file of sources.filter((candidate) => /^app\/.*actions\.ts$/.test(candidate))) {
      expect(withoutComments(read(file)), file).not.toMatch(/verifyCsrf|requireMutationAccess|csrfHeaderName/);
    }
  });
});

describe('step-up (Story 1.4b) has one way in, one way to decide and one way to check', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();

  it('starts a step-up only in lib/accounts.ts and the one Server Action', () => {
    expect(callers('startStepUp')).toEqual(['app/step-up/actions.ts', 'lib/accounts.ts']);
  });

  it('accepts a step-up only in lib/accounts.ts and the sign-in decision that the callback makes', () => {
    expect(callers('completeStepUp')).toEqual(['lib/access.ts', 'lib/accounts.ts']);
    expect(callers('finishStepUp')).toEqual(['app/auth/callback/route.ts', 'lib/access.ts']);
  });

  it('checks a marker in one wrapper (lib/administered.ts: the authority for every Administrator change, and the page\'s decision whether to offer the step-up beforehand), and nowhere else', () => {
    expect(callers('checkMarker')).toEqual(['lib/accounts.ts', 'lib/administered.ts']);
  });

  it('only ever checks the administration marker, which stays valid for its five minutes, so a check followed by a change loses nothing', () => {
    const code = withoutComments(read('lib/administered.ts'));
    const calls = [...code.matchAll(/checkMarker\(\{([^}]*)\}/g)].map((match) => match[1]);
    // The change wrapper and the page's confirmation read: two calls, both for administration.
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toMatch(/actionClass: 'administration'/);
    expect(code).not.toMatch(/startedAfter/);
    // The files that use the wrapper never name the marker themselves.
    for (const file of ['app/admin/invitations/actions.ts', 'app/admin/invitations/page.tsx', 'app/admin/accounts/actions.ts', 'app/admin/accounts/page.tsx', 'app/admin/page.tsx']) {
      expect(withoutComments(read(file)), file).not.toMatch(/\bcheckMarker\b|startedAfter/);
    }
  });

  it('reads the step-up cookie and the PKCE verifier BEFORE the code exchange, which removes the verifier', () => {
    const callback = withoutComments(read('app/auth/callback/route.ts'));
    const reads = callback.indexOf('readStepUpFlow()');
    const exchanges = callback.indexOf('exchangeCodeForSession(');
    expect(reads).toBeGreaterThan(-1);
    expect(exchanges).toBeGreaterThan(-1);
    expect(reads).toBeLessThan(exchanges);
  });

  it('takes nothing from the request in the Server Action: no form data, no search parameter, no URL, no header but the origin', () => {
    const action = withoutComments(read('app/step-up/actions.ts'));
    for (const forbidden of [/\bformData\b/i, /\bsearchParams\b/, /\brequest\.url\b/, /\bnew URL\(/, /\bheaders\(\)/]) expect(action).not.toMatch(forbidden);
  });

  it('derives the return path from the action class in one table, and reads it from no request anywhere', () => {
    expect(withoutComments(read('lib/step-up.ts'))).toMatch(/export const stepUpReturnPaths: Record<StepUpClass, string>/);
    for (const file of sources.filter((candidate) => !candidate.startsWith('lib/step-up'))) {
      expect(withoutComments(read(file)), file).not.toMatch(/searchParams\.get\(['"](?:returnTo|return_to|redirect|redirectTo|next|callbackUrl)['"]\)/);
    }
  });

  it('keeps the markers and nonces in Postgres only: nothing in the application reads their tables, signs them into a token or keeps them in Redis', () => {
    for (const file of sources) {
      const source = withoutComments(read(file));
      expect(source, file).not.toMatch(/fresh_authentications|step_up_nonces/);
    }
    for (const file of sources.filter((candidate) => candidate.startsWith('lib/step-up') || candidate === 'app/step-up/actions.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(/upstash|redis|jsonwebtoken|\bjwt\b|setSession\(|updateUser\(/i);
    }
  });

  it('keeps every browser-bound piece of it free of the server-only modules (the form is a client component)', () => {
    for (const file of ['components/step-up-form.tsx', 'lib/step-up.ts']) {
      const source = withoutComments(read(file));
      expect(source, file).not.toMatch(/from '@\/lib\/accounts'|from '@\/lib\/access'|from '@\/lib\/step-up-flow'|from '@\/lib\/step-up\.server'|node:crypto/);
    }
  });
});

describe('the preferences record (Story 1.4d) has one way in, one way to change, and nothing a client chooses', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();

  it('reaches the database in lib/accounts.ts and in the only two places that use it: adoption (the access module, for the proxy; the Server Action when the record is missing) and the change (the Server Action)', () => {
    expect(callers('adoptPreferences')).toEqual(['app/account/preference-actions.ts', 'lib/access.ts', 'lib/accounts.ts']);
    expect(callers('setAccountPreference')).toEqual(['app/account/preference-actions.ts', 'lib/accounts.ts']);
  });

  it('adopts the device\'s cookies in the proxy only, through the one function that never throws', () => {
    expect(callers('adoptDevicePreferences')).toEqual(['lib/access.ts', 'proxy.ts']);
    expect(callers('adoptDeviceChoices')).toEqual(['proxy.ts']);
  });

  it('calls the Server Action from the provider only: the one place a choice is saved from the browser', () => {
    expect(callers('savePreference')).toEqual(['app/account/preference-actions.ts', 'components/preferences-provider.tsx']);
    expect(callers('attemptPreferenceSave')).toEqual(['components/preferences-provider.tsx', 'lib/preference-actions.ts']);
  });

  it('keeps the table in the database: nothing in the application names it, and nothing reads a record except through the authorization', () => {
    for (const file of sources) expect(withoutComments(read(file)), file).not.toMatch(/account_preferences/);
    for (const file of sources.filter((candidate) => candidate !== 'lib/accounts.ts')) expect(withoutComments(read(file)), file).not.toMatch(/['"`](?:adopt_preferences|set_preference)['"`]/);
  });

  it('makes the Server Action a Server Action behind withActiveAccount that takes a name and a value and nothing else', () => {
    const source = read('app/account/preference-actions.ts');
    expect(source.trimStart()).toMatch(/^'use server';/);
    const code = withoutComments(source);
    expect(code).toMatch(/export async function savePreference\(name: string, value: string \| null\)/);
    expect(code).toMatch(/return withActiveAccount\(/);
    // The Account is read from the verified access, never from an argument, a form field, a header or the URL.
    expect(code).toMatch(/access\.account/);
    for (const forbidden of [/\bformData\b/i, /\bsearchParams\b/, /\brequest\.url\b/, /\bnew URL\(\s*request/, /accountId\s*:\s*(?:name|value)\b/]) expect(code).not.toMatch(forbidden);
    // Only one function is exported (a 'use server' file may export nothing else).
    expect([...code.matchAll(/^export\s/gm)]).toHaveLength(1);
    // It parses what it is given before anything is asked.
    expect(code.indexOf('parsePreferenceChange(')).toBeGreaterThan(-1);
    expect(code.indexOf('parsePreferenceChange(')).toBeLessThan(code.indexOf('withActiveAccount('));
  });

  it('asks for the Account in the layout only when the request carries an Auth session cookie, and falls back to the cookies when it cannot', () => {
    const code = withoutComments(read('lib/preferences.server.ts'));
    expect(code).toMatch(/isAuthSessionCookieName/);
    expect(code.indexOf('isAuthSessionCookieName')).toBeGreaterThan(-1);
    expect(code.indexOf('isAuthSessionCookieName')).toBeLessThan(code.indexOf('getAccess()'));
    expect(code).toMatch(/access === null \|\| access\.state === 'unavailable'/);
    expect(code).toMatch(/access\.state !== 'active'/);
  });

  it('keeps the browser-bound pieces free of the server-only modules', () => {
    for (const file of ['components/login-preferences.tsx', 'components/ui/preference-notice.tsx', 'components/ui/choice.tsx', 'components/preferences-provider.tsx', 'lib/preference-actions.ts', 'lib/preferences.ts']) {
      const source = withoutComments(read(file));
      expect(source, file).not.toMatch(/from '@\/lib\/accounts'|from '@\/lib\/access'|from '@\/lib\/auth'|from '@\/lib\/preferences\.server'|node:crypto|next\/headers/);
    }
  });

  it('writes the cookie copy of a preference in the Server Action only, and never httpOnly (the sign-in page and the kit read it in the browser)', () => {
    const writers = sources.filter((file) => /preferenceCookieNames/.test(withoutComments(read(file)))).sort();
    expect(writers).toEqual(['app/account/preference-actions.ts', 'lib/preferences.ts']);
    expect(withoutComments(read('app/account/preference-actions.ts'))).not.toMatch(/httpOnly\s*:\s*true/);
  });
});

describe('the invitation page (Story 1.11) changes a code in one place, behind the role and the marker, in that order', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const actions = 'app/admin/invitations/actions.ts';
  const code = withoutComments(read(actions));

  it('issues and revokes a code, and records a refusal, from lib/accounts.ts and the one file of Server Actions, and lists them from the page', () => {
    expect(callers('issueInvitation')).toEqual([actions, 'lib/accounts.ts']);
    expect(callers('revokeInvitation')).toEqual([actions, 'lib/accounts.ts']);
    expect(callers('recordInvitationRefusal')).toEqual([actions, 'lib/accounts.ts']);
    expect(callers('listInvitations')).toEqual(['app/admin/invitations/page.tsx', 'lib/accounts.ts']);
  });

  it('keeps the database functions behind the typed calls: nothing else names them', () => {
    for (const file of sources.filter((candidate) => candidate !== 'lib/accounts.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(/['"`](?:issue_invitation|revoke_invitation|list_invitations|record_invitation_refusal)['"`]/);
    }
  });

  it('is a file of Server Actions that exports exactly the three, each going through the one function that checks the role and then the marker', () => {
    expect(read(actions).trimStart()).toMatch(/^'use server';/);
    expect([...code.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['issueNamedInvitation', 'mintGeneralInvitation', 'revokeInvitationCode']);
    expect([...code.matchAll(/^export\s/gm)]).toHaveLength(3);
    expect([...code.matchAll(/return administered\(/g)]).toHaveLength(3);
  });

  it('goes through the one wrapper that checks the role, then the marker, then makes the change: the actions check neither themselves', () => {
    expect(code).toMatch(/import \{administered, type AdministeredSteps\} from '@\/lib\/administered'/);
    expect(code).not.toMatch(/\bcheckMarker\b|withActiveAccount|account\.role/);
    // Nothing changes before `administered` has run its two checks: the change functions are called only inside the callback it is given.
    for (const name of ['issueInvitation(', 'revokeInvitation(']) {
      for (const at of [...code.matchAll(new RegExp(name.replace('(', '\\('), 'g'))].map((match) => match.index)) {
        const enclosing = code.lastIndexOf('return administered(', at);
        expect(enclosing, `${name} at ${at} is inside an administered() callback`).toBeGreaterThan(-1);
        expect(code.slice(enclosing, at), name).toMatch(/async \(\{actor, budget\}\) =>/);
      }
    }
  });

  it('reads from the form only what each action is about: before the role and the marker only a revoke\'s invitation ID, parsed at once', () => {
    for (const forbidden of [/\bactor:\s*(?:formData|String\()/, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\.url\b/]) expect(code).not.toMatch(forbidden);

    // Each exported action, split at `return administered(`: what it reads before the role and marker checks, and after.
    const reads = (text: string) => [...text.matchAll(/formData\.get\(['"](\w+)['"]\)/g)].map((match) => match[1]);
    const bodies = Object.fromEntries(
      [...code.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}\n/g)].map((match) => [match[1], match[2]]),
    );
    expect(Object.keys(bodies).sort()).toEqual(['issueNamedInvitation', 'mintGeneralInvitation', 'revokeInvitationCode']);
    const split = (name: string) => {
      const at = bodies[name].indexOf('return administered(');
      expect(at, name).toBeGreaterThanOrEqual(0);
      return {before: bodies[name].slice(0, at), after: bodies[name].slice(at)};
    };
    expect(reads(split('issueNamedInvitation').before)).toEqual([]);
    expect(reads(split('issueNamedInvitation').after)).toEqual(['label']);
    expect(reads(split('mintGeneralInvitation').before)).toEqual([]);
    expect(reads(split('mintGeneralInvitation').after)).toEqual(['replace']);
    // A revoke names the invitation a refusal is audited against, so that one is read first, and it is parsed to a UUID or null at once.
    expect(reads(split('revokeInvitationCode').before)).toEqual(['invitationId']);
    expect(split('revokeInvitationCode').before).toMatch(/invitationIdOf\(formData\.get\('invitationId'\)\)/);
    expect(reads(split('revokeInvitationCode').after)).toEqual([]);
    // And nothing else is read anywhere in the file: only these three names, exactly.
    expect(reads(code).sort()).toEqual(['invitationId', 'label', 'replace']);
  });

  it('prints a failure by name and message only, and never a code, a label or the request', () => {
    const lines = code.split('\n').filter((line) => /console\.(?:log|info|warn|error|debug)\(/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/describe\(error\)/);
      expect(line).not.toMatch(/\.code\b|issued|label|formData|invitationId/);
    }
    expect(code).toMatch(/const describe = \(error: unknown\) => \(error instanceof Error \? `\$\{error\.name\}: \$\{error\.message\}` : 'unknown failure'\)/);
  });

  it('puts a made code in the action\'s answer and nowhere else it could be kept: no audit, cookie, redirect, header or cache call carries it', () => {
    for (const forbidden of [/cookies\(/, /headers\(/, /redirect\([^)]*code/, /revalidate(?:Path|Tag)\(/, /localStorage|sessionStorage/, /record(?:Audit|InvitationRefusal)\([^)]*(?:code|label)/]) expect(code).not.toMatch(forbidden);
    // The refusal is recorded with the Auth user, the action and the invitation, and nothing else.
    expect(code).toMatch(/recordInvitationRefusal\(\{userId, action, invitationId\}/);
  });

  it('keeps the page and the components free of the functions that change a code: they only call the Server Actions', () => {
    for (const file of sources.filter((candidate) => candidate.startsWith('components/admin/') || candidate === 'app/admin/invitations/page.tsx')) {
      expect(withoutComments(read(file)), file).not.toMatch(/\b(?:issueInvitation|revokeInvitation|recordInvitationRefusal)\b/);
    }
    for (const file of sources.filter((candidate) => candidate.startsWith('components/admin/'))) {
      expect(withoutComments(read(file)), file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth)'|node:crypto|next\/headers/);
    }
  });

  it('puts the code in client memory only: no component of the page writes it to storage, a cookie, the address or the router', () => {
    for (const file of sources.filter((candidate) => candidate.startsWith('components/admin/'))) {
      expect(withoutComments(read(file)), file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|history\.|router\.(?:push|replace)|useRouter|searchParams|location\./);
    }
  });

  it('sends the step-up to the page that asks for it by its one URL, built from the closed list', () => {
    expect(withoutComments(read('components/admin/step-up-notice.tsx'))).toMatch(/stepUpUrl\('administration'\)/);
    for (const file of sources.filter((candidate) => candidate.startsWith('components/admin/') || candidate.startsWith('app/admin/'))) {
      expect(withoutComments(read(file)), file).not.toMatch(/['"`]\/step-up/);
    }
  });
});

describe('the administrator wrapper (Story 1.5) is the one place that decides an Administrator\'s change may happen', () => {
  const wrapper = 'lib/administered.ts';
  const code = withoutComments(read(wrapper));
  const body = code.slice(code.indexOf('export async function administered<'), code.indexOf('export async function readConfirmation'));

  it('is used by the invitation actions and the Accounts actions, and by nothing else', () => {
    const sources = [
      ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
      ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
      ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
      'proxy.ts',
    ];
    const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
    const wrapped = sources.filter((file) => /\badministered(?:<\w+>)?\(/.test(withoutComments(read(file)))).sort();
    expect(wrapped).toEqual(['app/admin/accounts/actions.ts', 'app/admin/invitations/actions.ts', wrapper]);
    expect(callers('readConfirmation')).toEqual(['app/admin/accounts/page.tsx', 'app/admin/invitations/page.tsx', 'app/admin/page.tsx', wrapper]);
  });

  it('checks the role, then the marker, then makes the change, inside withActiveAccount and in that order', () => {
    expect(body.length).toBeGreaterThan(0);
    const order = ['withActiveAccount', "account.role !== 'administrator'", 'recordDenied(', 'checkMarker(', "marker !== 'allowed'", 'recordRefused(', 'return run('].map((needle) => body.indexOf(needle));
    expect(order.every((index) => index >= 0), order.join(',')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Only `run` makes the change, and it is called once, after both checks.
    expect([...body.matchAll(/\brun\(/g)]).toHaveLength(1);
  });

  it('takes the actor and the marker\'s session from the verified session and nothing a request chose', () => {
    expect(body).toMatch(/actor: `user:\$\{user\.id\}`/);
    expect(body).toMatch(/checkMarker\(\{userId: user\.id, sessionId: user\.sessionId, actionClass: 'administration'\}/);
    for (const forbidden of [/formData/i, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\b/]) expect(body).not.toMatch(forbidden);
  });

  it('sends a session that no longer holds a grant Home, and offers the step-up only when there is none or it ran out', () => {
    expect(body).toMatch(/if \(marker === 'denied'\) return redirect\(homePath\)/);
    expect(body).toMatch(/const stepUp = marker === 'none' \|\| marker === 'expired'/);
  });

  it('prints a failure by name and message only', () => {
    const lines = code.split('\n').filter((line) => /console\.(?:log|info|warn|error|debug)\(/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/describe\(error\)/);
  });
});

describe('Account administration (Story 1.5) disables in one database call, then cancels, and shows nothing of a Workspace', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const actions = 'app/admin/accounts/actions.ts';
  const code = withoutComments(read(actions));

  it('lists, disables, enables and records a refusal from lib/accounts.ts, the one file of Server Actions and the page', () => {
    expect(callers('disableAccount')).toEqual([actions, 'lib/accounts.ts']);
    expect(callers('enableAccount')).toEqual([actions, 'lib/accounts.ts']);
    expect(callers('recordAccountRefusal')).toEqual([actions, 'lib/accounts.ts']);
    expect(callers('listAccounts')).toEqual(['app/admin/accounts/page.tsx', 'lib/accounts.ts']);
  });

  it('keeps the database functions behind the typed calls: nothing else names them', () => {
    for (const file of sources.filter((candidate) => candidate !== 'lib/accounts.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(/['"`](?:list_accounts|disable_account|enable_account|guard_operation|record_account_refusal|assert_operation_authority)['"`]/);
    }
  });

  it('is a file of Server Actions that exports exactly the two, each going through the wrapper that checks the role and then the marker', () => {
    expect(read(actions).trimStart()).toMatch(/^'use server';/);
    expect([...code.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['disableMemberAccount', 'enableMemberAccount']);
    expect([...code.matchAll(/^export\s/gm)]).toHaveLength(2);
    expect([...code.matchAll(/return administered\(/g)]).toHaveLength(2);
    expect(code).not.toMatch(/\bcheckMarker\b|withActiveAccount|account\.role/);
  });

  it('reads from the form only the Account\'s ID, parsed to a UUID or null before the role and the marker are checked, and takes the actor from the session', () => {
    const reads = [...code.matchAll(/formData\.get\(['"](\w+)['"]\)/g)].map((match) => match[1]);
    expect(reads).toEqual(['accountId', 'accountId']);
    expect([...code.matchAll(/accountIdOf\(formData\.get\('accountId'\)\)/g)]).toHaveLength(2);
    for (const forbidden of [/\bactor:\s*(?:formData|String\()/, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\.url\b/, /cookies\(/]) expect(code).not.toMatch(forbidden);
    // The change is made, and the cancellers are run, only inside the callback `administered` is given.
    for (const name of ['disableAccount(', 'enableAccount(', 'runCancellers(']) {
      for (const at of [...code.matchAll(new RegExp(name.replace('(', '\\('), 'g'))].map((match) => match.index)) {
        const enclosing = code.lastIndexOf('return administered(', at);
        expect(enclosing, `${name} at ${at} is inside an administered() callback`).toBeGreaterThan(-1);
        expect(code.slice(enclosing, at), name).toMatch(/async \(\{actor, budget\}\) =>/);
      }
    }
  });

  it('runs the cancellers only after the disable call has returned, never before, and never for an enable', () => {
    const disable = code.slice(code.indexOf('export async function disableMemberAccount'), code.indexOf('export async function enableMemberAccount'));
    const enable = code.slice(code.indexOf('export async function enableMemberAccount'));
    expect([...disable.matchAll(/\brunCancellers\(/g)]).toHaveLength(1);
    expect(disable.indexOf('await withinBudget(budget, (timeoutMs) => disableAccount(')).toBeGreaterThan(-1);
    expect(disable.indexOf('runCancellers(')).toBeGreaterThan(disable.indexOf('disableAccount('));
    // ... and only in the branch where the database said `disabled`.
    expect(disable.slice(0, disable.indexOf('runCancellers(')).lastIndexOf("case 'disabled'")).toBeGreaterThan(disable.indexOf('switch (receipt.outcome)'));
    expect(enable).not.toMatch(/runCancellers|authority/);
  });

  it('prints a failure by name and message only, and never an address, a name or the request', () => {
    const lines = code.split('\n').filter((line) => /console\.(?:log|info|warn|error|debug)\(/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/describe\(error\)/);
      expect(line).not.toMatch(/email|accountId|formData|label/);
    }
    expect(code).toMatch(/recordAccountRefusal\(\{userId, action, accountId\}/);
  });

  it('shows and reads nothing of a Workspace: no page, action, component or list function names one, and the database function reads none', () => {
    for (const file of ['app/admin/page.tsx', 'app/admin/accounts/page.tsx', actions, 'components/admin/admin-content.tsx', 'components/admin/accounts-content.tsx', 'components/admin/account-list.tsx', 'components/admin/account-failure-notice.tsx', 'components/use-account-action.ts', 'lib/account-admin.ts', 'lib/authority.ts']) {
      expect(withoutComments(read(file)), file).not.toMatch(/workspace|projects\.|\bproject(?:s|Name|Id)?\b|\busage\b/i);
    }
    const migration = withoutComments(read('supabase/migrations/20261012130000_account_administration.sql').replace(/^--.*$/gm, ''));
    const listing = migration.slice(migration.indexOf('create function api.list_accounts'), migration.indexOf('comment on function api.list_accounts'));
    expect(listing.length).toBeGreaterThan(0);
    expect(listing).not.toMatch(/projects\.|workspace/i);
    // Disabling leaves the Workspace alone: no statement of the migration writes to a projects table.
    expect(migration).not.toMatch(/(?:update|delete\s+from|insert\s+into)\s+projects\./i);
  });

  it('keeps the browser-bound pieces free of the server-only modules', () => {
    for (const file of ['lib/account-admin.ts', 'lib/administration.ts', 'components/use-account-action.ts', ...sources.filter((candidate) => candidate.startsWith('components/admin/'))]) {
      expect(withoutComments(read(file)), file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth|authority|administered)'|from '\.\/(?:accounts|authority)(?:\.ts)?'|node:crypto|next\/headers/);
    }
  });

  it('puts the authority contract in lib/authority.ts: a guard that fails closed, and a registry of cancellers that touches no Next.js module', () => {
    const authority = withoutComments(read('lib/authority.ts'));
    expect(callers('guardOperation')).toEqual(['lib/accounts.ts', 'lib/authority.ts']);
    expect(callers('authorizeStep')).toEqual(['lib/authority.ts']);
    expect(authority).not.toMatch(/from 'next|from '@\/|from "next/);
    expect(authority).toMatch(/export async function authorizeStep/);
    expect(authority).toMatch(/export function registerCanceller/);
    expect(authority).toMatch(/export async function runCancellers/);
    // An answer that cannot be got is a denial: the catch returns allowed: false and never allowed: true.
    const guard = authority.slice(authority.indexOf('export async function authorizeStep'), authority.indexOf('// Cancellation'));
    expect(guard.slice(guard.indexOf('catch (error)'))).not.toMatch(/allowed: true/);
  });

  it('writes the contract down for the people who write Jobs and the file gateway', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['authorizeStep', 'identity.assert_operation_authority', 'api.guard_operation', 'operationOf', 'registerCanceller', 'stale_epoch', 'unreachable']) expect(contract, needle).toContain(needle);
  });
});
