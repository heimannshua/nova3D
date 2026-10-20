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
    'app/api/status/route.ts': 'the status route (Story 1.8) is public (lib/public-paths.ts): a device whose Account may be gone asks what became of a handle it holds',
    'app/api/jobs/route.ts': 'the scheduled-job route (Story 1.9) is a machine path (lib/public-paths.ts): a scheduler calls it with no session and no browser Origin, and the signature over the raw body, checked in lib/jobs.ts, is its only authentication',
    'app/api/heartbeat/route.ts': 'the heartbeat route (Story 1.13) is the second machine path (lib/public-paths.ts): the Railway cron task calls it with no session and no browser Origin, and the signed heartbeat token, verified in lib/heartbeat.ts, is its only authentication',
  };
  // The public routes that take a POST, and why it changes nothing a caller could use: a lookup reads, and the database counts it (a
  // rate-limit counter is all it writes). The proxy still refuses it from another site, and the database rate limits it.
  const publicPosts: Record<string, string> = {
    'app/api/status/route.ts': 'a lookup of a status handle: it changes nothing but its own rate-limit counter',
    'app/api/jobs/route.ts': 'a signed call of a registered task: nothing runs and nothing is written until the signature, the body and the instance are right, and then only that task and its own receipt',
    'app/api/heartbeat/route.ts': 'a signed heartbeat: nothing is recorded or evaluated until the token verifies for this environment, and then only one heartbeat row, the alarm records its evaluation opens or resolves, and the mail that is due',
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
    expect(routes).toEqual(expect.arrayContaining(['app/api/health/route.ts', 'app/api/heartbeat/route.ts', 'app/api/jobs/route.ts', 'app/api/kit/mutation/route.ts', 'app/api/status/route.ts', 'app/auth/callback/route.ts']));
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

  it('keeps the public routes to methods that change nothing, but for the one lookup POST, named with its reason', () => {
    for (const file of Object.keys(exempt)) {
      const methods = handlersOf(read(file)).map((handler) => handler.method);
      expect(methods.length, file).toBeGreaterThan(0);
      if (file in publicPosts) {
        // The lookup is a POST and nothing else: a GET of it would put the handle in a URL.
        expect(methods, file).toEqual(['POST']);
        continue;
      }
      for (const method of methods) expect(safeHandlerMethods, `${file} ${method}`).toContain(method);
    }
  });

  it('only allows a public POST in a route that is exempt and exists', () => {
    for (const file of Object.keys(publicPosts)) {
      expect(file in exempt, file).toBe(true);
      expect(routes, file).toContain(file);
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
    expect(callers('requireMutationAccess')).toEqual(['app/api/kit/mutation/route.ts', 'app/api/transfers/tickets/route.ts', 'lib/auth.ts']);
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
    // (`p_token_hash` is the recovery token's keyed hash, Story 1.6: a hash, never the token.)
    expect(withoutComments(read('lib/accounts.ts'))).not.toMatch(/p_csrf_token|\bp_token\b/);
    expect(withoutComments(read('lib/accounts.ts'))).toMatch(/p_csrf_hash: input\.hash/);
  });

  it('removes the cookie where a browser changes session, and nowhere else', () => {
    // A recovery (Story 1.6) gives the browser a different session too.
    expect(callers('clearCsrfCookie')).toEqual(['app/account/actions.ts', 'app/auth/callback/route.ts', 'app/recover/actions.ts', 'lib/csrf.server.ts']);
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
    for (const file of ['app/admin/invitations/actions.ts', 'app/admin/invitations/page.tsx', 'app/admin/accounts/actions.ts', 'app/admin/accounts/page.tsx', 'app/admin/page.tsx', 'app/admin/usage/actions.ts', 'app/admin/usage/page.tsx']) {
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
    // On purpose changed (Story 2.4): the Usage and limits page is the third user of the wrapper and the fourth page that reads the confirmation.
    expect(wrapped).toEqual(['app/admin/accounts/actions.ts', 'app/admin/invitations/actions.ts', 'app/admin/usage/actions.ts', wrapper]);
    expect(callers('readConfirmation')).toEqual(['app/admin/accounts/page.tsx', 'app/admin/invitations/page.tsx', 'app/admin/page.tsx', 'app/admin/usage/page.tsx', wrapper]);
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
    for (const file of ['app/admin/accounts/page.tsx', actions, 'components/admin/accounts-content.tsx', 'components/admin/account-list.tsx', 'components/admin/account-failure-notice.tsx', 'components/use-account-action.ts', 'lib/account-admin.ts', 'lib/authority.ts']) {
      expect(withoutComments(read(file)), file).not.toMatch(/workspace|projects\.|\bproject(?:s|Name|Id)?\b|\busage\b/i);
    }
    // On purpose changed (Story 2.4): the Administration index links to Usage and limits, so these two files now name usage. They still name no Workspace and no Project.
    for (const file of ['app/admin/page.tsx', 'components/admin/admin-content.tsx']) {
      expect(withoutComments(read(file)), file).not.toMatch(/workspace|projects\.|\bproject(?:s|Name|Id)?\b/i);
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
    const guard = authority.slice(authority.indexOf('export async function authorizeStep'), authority.indexOf('export type CancellationTarget'));
    expect(guard.length).toBeGreaterThan(0);
    expect(guard.slice(guard.indexOf('catch (error)'))).not.toMatch(/allowed: true/);
    // ... and so is the guard for a named target (Story 1.8), which sits after the cancellers.
    const target = authority.slice(authority.indexOf('export async function authorizeTarget'));
    expect(target).toMatch(/export async function authorizeTarget/);
    expect(target.slice(target.indexOf('catch (error)'))).not.toMatch(/allowed: true/);
    expect(target.slice(target.indexOf('catch (error)'))).toMatch(/reason: 'unreachable'/);
  });

  it('writes the contract down for the people who write Jobs and the file gateway', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['authorizeStep', 'identity.assert_operation_authority', 'api.guard_operation', 'operationOf', 'registerCanceller', 'stale_epoch', 'unreachable']) expect(contract, needle).toContain(needle);
  });
});

describe('Administrator recovery (Story 1.6) mails one address, puts the token in a fragment, and recovers in one order', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const actions = 'app/recover/actions.ts';
  const flow = 'lib/recovery.ts';
  const code = (file: string) => withoutComments(read(file));

  it('reaches the database in lib/accounts.ts and the one module that runs the sequences, and nowhere else', () => {
    for (const name of ['issueRecovery', 'voidRecovery', 'checkRecovery', 'redeemRecoveryToken']) expect(callers(name), name).toEqual(['lib/accounts.ts', flow]);
    for (const file of sources.filter((candidate) => candidate !== 'lib/accounts.ts')) expect(code(file), file).not.toMatch(/\b(?:issue|void|check|redeem)_recovery\b|recovery_tokens/);
  });

  it('sends mail from lib/mailer.ts and the one module that runs the sequences, and asks Auth\'s Admin API from lib/auth-admin.ts and the same module', () => {
    expect(callers('sendRecoveryMail')).toEqual(['lib/mailer.ts', flow]);
    expect(callers('generateMagicLink')).toEqual(['lib/auth-admin.ts', flow]);
    expect(callers('recoveryMessage')).toEqual(['lib/mailer.ts']);
  });

  it('has no recipient anywhere but the environment: the mailer\'s door takes a link and options, and the address is read inside it', () => {
    const mailer = code('lib/mailer.ts');
    expect(mailer).toMatch(/export async function sendRecoveryMail\(link: string, options: MailerOptions = \{\}\)/);
    expect(mailer).toMatch(/const to = recipientOf\(env\)/);
    expect(mailer).toMatch(/env\.ADMINISTRATOR_EMAIL/);
    // Nothing about who it goes to is a parameter of anything exported.
    expect([...mailer.matchAll(/export (?:async )?function \w+\(([^)]*)\)/g)].map((match) => match[1]).join('\n')).not.toMatch(/\b(?:to|recipient|email|address)\b/i);
    // And no other module reads the address: only the environment check, the typed calls and the mailer.
    const readers = sources.filter((file) => /ADMINISTRATOR_EMAIL/.test(code(file))).sort();
    expect(readers).toEqual(['lib/accounts.ts', 'lib/environment.ts', 'lib/mailer.ts']);
  });

  it('chooses the link\'s origin from the server\'s configuration, never from a request, in one function', () => {
    const recovery = code(flow);
    expect(recovery).toMatch(/export function recoveryLinkOrigin\(env: Env, requestOrigin: string \| null\)/);
    // The request's origin is used for APP_ENV=local and for nothing else: the line that returns it is the first, and is guarded.
    const body = recovery.slice(recovery.indexOf('export function recoveryLinkOrigin'), recovery.indexOf('export function recoveryLink('));
    expect(body.match(/requestOrigin/g)).toHaveLength(2);
    expect(body).toMatch(/if \(env\.APP_ENV === 'local'\) return requestOrigin;/);
    expect(body).toMatch(/env\.APP_ORIGIN/);
    expect(callers('recoveryLinkOrigin')).toEqual([actions, flow]);
  });

  it('puts the token in the fragment of the link in one place, and in no query string or path anywhere', () => {
    expect(code(flow)).toMatch(/return `\$\{origin\}\$\{recoveryConfirmPath\}#\$\{token\}`;/);
    for (const file of sources) {
      const source = code(file);
      expect(source, file).not.toMatch(/recover\/confirm\?|confirm\?token|searchParams\.get\(['"](?:token|t)['"]\)/);
    }
    // The confirmation page reads the fragment in the browser, in one component, and nothing else reads it.
    expect(callers('tokenFromFragment')).toEqual(['components/recover-confirm-form.tsx', 'lib/recovery-state.ts']);
    expect(code('components/recover-confirm-form.tsx')).toMatch(/tokenFromFragment\(window\.location\.hash\)/);
    expect(code('components/recover-confirm-form.tsx')).toMatch(/window\.history\.replaceState\(/);
  });

  it('holds the token in memory only: the confirmation component never writes it to storage, a cookie, the router or the console', () => {
    const component = code('components/recover-confirm-form.tsx');
    expect(component).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|router\.|useRouter|console\./);
    for (const file of sources) expect(code(file), file).not.toMatch(/['"`]nova3d-recover/);
  });

  it('is two Server Actions and no route, and the pages hold only their form', () => {
    const exported = [...code(actions).matchAll(/export async function (\w+)\(/g)].map((match) => match[1]);
    expect(exported).toEqual(['requestRecovery', 'redeemRecovery']);
    expect(code(actions)).not.toMatch(/^export (?!async function)/m);
    expect(files('app/recover', (name) => /^route\./.test(name))).toEqual([]);
    // A POST route would have to pass the mutation guard, which a person who cannot sign in cannot: the actions are the way.
    expect(callers('requestRecovery')).toEqual([actions, 'app/recover/page.tsx']);
    expect(callers('redeemRecovery')).toEqual([actions, 'app/recover/confirm/page.tsx']);
  });

  it('takes nothing from the request in the request action, and only the form\'s `token` in the redeem action', () => {
    const action = code(actions);
    const request = action.slice(action.indexOf('export async function requestRecovery'), action.indexOf('export async function redeemRecovery'));
    for (const forbidden of [/formData/i, /\bsearchParams\b/, /\bnew URL\(/, /cookies\(\)/]) expect(request, String(forbidden)).not.toMatch(forbidden);
    const redeem = action.slice(action.indexOf('export async function redeemRecovery'));
    expect([...redeem.matchAll(/formData\.get\(['"]([^'"]+)['"]\)/g)].map((match) => match[1])).toEqual(['token']);
    expect(redeem).not.toMatch(/\bsearchParams\b|\bheaders\(\)|request\.url|\bnew URL\(/);
  });

  it('mints the session on the client that holds its cookies back, and writes them only for a recovery that happened or may have', () => {
    const action = code(actions);
    expect(callers('createDeferredSupabaseServerClient')).toEqual([actions, 'lib/supabase/server.ts']);
    // The ordinary client writes cookies as it goes, and the sign-out helpers expire every one the browser has: neither belongs here.
    expect(action).not.toMatch(/createSupabaseServerClient|\bendSession\b|expireAuthCookies|setStepUpCookie/);
    expect(action).toMatch(/signOutQuietly\(client, 'local'\)/);
    expect(action).not.toMatch(/signOutQuietly\([^)]*'global'/);
    // The cookies are committed in the branch for `redeemed` and `unknown`, and discarded in the other.
    const committed = action.slice(action.indexOf("if (result.outcome === 'redeemed' || result.outcome === 'unknown')"));
    expect(committed.indexOf('deferred.commit()')).toBeGreaterThan(-1);
    expect(committed.indexOf('deferred.commit()')).toBeLessThan(committed.indexOf('deferred.discard()'));
    expect([...action.matchAll(/deferred\.commit\(\)/g)]).toHaveLength(1);
    expect([...action.matchAll(/deferred\.discard\(\)/g)]).toHaveLength(1);
    // The CSRF cookie of the session that is replaced goes in the same branch.
    expect(committed.indexOf('clearCsrfCookie()')).toBeGreaterThan(committed.indexOf('deferred.commit()'));
    expect(committed.indexOf('clearCsrfCookie()')).toBeLessThan(committed.indexOf('deferred.discard()'));
  });

  it('checks, makes the link, verifies it, reads the user and redeems, in that order', () => {
    const recovery = code(flow);
    const body = recovery.slice(recovery.indexOf('export async function redeemRecoveryLink'));
    const order = ['check(token', 'mint(checked.email', 'session.verify(', 'session.readUser(', 'redeem({token'].map((needle) => body.indexOf(needle));
    expect(order.every((index) => index >= 0), order.join(',')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The magic link is made for the address the check named, never the environment's or the request's.
    expect(body).not.toMatch(/mint\((?!checked\.email)/);
    // Only a call that was dispatched and whose outcome cannot be known keeps the session (an unknown-outcome error, or a deadline
    // while the call was in flight); every other failure after the session exists, a call that was never sent included, ends it.
    expect(body).toMatch(/const mayHaveCommitted = error instanceof AccountsUnavailableError \? error\.outcomeUnknown : error instanceof DeadlineError;/);
    expect(body).toMatch(/if \(!mayHaveCommitted\) \{[\s\S]*?await endSession\(\);[\s\S]*?return unavailable;[\s\S]*?\}/);
    expect(body).toMatch(/return \{outcome: 'unknown'\}/);
  });

  it('prints a name and a message only: no log call of the mailer, the Admin client, the flow or the actions mentions a token, a link, a hash or an address', () => {
    const quoted = /'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"/g;
    for (const file of ['lib/mailer.ts', 'lib/auth-admin.ts', flow, actions]) {
      const source = code(file);
      const calls = [...source.matchAll(/\b(?:log|console\.(?:log|info|warn|error|debug))\(([^;]*)\);/g)].map((match) => match[1].replace(quoted, ''));
      for (const call of calls) expect(call, `${file}: ${call}`).not.toMatch(/\b(?:token|link|hashedToken|hashed|email|address|hash|origin|secret|key)\b/i);
    }
    // The mailer and the Admin client log nothing at all.
    for (const file of ['lib/mailer.ts', 'lib/auth-admin.ts']) expect(code(file), file).not.toMatch(/console\.|\blog\(/);
  });

  it('never audits, stores or caches the token or its hash outside the database function that checks it', () => {
    for (const file of sources.filter((candidate) => candidate.startsWith('app/') || candidate.startsWith('components/'))) {
      expect(code(file), file).not.toMatch(/\bcookies\(\)\.set\([^)]*token|revalidate|unstable_cache|upstash|redis/i);
    }
    // The migration audits by action name and opaque target only: no function of it passes a token, hash, address or reason to the audit.
    const migration = read('supabase/migrations/20261012140000_administrator_recovery.sql').replace(/--.*$/gm, '');
    const audits = [...migration.matchAll(/perform identity\.record_(?:audit|audit_once|recovery_refusal)\(([^;]*)\);/g)].map((match) => match[1]);
    expect(audits.length).toBeGreaterThan(8);
    for (const call of audits) expect(call, call).not.toMatch(/token_hash|p_token|p_administrator_email|\bemail\b|\.email|address|p_reason/i);
  });

  it('is closed by default in the database: the table and every function of the migration are service-role only', () => {
    const migration = read('supabase/migrations/20261012140000_administrator_recovery.sql').replace(/--.*$/gm, '');
    expect(migration).toMatch(/alter table identity\.recovery_tokens enable row level security;/);
    expect(migration).toMatch(/revoke all on table identity\.recovery_tokens from public, anon, authenticated, service_role;/);
    // Every new function in `api` is granted to the service role by name, and to no other role.
    const created = [...migration.matchAll(/create function api\.(\w+)\(([^)]*)\)/g)].map((match) => `${match[1]}(${match[2].split(',').map((parameter) => parameter.trim().split(/\s+/)[1]).join(', ')})`);
    expect(created.sort()).toEqual(['check_recovery(text, text)', 'issue_recovery(text, text)', 'redeem_recovery(text, text, uuid, uuid)', 'void_recovery(text, boolean)']);
    const granted = [...migration.matchAll(/grant execute on function api\.(\w+)\(([^)]*)\) to (\w+);/g)];
    expect(granted.map((match) => `${match[1]}(${match[2]})`).sort()).toEqual(['check_recovery(text, text)', 'issue_recovery(text, text)', 'redeem_recovery(text, text, uuid, uuid)', 'void_recovery(text, boolean)']);
    for (const grant of granted) expect(grant[3]).toBe('service_role');
    expect(migration).not.toMatch(/grant [^;]*\b(?:anon|authenticated|public)\b/i);
    // The helpers in `identity` are granted to nobody.
    expect(migration).not.toMatch(/grant execute on function identity\./);
    // No unique index on role: "the one Administrator" is decided by the configured address, not by a constraint (deferred since Story 1.3).
    expect(migration).not.toMatch(/create unique index[^;]*\brole\b/i);
  });

  it('keeps the browser-bound pieces free of the server-only modules', () => {
    for (const file of ['components/recover-form.tsx', 'components/recover-confirm-form.tsx', 'lib/recovery-state.ts']) {
      expect(code(file), file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth|recovery(?!-state)|mailer|auth-admin|step-up\.server|csrf\.server|supabase)[^']*'|node:crypto|next\/headers|process\.env/);
    }
    expect(code('lib/recovery-state.ts')).not.toMatch(/^import (?!type )/m);
  });

  it('does not enable the Email provider or any other credential: supabase/config.toml still has Google as its one provider', () => {
    const config = read('supabase/config.toml');
    expect(config).toMatch(/\[auth\.email\]\s*\n(?:#.*\n)*enable_signup = false/);
    expect(config).toMatch(/\[auth\.external\.google\]\s*\n(?:#.*\n)*enabled = true/);
    expect(config).not.toMatch(/\[auth\.(?:sms|phone)\][^[]*enable_signup = true/);
    expect(config).not.toMatch(/enable_anonymous_sign_ins = true|enable_manual_linking = true/);
  });
});

describe('Projects (Story 1.7) are read and renamed through the typed calls, for the verified Account, and the status handle goes nowhere', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const actions = 'app/projects/actions.ts';
  const code = withoutComments(read(actions));
  const migration = read('supabase/migrations/20261012150000_projects.sql');
  const migrationCode = migration.replace(/^--.*$/gm, '');

  it('lists, reads and renames from lib/projects.ts and the few places that need it: the page loaders, the resolver, the one Server Action', () => {
    expect(callers('listProjects')).toEqual(['lib/project-pages.ts', 'lib/projects.ts']);
    expect(callers('readProject')).toEqual(['lib/project-pages.ts', 'lib/project-target.ts', 'lib/projects.ts']);
    expect(callers('renameProjectCommand')).toEqual([actions, 'lib/projects.ts']);
  });

  it('has the pages read through the loaders and nothing else: no page or component calls a typed call or the database', () => {
    for (const file of sources.filter((candidate) => /^(?:app\/.*page\.tsx|components\/.*)$/.test(candidate))) {
      expect(withoutComments(read(file)), file).not.toMatch(/\b(?:listProjects|readProject|renameProjectCommand|resolveProjectTarget|callApi|callRow)\b/);
    }
  });

  it('keeps the database functions behind the typed calls: nothing else names them', () => {
    for (const file of sources.filter((candidate) => candidate !== 'lib/projects.ts' && candidate !== 'lib/accounts.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(/['"`](?:list_projects|get_project|rename_project)['"`]/);
    }
    expect(withoutComments(read('lib/projects.ts'))).toMatch(/callRow\('list_projects'/);
    expect(withoutComments(read('lib/projects.ts'))).toMatch(/callRow\('get_project'/);
    expect(withoutComments(read('lib/projects.ts'))).toMatch(/callRow\(\s*'rename_project'/);
  });

  it('exports the call helpers from lib/accounts.ts for lib/projects.ts and, since Story 1.8, lib/lifecycle.ts alone', () => {
    const users = sources.filter((file) => /\b(?:callApi|callRow)\b/.test(withoutComments(read(file)))).sort();
    // On purpose changed (Story 2.4): lib/usage.ts is the fourth user of the call helpers, and the only caller of the three Usage functions.
    // On purpose changed (Story 2.11): lib/job-records.ts is the fifth, and the only caller of the six Job functions.
    expect(users).toEqual(['lib/accounts.ts', 'lib/job-records.ts', 'lib/lifecycle.ts', 'lib/projects.ts', 'lib/usage.ts']);
  });

  it('is one Server Action behind withActiveAccount, with the Account from the verified access and nothing about it from the form', () => {
    expect(read(actions).trimStart()).toMatch(/^'use server';/);
    expect([...code.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['renameProject']);
    expect([...code.matchAll(/^export\s/gm)]).toHaveLength(1);
    expect(code).toMatch(/return withActiveAccount<RenameState>\(/);
    expect(code).toMatch(/operationOf\(access\.account\)/);
    const reads = [...code.matchAll(/formData\.get\(['"](\w+)['"]\)/g)].map((match) => match[1]);
    expect(reads).toEqual(['projectId', 'commandId', 'expectedRevision', 'title']);
    for (const forbidden of [/\baccountId\s*:\s*(?:formData|String\()/, /\bepoch\s*:\s*(?:formData|Number\()/, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\.url\b/, /cookies\(/, /\badministered\b|\bcheckMarker\b/]) expect(code).not.toMatch(forbidden);
    // The command is made only inside the callback `withActiveAccount` is given, after the form has been read and checked.
    const enclosing = code.lastIndexOf('return withActiveAccount<RenameState>(');
    const at = code.indexOf('renameProjectCommand(operationOf');
    expect(enclosing).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(enclosing);
    expect(code.indexOf('titleProblem(title)')).toBeGreaterThan(enclosing);
    expect(code.indexOf('titleProblem(title)')).toBeLessThan(at);
  });

  it('prints a failure by name and message only, and never a title, an ID or the form', () => {
    for (const file of [actions, 'lib/projects.ts', 'lib/project-pages.ts', 'lib/project-target.ts']) {
      const lines = withoutComments(read(file)).split('\n').filter((line) => /console\.(?:log|info|warn|error|debug)\(|\blog\(/.test(line));
      for (const line of lines) {
        expect(line, file).toMatch(/describe\(error\)|, detail\)/);
        expect(line, file).not.toMatch(/title|projectId|accountId|formData|email/);
      }
    }
    expect(withoutComments(read('lib/projects.ts'))).not.toMatch(/console\./);
  });

  it('keeps the status handle\'s column in the database and out of every function and every file of the application (Story 1.8\'s lookup receives a handle as `handle`, and nothing reads the column)', () => {
    for (const file of sources) expect(withoutComments(read(file)), file).not.toMatch(/status_handle|statusHandle|status-handle/);
    // The migration names it in the table, its guard, its comment and the preflight's discarded read, and in no select list that leaves a function.
    const functions = [...migrationCode.matchAll(/create (?:or replace )?function (api\.\w+)\(([\s\S]*?)\n\$\$;/g)].map((match) => ({name: match[1], body: match[0]}));
    expect(functions.map((entry) => entry.name).sort()).toEqual(['api.get_project', 'api.list_projects', 'api.preflight', 'api.rename_project']);
    for (const entry of functions.filter((candidate) => candidate.name !== 'api.preflight')) expect(entry.body, entry.name).not.toMatch(/status_handle/);
    // No function returns it: nothing in a return type or a function header, and no composite type holds one.
    for (const entry of functions) expect(entry.body.slice(0, entry.body.indexOf('as $$')), entry.name).not.toMatch(/handle/i);
    expect(migrationCode).not.toMatch(/create type[^;]*handle/i);
  });

  it('begins every function of the migration with the authority check, before it reads or writes a Project', () => {
    for (const name of ['list_projects', 'get_project', 'rename_project']) {
      const start = migrationCode.indexOf(`create function api.${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const body = migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
      const check = body.indexOf('identity.assert_operation_authority(p_account_id, p_epoch)');
      expect(check, `${name} calls the authority check`).toBeGreaterThan(-1);
      expect(check, `${name}: before any Project is read`).toBeLessThan(body.search(/from projects\.|update projects\.|insert into projects\./));
      // A refusal answers `denied`.
      expect(body, name).toMatch(/exception when sqlstate 'N3010' then[\s\S]*?outcome := 'denied'/);
      expect(body, name).toMatch(/security definer\s+set search_path = ''/);
    }
  });

  it('filters every read and write by the Account in the query itself, never after it', () => {
    for (const name of ['list_projects', 'get_project', 'rename_project']) {
      const start = migrationCode.indexOf(`create function api.${name}(`);
      const body = migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
      for (const statement of body.match(/from projects\.projects[\s\S]*?;/g) ?? []) expect(statement, `${name}: ${statement.slice(0, 60)}`).toMatch(/account_id = p_account_id/);
      expect(body, name).toMatch(/deleted_at is null/);
    }
  });

  it('sets deleted_at nowhere in the application or in this migration: a deletion is Story 8.x\'s, and the one writer (api.record_tombstone, Story 1.8\'s, no caller yet) lives in its own migration', () => {
    expect(migrationCode).not.toMatch(/deleted_at\s*=|set\s+deleted_at/i);
    for (const file of sources) expect(withoutComments(read(file)), file).not.toMatch(/deleted_at/);
  });

  it('grants the three functions to the service role and nothing to anyone else', () => {
    const grants = [...migrationCode.matchAll(/^grant .*$/gm)].map((match) => match[0]);
    expect(grants).toHaveLength(3);
    for (const grant of grants) expect(grant).toMatch(/^grant execute on function api\.(?:list_projects|get_project|rename_project)\(.*\) to service_role;$/);
    expect(migrationCode).toMatch(/revoke all on projects\.projects from public, anon, authenticated, service_role/);
    expect(migrationCode).toMatch(/revoke all on projects\.project_commands from public, anon, authenticated, service_role/);
    expect(migrationCode).toMatch(/alter table projects\.projects enable row level security/);
    expect(migrationCode).toMatch(/alter table projects\.project_commands enable row level security/);
    expect(migrationCode).not.toMatch(/create policy/i);
  });

  it('keeps the browser-bound pieces free of the server-only modules', () => {
    for (const file of ['lib/project-view.ts', 'lib/project-stage.ts', 'lib/projects-filter.ts', 'lib/project-fixtures.ts', 'components/nova-dashboard.tsx', ...sources.filter((candidate) => candidate.startsWith('components/projects/') && candidate !== 'components/projects/unavailable.tsx')]) {
      expect(withoutComments(read(file)), file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth|authority|projects|project-pages|project-target)'|from '\.\/(?:accounts|authority|projects)(?:\.ts)?'|node:crypto|next\/headers|next\/cache/);
    }
  });

  it('lets only the Rename dialog reach the Server Action, and keeps the search on the page: what is typed goes in no request, address or log', () => {
    expect(callers('renameProject')).toEqual([actions, 'components/projects/rename-dialog.tsx']);
    for (const file of ['lib/projects-filter.ts', 'components/projects/projects-list.tsx']) {
      expect(withoutComments(read(file)), file).not.toMatch(/\bfetch\(|useRouter|router\.|useSearchParams|URLSearchParams|history\.|location\.|console\.|localStorage|sessionStorage|document\.cookie/);
    }
  });

  it('registers no Story 1.12 gateway resolver: the resolver is only provided, and no route is about Projects', () => {
    expect(callers('resolveProjectTarget')).toEqual(['lib/project-target.ts']);
    expect(files('app', (name) => /^route\.(ts|js)$/.test(name)).filter((file) => /project/i.test(file))).toEqual([]);
    for (const file of sources) expect(withoutComments(read(file)), file).not.toMatch(/registerResolver|registerTarget|statusRoute/i);
    // Story 1.8 wires the tombstone in the database and in three places in the application; nothing else names a tombstone in code.
    expect(sources.filter((file) => /tombstone/i.test(withoutComments(read(file)))).sort()).toEqual(['lib/accounts.ts', 'lib/authority.ts', 'lib/lifecycle.ts']);
  });

  it('writes the resolver down for the people who write the gateway and the status route', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['resolveProjectTarget', 'api.get_project', 'unavailable', 'unreachable', 'status handle']) expect(contract, needle).toContain(needle);
  });

  it('has the Project routes answer the one unavailable page, a 404, from the boundary beside the dynamic segment', () => {
    expect(read('app/projects/[projectId]/not-found.tsx')).toMatch(/ProjectUnavailable/);
    for (const file of ['app/projects/[projectId]/page.tsx', 'app/projects/[projectId]/sources/page.tsx']) {
      const page = withoutComments(read(file));
      expect(page, file).toMatch(/return notFound\(\)/);
      expect(page, file).toMatch(/loaded\.state === 'unavailable'/);
      // A database that cannot answer is never the unavailable page.
      expect(page, file).toMatch(/loaded\.state === 'unreadable'/);
      expect(page.indexOf("'unreadable'"), file).toBeGreaterThan(-1);
    }
  });
});

describe('Tombstones, the ledger and the status route (Story 1.8) have one writer, one guard, one relay and one public route', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const migrationFile = 'supabase/migrations/20261013120000_tombstones_and_ledger.sql';
  const migrationCode = read(migrationFile).replace(/^\s*--.*$/gm, '');
  const route = 'app/api/status/route.ts';
  const apiNames = ['record_tombstone', 'guard_target', 'lookup_status', 'claim_ledger_events', 'finish_ledger_events', 'ledger_pending'];

  /** The text of a function of the migration, from its `create` to the `$$;` that closes it. */
  const functionBody = (header: string) => {
    const start = migrationCode.indexOf(header);
    expect(start, header).toBeGreaterThan(-1);
    return migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
  };

  it('writes a tombstone from one function, and nothing in the application calls it: Epic 8\'s deletion commands will', () => {
    expect(callers('recordTombstone')).toEqual(['lib/lifecycle.ts']);
    expect(callers('record_tombstone')).toEqual(['lib/lifecycle.ts']);
    // No page, action, component or route can create a tombstone or delete data.
    for (const file of sources.filter((candidate) => /^(?:app|components)\//.test(candidate))) {
      expect(withoutComments(read(file)), file).not.toMatch(/\brecordTombstone\b|\brecord_tombstone\b|lifecycle\.tombstones/);
    }
  });

  it('keeps the database functions behind the typed calls: nothing but lib/lifecycle.ts names them', () => {
    for (const file of sources.filter((candidate) => candidate !== 'lib/lifecycle.ts' && candidate !== 'lib/accounts.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(new RegExp(`['"\`](?:${apiNames.join('|')})['"\`]`));
    }
    for (const name of apiNames) expect(withoutComments(read('lib/lifecycle.ts')), name).toMatch(new RegExp(`callRow\\(\\s*'${name}'`));
  });

  it('asks the guard for a target from lib/authority.ts alone, and nothing in the application asks it yet (the file gateway of Story 1.12 holds no service-role key and so cannot: it asks its own authorization views, artifacts.session_authority and the resolver of the target)', () => {
    expect(callers('guardTarget')).toEqual(['lib/authority.ts', 'lib/lifecycle.ts']);
    expect(callers('authorizeTarget')).toEqual(['lib/authority.ts']);
  });

  it('is a relay that is a function, run by one scheduled task and nothing else (Story 1.9), with no alarm (Story 1.13), and the only store is the fixture one (Story 8.9 supplies the real one)', () => {
    expect(callers('relayLedger')).toEqual(['lib/job-tasks.ts', 'lib/ledger.ts']);
    expect(callers('claimLedgerEvents')).toEqual(['lib/ledger.ts', 'lib/lifecycle.ts']);
    expect(callers('finishLedgerEvents')).toEqual(['lib/ledger.ts', 'lib/lifecycle.ts']);
    expect(callers('ledgerPending')).toEqual(['lib/job-tasks.ts', 'lib/lifecycle.ts']);
    expect(callers('createFixtureLedgerStore')).toEqual(['lib/ledger-fixture.ts']);
    expect(callers('LedgerStore')).toEqual(['lib/job-tasks.ts', 'lib/ledger-fixture.ts', 'lib/ledger.ts']);
    // Nothing starts it: no route, no instrumentation, no action, no scheduler registration.
    for (const file of ['instrumentation.ts', 'instrumentation-node.ts', 'proxy.ts', ...sources.filter((candidate) => /^(?:app|components)\//.test(candidate))]) {
      expect(withoutComments(read(file)), file).not.toMatch(/\brelayLedger\b|\bclaimLedgerEvents\b|\bledgerPending\b|registerAlarm|setInterval|@upstash\/workflow/);
    }
  });

  it('keeps the modules a worker outside Next.js may import free of the framework and of the "@/" alias, and the merge rule free of every import', () => {
    for (const file of ['lib/lifecycle.ts', 'lib/ledger.ts', 'lib/ledger-fixture.ts', 'lib/hidden-state.ts', 'lib/authority.ts']) {
      const source = withoutComments(read(file));
      expect(source, file).not.toMatch(/from 'next|from "next|from '@\/|from "@\/|\benum\s+\w+\s*\{|constructor\s*\([^)]*\b(?:private|public|readonly)\s/);
      for (const match of source.matchAll(/^import .* from '(\.[^']*)';$/gm)) expect(match[1], `${file}: ${match[0]}`).toMatch(/^\.\/[\w-]+\.ts$/);
    }
    expect(withoutComments(read('lib/hidden-state.ts'))).not.toMatch(/^import\s|\bfrom\s+['"]/m);
  });

  it('puts the handle in no URL and no log: the status route reads it from the body alone and prints nothing', () => {
    const code = withoutComments(read(route));
    expect(code).not.toMatch(/console\.|\blog\(/);
    expect(code).not.toMatch(/request\.url|nextUrl|searchParams|new URL\(|URLSearchParams|cookies\(|headers\(\)/);
    // The one thing it takes from the request's headers is the platform's client address, through the typed helper and nothing of its own.
    expect([...code.matchAll(/request\.headers/g)].length).toBe(2);
    expect(code).toMatch(/clientAddressFromHeaders\(request\.headers\)/);
    expect(code).toMatch(/const headers = \{'cache-control': 'no-store'\}/);
    expect(code).toMatch(/const maxBodyBytes = 256/);
    // It exports one POST (and `dynamic`), so a GET with the handle in a URL is a 405.
    expect(handlersOf(read(route)).map((handler) => handler.method)).toEqual(['POST']);
    expect(code).toMatch(/export const dynamic = 'force-dynamic'/);
  });

  it('adds no environment variable and no secret: the lookup hashes the origin under the rate-limit key registration already uses', () => {
    const lifecycle = withoutComments(read('lib/lifecycle.ts'));
    expect([...lifecycle.matchAll(/'([A-Z][A-Z0-9_]{4,})'/g)].map((match) => match[1])).toEqual(['RATE_LIMIT_HASH_KEY']);
    for (const file of [route, 'lib/ledger.ts', 'lib/ledger-fixture.ts', 'lib/hidden-state.ts']) expect(withoutComments(read(file)), file).not.toMatch(/process\.env\.[A-Z_]+/);
    // The instance ID the relay prefixes keys with is a parameter (the caller passes INSTANCE_ID), not something it reads.
    expect(withoutComments(read('lib/ledger.ts'))).not.toMatch(/INSTANCE_ID/);
  });

  it('closes every new table and function: row-level security on, no policy, every privilege revoked, granted to the service role by name and to nobody else', () => {
    for (const table of ['tombstones', 'ledger_outbox', 'ledger_relay', 'status_requests']) {
      expect(migrationCode, table).toMatch(new RegExp(`alter table lifecycle\\.${table} enable row level security;`));
      expect(migrationCode, table).toMatch(new RegExp(`revoke all on lifecycle\\.${table} from public, anon, authenticated, service_role;`));
    }
    expect(migrationCode).not.toMatch(/create policy/i);
    const grants = [...migrationCode.matchAll(/^grant .*$/gm)].map((match) => match[0]);
    expect(grants).toHaveLength(6);
    for (const grant of grants) expect(grant).toMatch(/^grant execute on function api\.(?:record_tombstone|guard_target|claim_ledger_events|finish_ledger_events|ledger_pending|lookup_status)\(.*\) to service_role;$/);
    // Every function of the api schema it creates runs as its owner with an empty search_path; the lifecycle helpers are granted to nobody.
    for (const match of migrationCode.matchAll(/create (?:or replace )?function (api\.\w+)\(/g)) {
      expect(functionBody(match[0]), match[1]).toMatch(/security definer\s+set search_path = ''/);
    }
    for (const match of migrationCode.matchAll(/create (?:or replace )?function ((?:lifecycle|identity|projects)\.\w+)\(/g)) {
      expect(functionBody(match[0]), match[1]).toMatch(/set search_path = ''/);
    }
    expect(migrationCode).not.toMatch(/grant execute on function (?:lifecycle|identity|projects)\./);
    // ... and the schema is closed to what is made next.
    expect(migrationCode).toMatch(/alter default privileges for role postgres in schema lifecycle revoke execute on functions from public, anon, authenticated, service_role;/);
    expect(migrationCode).toMatch(/alter default privileges for role postgres in schema lifecycle revoke all on tables from public, anon, authenticated, service_role;/);
  });

  it('writes a tombstone from api.record_tombstone alone, and the outbox from lifecycle.append_event alone', () => {
    expect([...migrationCode.matchAll(/insert into lifecycle\.tombstones/g)]).toHaveLength(1);
    expect(functionBody('create function api.record_tombstone(')).toMatch(/insert into lifecycle\.tombstones/);
    expect(migrationCode).not.toMatch(/(?:update|delete from)\s+lifecycle\.tombstones/);
    expect([...migrationCode.matchAll(/insert into lifecycle\.ledger_outbox/g)]).toHaveLength(1);
    expect(functionBody('create function lifecycle.append_event(')).toMatch(/insert into lifecycle\.ledger_outbox/);
    // One statement marks an event relayed: the one in api.finish_ledger_events. Nothing else updates the outbox.
    expect(functionBody('create function api.finish_ledger_events(')).toMatch(/update lifecycle\.ledger_outbox/);
    expect([...migrationCode.matchAll(/update lifecycle\.ledger_outbox/g)]).toHaveLength(1);
    // The lease row is updated by two functions and no other: the one that takes the lease and the one that lets go of it.
    expect(functionBody('create function api.claim_ledger_events(')).toMatch(/update lifecycle\.ledger_relay/);
    expect(functionBody('create function api.finish_ledger_events(')).toMatch(/update lifecycle\.ledger_relay/);
    expect([...migrationCode.matchAll(/update lifecycle\.ledger_relay/g)]).toHaveLength(2);
  });

  it('hides first and only then records: the target is updated before the tombstone is inserted, in the one function', () => {
    const body = functionBody('create function api.record_tombstone(');
    const hidden = Math.max(body.indexOf('update identity.accounts'), body.indexOf('update projects.projects'));
    expect(body.indexOf('update identity.accounts')).toBeGreaterThan(-1);
    expect(body.indexOf('update projects.projects')).toBeGreaterThan(-1);
    expect(hidden).toBeLessThan(body.indexOf('insert into lifecycle.tombstones'));
    // An Account's Auth sessions are deleted after the hide and before the tombstone is written, as api.disable_account does it.
    const sessions = body.indexOf('delete from auth.sessions');
    expect(sessions).toBeGreaterThan(body.indexOf('update identity.accounts'));
    expect(sessions).toBeLessThan(body.indexOf('insert into lifecycle.tombstones'));
    expect([...body.matchAll(/delete from auth\.sessions/g)]).toHaveLength(1);
    // ... under a lock on the target's row, and with the existing tombstone read after that lock.
    expect(body.indexOf('for update')).toBeGreaterThan(-1);
    expect(body.indexOf('for update')).toBeLessThan(body.indexOf('from lifecycle.tombstones'));
  });

  it('makes the tombstone guard the first statement of the two authority checks', () => {
    for (const header of ['create or replace function identity.assert_operation_authority(', 'create or replace function api.guard_operation(']) {
      const body = functionBody(header);
      const start = body.indexOf('begin');
      expect(body.slice(start).search(/lifecycle\.assert_not_tombstoned\('account'/), header).toBeGreaterThan(-1);
      // Nothing about the Account is read before it.
      expect(body.slice(start, start + body.slice(start).search(/lifecycle\.assert_not_tombstoned\('account'/)), header).not.toMatch(/identity\.accounts/);
    }
  });

  it('queues an event from a trigger on each table that changes, and from no function an application calls', () => {
    for (const [table, trigger] of [
      ['identity.accounts', 'accounts_ledger'],
      ['identity.invitations', 'invitations_ledger'],
      ['identity.preauthorizations', 'preauthorizations_ledger'],
      ['identity.recovery_tokens', 'recovery_tokens_ledger'],
      ['lifecycle.tombstones', 'tombstones_ledger'],
    ]) expect(migrationCode, trigger).toMatch(new RegExp(`create trigger ${trigger} after (?:update|insert) on ${table.replace('.', '\\.')}`));
    // Triggers are AFTER, so a change that is refused or rolled back leaves no event, and none of them is a BEFORE trigger that could queue and then fail.
    expect(migrationCode).not.toMatch(/create trigger \w+_ledger before/);
  });

  it('returns no status handle from any function: no composite type holds one, and the lookup\'s type names a state and a revision', () => {
    expect(migrationCode).not.toMatch(/create type[^;]*handle/i);
    const lookup = functionBody('create function api.lookup_status(');
    expect(lookup.slice(0, lookup.indexOf('as $$'))).toMatch(/\)\s+returns api\.status_lookup\s+language/);
    expect(migrationCode).toMatch(/create type api\.status_lookup as \(outcome text, revision bigint, retry_after integer\);/);
    // The tombstone event carries it (hex), because that is what the ledger is for; no other event does.
    expect([...migrationCode.matchAll(/'handle'/g)]).toHaveLength(1);
  });

  it('counts the lookup before it looks anything up', () => {
    const body = functionBody('create function api.lookup_status(');
    const counted = body.indexOf('insert into lifecycle.status_requests');
    expect(counted).toBeGreaterThan(-1);
    for (const read of ['from lifecycle.tombstones', 'from identity.accounts', 'from projects.projects']) expect(counted, read).toBeLessThan(body.indexOf(read));
    expect(body).toMatch(/c_origin_limit constant integer := 120;/);
    expect(body).toMatch(/c_global_limit constant integer := 1200;/);
  });

  it('writes the guard contract down for the people who write the gateway and the deletion commands', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['The tombstone guard', 'lifecycle.assert_not_tombstoned', 'authorizeTarget', 'api.guard_target', 'api.record_tombstone', 'mergeStatus', 'POST /api/status', 'tombstoned', 'unavailable', 'FOR SHARE', 'Retry-After', 'its own revision plus its Account\'s authorization epoch']) expect(contract, needle).toContain(needle);
  });
});

describe('Scheduled jobs (Story 1.9) have one route, one verifier, three tasks (Story 1.12 added the staging cleanup) and one deleter', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'instrumentation.ts',
    'instrumentation-node.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const migrationFile = 'supabase/migrations/20261014120000_scheduled_jobs.sql';
  const migrationCode = read(migrationFile).replace(/^\s*--.*$/gm, '');
  const route = 'app/api/jobs/route.ts';

  /** The text of a function of the migration, from its `create` to the `$$;` that closes it. */
  const functionBody = (header: string) => {
    const start = migrationCode.indexOf(header);
    expect(start, header).toBeGreaterThan(-1);
    return migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
  };

  it('is one POST at one exact path, a one-line caller of the handler in lib/jobs.ts, and never static', () => {
    expect(handlersOf(read(route)).map((handler) => handler.method)).toEqual(['POST']);
    const code = withoutComments(read(route));
    expect(code).toMatch(/export const dynamic = 'force-dynamic';/);
    expect(code).toMatch(/import \{handleJobRequest\} from '@\/lib\/jobs';/);
    expect(code).toMatch(/export async function POST\(request: Request\) \{\s*return handleJobRequest\(request\);\s*\}/);
    expect(code).not.toMatch(/console\.|\blog\(|process\.env|request\.url|nextUrl|searchParams|cookies\(|headers\(\)/);
    // The paths are the machine paths and the only ones (Story 1.13 added the heartbeat), written once in the one list the proxy reads.
    const publicPaths = withoutComments(read('lib/public-paths.ts'));
    expect(publicPaths).toMatch(/export const machinePaths = \['\/api\/jobs', '\/api\/heartbeat'\];/);
    expect(publicPaths).toMatch(/export const publicPaths = \[[^\]]*\.\.\.machinePaths\];/);
    expect(files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name)).filter((file) => file.startsWith('app/api/jobs'))).toEqual([route]);
  });

  it('skips the proxy\'s origin rule for the machine path and for nothing else', () => {
    const proxy = withoutComments(read('proxy.ts'));
    expect([...proxy.matchAll(/\bisMachinePath\(/g)]).toHaveLength(1);
    expect(proxy).toMatch(/const refusal = isMachinePath\(pathname\) \? null : originRefusal\(request\);/);
    expect(callers('isMachinePath')).toEqual(['lib/public-paths.ts', 'proxy.ts']);
  });

  it('keeps the provider\'s name and every signature check in lib/jobs.ts: nothing under app/ or components/ names it, and one file builds a Receiver', () => {
    for (const file of sources.filter((candidate) => /^(?:app|components)\//.test(candidate))) {
      expect(withoutComments(read(file)), file).not.toMatch(/upstash|qstash|redis/i);
    }
    expect(callers('Receiver')).toEqual(['lib/jobs.ts']);
    expect(sources.filter((file) => /@upstash\//.test(withoutComments(read(file))))).toEqual(['lib/jobs.ts']);
    const jobs = withoutComments(read('lib/jobs.ts'));
    // The SDK's development mode (published signing keys, switched on by an environment variable) is never on, and the check is over the raw body.
    expect(jobs).toMatch(/new Receiver\(\{[^}]*devMode: false[^}]*\}\)/);
    expect(jobs).toMatch(/receiver\.verify\(\{signature, body, clockTolerance/);
  });

  it('checks in the order the contract says, and each check returns before the next one starts', () => {
    const jobs = withoutComments(read('lib/jobs.ts'));
    const order = [
      "request.method !== 'POST'",
      'signingKeys(env)',
      'request.headers.get(signatureHeader)',
      'readRawBody(request)',
      'isSigned(signature, raw.text, keys)',
      'parseBody(raw.text)',
      'isScheduledTask(body.task)',
      'checkInstanceIdentity(',
      'claimJobRun(',
      'await run(task',
      'finishJobRun(',
    ].map((needle) => {
      expect(jobs, needle).toContain(needle);
      return jobs.indexOf(needle);
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('logs nothing from the request: the one log line names a registered task and an error class', () => {
    const jobs = withoutComments(read('lib/jobs.ts'));
    const logs = [...jobs.matchAll(/console\.\w+\(([^;]*)\);/g)].map((match) => match[1]);
    expect(logs).toEqual(["'A scheduled task failed.', task, failure"]);
    // Nothing of the call is reflected: every answer is built from literals (and the task's own outcome), never from the signature, a key, the body or a header.
    const answers = [...jobs.matchAll(/\banswer\(([^;]*)\)(?:;|\s*:)/g)].map((match) => match[1]);
    expect(answers.length).toBeGreaterThan(8);
    for (const call of answers) expect(call, call).not.toMatch(/\b(?:signature|keys|raw|body|messageId|scheduleId|request|env|instanceId|error)\b(?!:)/);
    for (const file of ['lib/job-tasks.ts', 'lib/schedules.ts']) expect(withoutComments(read(file)), file).not.toMatch(/console\.|\blog\(/);
  });

  it('adds no environment variable: the route reads the two signing keys and the instance ID, and nothing else', () => {
    const jobs = withoutComments(read('lib/jobs.ts'));
    expect([...new Set([...jobs.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]))].sort()).toEqual(['INSTANCE_ID', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY']);
    expect([...jobs.matchAll(/process\.env/g)]).toHaveLength(1);
    expect(jobs).toMatch(/const env = options\.env \?\? process\.env;/);
    for (const file of ['lib/job-tasks.ts', 'lib/schedules.ts']) expect(withoutComments(read(file)), file).not.toMatch(/process\.env|\benv\.[A-Z]/);
    // The names are not required by the hosted environment check (the route fails closed without them): /api/health is unchanged.
    const environment = withoutComments(read('lib/environment.ts'));
    expect(environment.slice(environment.indexOf('const requiredVariables'), environment.indexOf('const previewForbiddenName'))).not.toMatch(/QSTASH/);
    expect(environment).toMatch(/const previewForbiddenName = [^\n]*QSTASH_/);
  });

  it('registers exactly four tasks, each run by one function, and no cleanup beyond them (the third is Story 1.12\'s staging cleanup, the fourth Story 1.13\'s alarm monitor)', () => {
    const registry = withoutComments(read('lib/schedules.ts'));
    expect([...registry.matchAll(/task: '([a-z-]+)'/g)].map((match) => match[1])).toEqual(['dormant-identity-purge', 'ledger-relay', 'staging-cleanup', 'alarm-monitor']);
    expect(registry).not.toMatch(/^import\s|\bfrom\s+['"]/m);
    // Every entry says how often it fires, in whole seconds (Story 1.13: the alarm condition `task-late` reads it).
    expect([...registry.matchAll(/intervalSeconds: (\d+),/g)].map((match) => Number(match[1]))).toEqual([86400, 300, 3600, 300]);
    const tasks = withoutComments(read('lib/job-tasks.ts'));
    expect([...tasks.matchAll(/^  '([a-z-]+)': \w+,$/gm)].map((match) => match[1])).toEqual(['ledger-relay', 'dormant-identity-purge', 'staging-cleanup', 'alarm-monitor']);
    for (const deferred of ['session_grants', 'step_up_nonces', 'recovery_tokens', 'ledger_outbox']) expect(tasks, deferred).not.toContain(deferred);
  });

  it('keeps the database functions behind the typed calls: nothing but lib/lifecycle.ts names them', () => {
    const names = ['claim_job_run', 'finish_job_run', 'last_job_run', 'purge_dormant_identities'];
    for (const file of sources.filter((candidate) => candidate !== 'lib/lifecycle.ts' && candidate !== 'lib/accounts.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(new RegExp(`['"\`](?:${names.join('|')})['"\`]`));
    }
    for (const name of names) expect(withoutComments(read('lib/lifecycle.ts')), name).toMatch(new RegExp(`callRow\\(\\s*'${name}'`));
    expect(callers('claimJobRun')).toEqual(['lib/jobs.ts', 'lib/lifecycle.ts']);
    expect(callers('finishJobRun')).toEqual(['lib/jobs.ts', 'lib/lifecycle.ts']);
    expect(callers('purgeDormantIdentities')).toEqual(['lib/job-tasks.ts', 'lib/lifecycle.ts']);
    // Nothing reads a receipt through it: the alarm of Story 1.13 reads them all in one function (api.alarm_observations), not through this one.
    expect(callers('lastJobRun')).toEqual(['lib/lifecycle.ts']);
  });

  it('is the only place that deletes an Auth identity: one function of one migration, and nothing in the application', () => {
    for (const file of sources) {
      expect(withoutComments(read(file)), file).not.toMatch(/auth\.users|deleteUser\(|admin\.deleteUser/);
    }
    const migrations = files('supabase/migrations', (name) => name.endsWith('.sql'));
    const deleters = migrations.filter((file) => /delete\s+from\s+auth\.users/i.test(read(file).replace(/^\s*--.*$/gm, '')));
    expect(deleters).toEqual([migrationFile]);
    const purge = functionBody('create function api.purge_dormant_identities(');
    expect([...purge.matchAll(/delete from auth\.users/g)]).toHaveLength(1);
  });

  it('purges the way registration locks: the row lock first, skipping a row in flight, the conditions read again in a later statement, a foreign-key refusal kept, and no age to choose', () => {
    const purge = functionBody('create function api.purge_dormant_identities(');
    expect(purge.slice(0, purge.indexOf('as $$'))).toMatch(/api\.purge_dormant_identities\(p_limit integer default 100\)\s+returns api\.purge_report\s+language plpgsql\s+security definer\s+set search_path = ''/);
    expect(purge).toMatch(/c_age constant interval := interval '30 days';/);
    expect(purge).toMatch(/p_limit not between 1 and 500/);
    const locked = purge.indexOf('for update skip locked');
    const reread = purge.indexOf('perform 1');
    const deleted = purge.indexOf('delete from auth.users');
    expect(locked).toBeGreaterThan(-1);
    expect(locked).toBeLessThan(reread);
    expect(reread).toBeLessThan(deleted);
    // The re-read repeats all three conditions (no Account, last sign-in or creation, any registration attempt) after the lock.
    const afterLock = purge.slice(reread, deleted);
    for (const needle of ['identity.accounts', 'coalesce(u.last_sign_in_at, u.created_at)', 'identity.registration_attempts']) expect(afterLock, needle).toContain(needle);
    expect(purge).toMatch(/exception when foreign_key_violation then/);
    // The registration functions lock the same row the same way, which is what makes the two serial.
    const accounts = read('supabase/migrations/20261010120100_api.sql');
    expect(accounts).toMatch(/perform 1 from auth\.users u where u\.id = p_user_id for update;/);
    expect(migrationCode).toMatch(/perform 1 from auth\.users u where u\.id = p_user_id for update;/);
  });

  it('closes the receipts table like the other lifecycle tables, makes it append-only, and runs every function as its owner with an empty search_path', () => {
    expect(migrationCode).toMatch(/alter table lifecycle\.job_receipts enable row level security;/);
    expect(migrationCode).toMatch(/revoke all on lifecycle\.job_receipts from public, anon, authenticated, service_role;/);
    expect(migrationCode).not.toMatch(/create policy/i);
    expect(migrationCode).toMatch(/create trigger job_receipts_no_delete before delete on lifecycle\.job_receipts/);
    expect(migrationCode).toMatch(/create trigger job_receipts_no_truncate before truncate on lifecycle\.job_receipts/);
    expect(migrationCode).toMatch(/constraint job_receipts_run_key unique \(schedule_id, message_id, attempt\)/);
    // Each function is granted to the service role by its FULL signature, and to no other role; nothing else of the migration is granted.
    const grantedTo: Record<string, string> = {
      'create function api.claim_job_run(': 'grant execute on function api.claim_job_run(text, text, text, integer) to service_role;',
      'create function api.finish_job_run(': 'grant execute on function api.finish_job_run(uuid, text, json) to service_role;',
      'create function api.last_job_run(': 'grant execute on function api.last_job_run(text) to service_role;',
      'create function api.purge_dormant_identities(': 'grant execute on function api.purge_dormant_identities(integer) to service_role;',
    };
    for (const [header, grant] of Object.entries(grantedTo)) {
      const body = functionBody(header);
      const declaration = body.slice(0, body.indexOf('as $$'));
      expect(declaration, header).toMatch(/security definer/);
      expect(declaration, header).toMatch(/set search_path = ''/);
      expect(migrationCode.split('\n').map((line) => line.trim()), header).toContain(grant);
    }
    expect(migrationCode.match(/^grant execute on function .*$/gm), 'the grants of the migration').toEqual(Object.values(grantedTo));
    expect(migrationCode).not.toMatch(/grant execute on function (?:lifecycle|identity|projects)\./);
    expect(migrationCode).not.toMatch(/grant [^;]* to (?:public|anon|authenticated);/);
    // The claim is serialized per key by an advisory lock taken before the receipt is read.
    const claim = functionBody('create function api.claim_job_run(');
    expect(claim.indexOf('pg_advisory_xact_lock')).toBeGreaterThan(-1);
    expect(claim.indexOf('pg_advisory_xact_lock')).toBeLessThan(claim.indexOf('from lifecycle.job_receipts'));
    expect(claim).toMatch(/p_lease_seconds integer default 300/);
  });

  it('changes api.register_with_code by one outcome only: the function is the 1.3 one, with `no_identity` where an identity that is gone used to be refused', () => {
    const before = read('supabase/migrations/20261010120100_api.sql').replace(/^\s*--.*$/gm, '');
    const old = before.slice(before.indexOf('create function api.register_with_code('), before.indexOf('$$;', before.indexOf('$$', before.indexOf('create function api.register_with_code(')) + 2));
    const now = functionBody('create or replace function api.register_with_code(');
    const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);
    // A real line diff (longest common subsequence), not a comparison of sets: a line that moved, or that was removed here and exists elsewhere in
    // the function, must show up as a change.
    const diff = (a: string[], b: string[]) => {
      const table = Array.from({length: a.length + 1}, () => new Array<number>(b.length + 1).fill(0));
      for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      const removed: string[] = [];
      const added: string[] = [];
      let i = 0;
      let j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
          i += 1;
          j += 1;
        } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) added.push(b[j++]);
        else removed.push(a[i++]);
      }
      return {removed, added};
    };
    const {removed, added} = diff(lines(old), lines(now));
    // Exactly these lines changed: the statement's own header, the identity's row being remembered as found or not after its lock (step 1), and the
    // answer where the verified Google identity is looked up and the row is not there. Nothing else of the function differs, line for line.
    expect(removed).toEqual(['create function api.register_with_code(p_user_id uuid, p_command_id uuid, p_code_hash text, p_origin_hash text)', 'if found then']);
    expect(added).toEqual([
      'create or replace function api.register_with_code(p_user_id uuid, p_command_id uuid, p_code_hash text, p_origin_hash text)',
      'v_identity_found boolean := false;',
      'v_identity_found := found;',
      'if v_identity_found then',
      'if not v_identity_found then',
      "v_receipt.outcome := 'no_identity';",
      'return v_receipt;',
      'end if;',
    ]);
    expect(now).toContain("v_receipt.outcome := 'no_identity';");
    expect(now.indexOf("'no_identity'")).toBeGreaterThan(now.indexOf('identity.verified_google(p_user_id)'));
    // The consumption of a pre-authorization is untouched by this migration.
    expect(migrationCode).not.toMatch(/function api\.consume_preauthorization/);
  });
});

describe('The file gateway (Story 1.12): no file through a Vercel function, one place that touches Storage, one place that reads each variable', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'instrumentation.ts',
    'instrumentation-node.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const gateway = files('workers/files/src', (name) => name.endsWith('.ts'));
  const migrationFile = 'supabase/migrations/20261015120000_file_gateway.sql';
  const migration = read(migrationFile).replace(/^\s*--.*$/gm, '');
  const functionBody = (header: string) => {
    const start = migration.indexOf(header);
    expect(start, header).toBeGreaterThan(-1);
    return migration.slice(start, migration.indexOf('$$;', migration.indexOf('$$', start) + 2));
  };

  it('finds the gateway it is meant to read', () => {
    expect(gateway.map((file) => file.replace('workers/files/src/', '')).sort()).toEqual(['config.ts', 'database.ts', 'main.ts', 'resolvers.ts', 'server.ts', 'storage.ts', 'strip.ts', 'transfer.ts']);
  });

  it('gives the application one route about transfers, a POST that reads a capped body and moves no file', () => {
    const routes = files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name)).filter((file) => /transfers|files|uploads|downloads/i.test(file));
    expect(routes).toEqual(['app/api/transfers/tickets/route.ts']);
    expect(handlersOf(read(routes[0])).map((handler) => handler.method)).toEqual(['POST']);
    const code = withoutComments(read(routes[0]));
    expect(code).toMatch(/export const dynamic = 'force-dynamic';/);
    expect(code).toMatch(/return issueTransferTicket\(request, guard\.access, process\.env\);/);
    expect([...code.matchAll(/process\.env/g)]).toHaveLength(1);
    expect(code).not.toMatch(/console\.|\blog\(|request\.(?:formData|arrayBuffer|blob|body|text|json)\b/);
    // The body is read in lib/transfer-tickets.ts, to its cap and no further: a request cannot carry a file through here.
    const tickets = withoutComments(read('lib/transfer-tickets.ts'));
    expect(tickets).toMatch(/export const maxTicketBodyBytes = 4096;/);
    expect(tickets).not.toMatch(/formData\(|arrayBuffer\(|\.blob\(|multipart/);
  });

  it('reads no request body anywhere under app/ or in the proxy but the capped ones (the scheduled-job route and the ticket route) and the status lookup', () => {
    for (const file of sources.filter((candidate) => /^app\/.*route\.ts$/.test(candidate))) {
      const code = withoutComments(read(file));
      expect(code, file).not.toMatch(/\.formData\(|\.arrayBuffer\(|\.blob\(|multipart\/form-data/);
    }
  });

  it('keeps Storage out of the application: nothing under app/, components/ or lib/ names an S3 client, a signed URL or the Storage API', () => {
    for (const file of sources) {
      expect(withoutComments(read(file)), file).not.toMatch(/@aws-sdk|\bS3Client\b|getSignedUrl|createSignedUrl|createSignedUploadUrl|\.storage\.from\(|\bstorage\.from\(|\/storage\/v1\/object|presign/i);
    }
    // ... and only the gateway's own storage module holds an S3 client, with the gateway's own key pair.
    expect(gateway.filter((file) => /@aws-sdk/.test(withoutComments(read(file))))).toEqual(['workers/files/src/storage.ts']);
    expect(files('workers', (name) => name.endsWith('.ts') || name.endsWith('.mjs')).filter((file) => /@aws-sdk/.test(withoutComments(read(file))))).toEqual(['workers/files/src/storage.ts']);
  });

  it('hands a browser a ticket and the gateway\'s address and nothing else: no storage URL or credential is signed into a ticket or answered', () => {
    const tickets = withoutComments(read('lib/transfer-tickets.ts'));
    expect(tickets).toMatch(/return answer\(200, \{ticket, gateway: config\.gateway\}\);/);
    expect(tickets).not.toMatch(/SECRET_ACCESS_KEY|ACCESS_KEY_ID|S3_ENDPOINT|storage|signedUrl/i);
    const signing = withoutComments(read('lib/service-signing.ts'));
    expect(signing).not.toMatch(/SECRET_ACCESS_KEY|ACCESS_KEY_ID|S3_ENDPOINT|\bstorage\b/i);
  });

  it('reads the signing configuration in one module: the keys, the gateway address and the instance are read from the environment by lib/gateway-client.ts alone', () => {
    const readers = sources.filter((file) => /SERVICE_SIGNING_KEY_|SERVICE_KEYS_|FILE_GATEWAY_URL|signingKeyVariable|keySetVariable/.test(withoutComments(read(file)))).sort();
    // (Story 1.13 adds lib/heartbeat.ts, which reads the heartbeat issuer's PUBLIC key set (SERVICE_KEYS_HEARTBEAT) to verify the Railway task's token, and no private key.)
    expect(readers).toEqual(['lib/environment.ts', 'lib/gateway-client.ts', 'lib/heartbeat.ts', 'lib/service-signing.ts']);
    for (const file of ['lib/transfer-tickets.ts', 'lib/job-tasks.ts', 'lib/schedules.ts', 'lib/service-signing.ts', 'lib/canonical-json.ts']) {
      expect(withoutComments(read(file)), file).not.toMatch(/process\.env|\benv\.[A-Z]/);
    }
    // The one new `process.env` is the default argument of the one function that is the pattern of `configuredLedgerStore`.
    expect([...withoutComments(read('lib/gateway-client.ts')).matchAll(/process\.env/g)]).toHaveLength(1);
    expect(withoutComments(read('lib/gateway-client.ts'))).toMatch(/export function configuredGatewayClient\(env: Env = process\.env,/);
  });

  it('keeps the database functions behind the typed calls, and nothing in the application revokes a key', () => {
    const names = ['revoke_service_key', 'list_expired_staging'];
    for (const file of sources.filter((candidate) => candidate !== 'lib/lifecycle.ts' && candidate !== 'lib/accounts.ts')) {
      expect(withoutComments(read(file)), file).not.toMatch(new RegExp(`['"\`](?:${names.join('|')})['"\`]`));
    }
    for (const name of names) expect(withoutComments(read('lib/lifecycle.ts')), name).toMatch(new RegExp(`callRow\\(\\s*'${name}'`));
    expect(callers('listExpiredStaging')).toEqual(['lib/job-tasks.ts', 'lib/lifecycle.ts']);
    expect(callers('revokeServiceKey')).toEqual(['lib/lifecycle.ts']);
    expect(callers('createGatewayClient')).toEqual(['lib/gateway-client.ts']);
    // On purpose changed (Story 2.12): lib/retention.ts is the new caller of the gateway client, and the one caller of its `attach` for pictures.
    expect(callers('configuredGatewayClient')).toEqual(['lib/gateway-client.ts', 'lib/job-tasks.ts', 'lib/retention.ts']);
    expect(callers('signTicket')).toEqual(['lib/service-signing.ts', 'lib/transfer-tickets.ts']);
    expect(callers('signCommand')).toEqual(['lib/gateway-client.ts', 'lib/service-signing.ts']);
  });

  it('keeps the two modules the gateway shares with the application free of the framework, of "@/" and of everything but node:crypto', () => {
    const signing = withoutComments(read('lib/service-signing.ts'));
    expect([...signing.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1])).toEqual(['node:crypto']);
    expect(withoutComments(read('lib/canonical-json.ts'))).not.toMatch(/^import\s|\bfrom\s+['"]|\brequire\(/m);
    for (const file of ['lib/service-signing.ts', 'lib/canonical-json.ts']) {
      const code = withoutComments(read(file));
      expect(code, file).not.toMatch(/from 'next|from "next|from '@\/|\benum\s+\w+\s*\{|constructor\s*\([^)]*\b(?:private|public|readonly)\s|console\.|process\./);
    }
    // The gateway, and nothing else of the application, imports them.
    const imports = gateway.flatMap((file) => [...withoutComments(read(file)).matchAll(/from '(\.\.[^']*)'/g)].map((match) => `${file.replace('workers/files/src/', '')} ${match[1]}`)).sort();
    expect(imports).toEqual([
      'config.ts ../../../lib/service-signing.ts',
      'server.ts ../../../lib/canonical-json.ts',
      'server.ts ../../../lib/service-signing.ts',
    ]);
  });

  // Every worker is an image (Story 1.13 made the check below cover all of them, not the gateway alone): each directory under workers/ that holds a Dockerfile.
  const workers = files('workers', (name) => name === 'Dockerfile').map((file) => file.split('/')[1]).sort();
  // What each worker's image has to carry: the files it imports from outside its own directory (all of them, for the heartbeat task: it is pinned exactly) and
  // the packages it imports. A new worker adds its entry here on purpose.
  const imageExpectations: Record<string, {outside: string[]; bare: string[]; exact: boolean}> = {
    files: {outside: ['lib/canonical-json.ts', 'lib/service-signing.ts'], bare: ['@aws-sdk/client-s3', '@aws-sdk/lib-storage', 'pg'], exact: false},
    heartbeat: {outside: ['lib/service-signing.ts'], bare: [], exact: true},
  };

  it('finds the workers it is meant to read', () => {
    expect(workers).toEqual(['files', 'heartbeat']);
    for (const worker of workers) expect(imageExpectations, `workers/${worker} needs its entry in imageExpectations`).toHaveProperty(worker);
  });

  it.each(workers)('builds the %s worker into an image that can run: every package it imports is a production dependency, and every file it imports from outside its directory is copied by the Dockerfile and let through by .dockerignore', (worker) => {
    // The image installs `npm ci --omit=dev` and copies only what the Dockerfile names; a module a worker (or a file it shares) starts to import that is in neither place is a
    // build that passes every test here and fails at start-up on the platform, which is the one place nobody looks.
    const dir = `workers/${worker}`;
    const own = files(`${dir}/src`, (name) => name.endsWith('.ts'));
    const expected = imageExpectations[worker];
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>};
    const dockerfile = read(`${dir}/Dockerfile`);
    const copied = [...dockerfile.matchAll(/^COPY\s+(.+)$/gm)].flatMap((match) => {
      const parts = match[1].trim().split(/\s+/);
      return parts.slice(0, -1);
    });
    // .dockerignore as Docker reads it: the last pattern that matches a path (or a directory above it) decides; `!` lets it in.
    const patterns = read('.dockerignore')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    const globbed = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`);
    const sent = (path: string) => {
      const above = path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
      let included = true;
      for (const entry of patterns) {
        const negated = entry.startsWith('!');
        const matcher = globbed(negated ? entry.slice(1) : entry);
        if (above.some((candidate) => matcher.test(candidate))) included = negated;
      }
      return included;
    };
    const covered = (path: string) => copied.some((source) => path === source || path.startsWith(`${source.replace(/\/$/, '')}/`));

    // The closure of what main.ts imports, through relative imports, wherever they lead.
    const seen = new Set<string>();
    const queue = [`${dir}/src/main.ts`];
    const bare = new Map<string, string>();
    const outside = new Set<string>();
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const code = withoutComments(read(file));
      const found = [
        ...[...code.matchAll(/^(import|export)(\s+type)?\s[^;]*?from\s+'([^']+)';/gm)].map((match) => ({type: match[2] !== undefined, from: match[3]})),
        ...[...code.matchAll(/^import\s+'([^']+)';/gm)].map((match) => ({type: false, from: match[1]})),
        ...[...code.matchAll(/\bimport\(\s*'([^']+)'/g)].map((match) => ({type: false, from: match[1]})),
      ];
      for (const {type, from} of found) {
        if (from.startsWith('node:')) continue;
        if (from.startsWith('.')) {
          const target = join(file, '..', from).split('\\').join('/');
          if (!target.startsWith(`${dir}/`)) outside.add(target);
          queue.push(target);
        } else if (!type) {
          bare.set(from.startsWith('@') ? from.split('/').slice(0, 2).join('/') : from.split('/')[0], file);
        }
      }
    }
    for (const [name, importer] of bare) expect(manifest.dependencies, `${name} (imported by ${importer}) is not a production dependency`).toHaveProperty(name);
    for (const path of [...outside, 'package.json', 'package-lock.json', ...own]) {
      expect(covered(path), `${path} is not copied by ${dir}/Dockerfile`).toBe(true);
      expect(sent(path), `${path} is excluded by .dockerignore`).toBe(true);
    }
    // The walk found something to check (what the worker may import at all is pinned by the tests beside this one).
    expect([...seen].filter((file) => file.startsWith(`${dir}/`)).length).toBe(own.length);
    if (expected.exact) {
      expect([...outside].sort()).toEqual(expected.outside);
      expect([...bare.keys()].sort()).toEqual(expected.bare);
    } else {
      expect([...outside]).toEqual(expect.arrayContaining(expected.outside));
      expect([...bare.keys()]).toEqual(expect.arrayContaining(expected.bare));
    }
    // The matcher is not trivially true: what the image does not copy is excluded.
    for (const path of ['lib/environment.ts', 'app/page.tsx', 'tests/unit/gate-structure.test.ts', '.env.local']) expect(sent(path), path).toBe(false);
  });

  it('holds the heartbeat task to node:*, its own two modules and lib/service-signing.ts; reads the environment, prints and exits in main.ts alone; holds one secret, its own signing key, and makes one request', () => {
    const task = files('workers/heartbeat/src', (name) => name.endsWith('.ts'));
    expect(task.map((file) => file.replace('workers/heartbeat/src/', '')).sort()).toEqual(['config.ts', 'main.ts']);
    const allowed = /^(?:node:[a-z/]+|\.\/[a-z]+\.ts|\.\.\/\.\.\/\.\.\/lib\/service-signing\.ts)$/;
    for (const file of task) {
      const code = withoutComments(read(file));
      for (const match of code.matchAll(/^(?:import|export)\s[^;]*?from '([^']+)';/gm)) expect(match[1], `${file}: ${match[0].slice(0, 80)}`).toMatch(allowed);
      expect(code, file).not.toMatch(/\brequire\(|\benum\s+\w+\s*\{|constructor\s*\([^)]*\b(?:private|public|readonly)\s|@aws-sdk|from 'pg'|DATABASE|STORAGE|SERVICE_ROLE|SUPABASE|QSTASH|RESEND|PASSWORD|SECRET/);
      // The only variables it reads are its five, and the only secret among them is its own signing key.
      expect([...new Set([...code.matchAll(/'([A-Z][A-Z0-9]*_[A-Z0-9_]+)'/g)].map((match) => match[1]))].sort(), file).toEqual(file.endsWith('config.ts') ? ['APP_ENV', 'APP_ORIGIN', 'INSTANCE_ID', 'SERVICE_KEYS_HEARTBEAT', 'SERVICE_SIGNING_KEY_HEARTBEAT'] : []);
      if (!file.endsWith('main.ts')) expect(code, file).not.toMatch(/process\.|console\./);
    }
    const config = withoutComments(read('workers/heartbeat/src/config.ts'));
    expect(config).toMatch(/loadSigner\(privateKey, parsed\.keySet\)/);
    expect(config).toMatch(/parseKeySet\(keysText, 'heartbeat', nowMs\)/);
    const main = withoutComments(read('workers/heartbeat/src/main.ts'));
    // The environment is read once, at the entry point, and the process exits there and nowhere else; the only prints are the default loggers.
    expect([...main.matchAll(/process\.env/g)]).toHaveLength(1);
    expect([...main.matchAll(/process\.exit\(/g)]).toHaveLength(1);
    expect([...main.matchAll(/console\.(\w+)\(/g)].map((match) => match[1])).toEqual(['log', 'error']);
    // Every line it prints is a fixed one (or a problem naming a variable, which readConfig builds from names and rules, never from a value).
    const printed = [...main.matchAll(/\b(?:log|error)\(([^;]*)\);/g)].map((match) => match[1]);
    expect(printed.length).toBeGreaterThan(4);
    for (const call of printed) expect(call, call).toMatch(/^(?:lines\.(?:recorded|refused|unreachable|notStarted)|`  \$\{problem\}`|line\)?)$/);
    // One request: a POST with the heartbeat scheme and no body, a timeout, no redirect followed, nothing cached.
    expect([...main.matchAll(/\bfetch\)?\(/g)]).toHaveLength(1);
    expect(main).toMatch(/method: 'POST',\s*headers: \{authorization: `Heartbeat \$\{token\}`\},\s*redirect: 'error',\s*cache: 'no-store',\s*signal: AbortSignal\.timeout\(postTimeoutMs\),/);
    expect(main).not.toMatch(/\bbody:|\bcookie\b|\borigin:/i);
    expect(main).toMatch(/signHeartbeat\(config\.signer, config\.instanceId,/);
  });

  it('holds the gateway to node:http, its own modules, pg, the S3 client and the two shared files; reads the environment in main.ts alone; logs an error\'s name and nothing else', () => {
    const allowed = /^(?:node:[a-z/]+|pg|@aws-sdk\/(?:client-s3|lib-storage)|\.\/[a-z]+\.ts|\.\.\/\.\.\/\.\.\/lib\/(?:service-signing|canonical-json)\.ts)$/;
    for (const file of gateway) {
      const code = withoutComments(read(file));
      for (const match of code.matchAll(/^(?:import|export)\s[^;]*?from '([^']+)';/gm)) expect(match[1], `${file}: ${match[0].slice(0, 80)}`).toMatch(allowed);
      expect(code, file).not.toMatch(/\brequire\(|\benum\s+\w+\s*\{|constructor\s*\([^)]*\b(?:private|public|readonly)\s/);
      expect(code, file).not.toMatch(/set-cookie|\bcookie\b|access-control-allow-credentials|access-control-allow-origin['"]?\s*[:,]\s*['"]\*|getSignedUrl|presign/i);
      // (server.ts holds the default logger's one console.error, checked below.)
      if (file !== 'workers/files/src/main.ts') expect(code, file).not.toMatch(file === 'workers/files/src/server.ts' ? /process\.env|process\.exit/ : /process\.env|process\.exit|console\./);
    }
    // The one default logger prints a fixed sentence and an error's class name: never a request, a ticket, a handle, a key or a body.
    const server = withoutComments(read('workers/files/src/server.ts'));
    expect([...server.matchAll(/console\.error\(([^;]*)\)\)/g)].map((match) => match[1])).toEqual(['message, detail']);
    for (const call of server.matchAll(/\blog\(([^;]*)\);/g)) expect(call[1], call[0]).toMatch(/^'[A-Z][^']*', error instanceof Error \? error\.name : 'unknown failure'$/);
  });

  it('asks the database before every chunk, in both directions, and cuts a chunk to at most 1 MiB first', () => {
    const server = withoutComments(read('workers/files/src/server.ts'));
    expect(withoutComments(read('lib/service-signing.ts'))).toMatch(/chunkBytes: 1024 \* 1024,/);
    expect(server).toMatch(/const chunkBytes = transferLimits\.chunkBytes;/);
    // Upload: the request body is cut into chunks, and each is authorized before it is counted, hashed or handed to Storage.
    const upload = server.slice(server.indexOf('async function* chunks()'), server.indexOf('await storage.put('));
    expect(upload).toContain('blocks(req.iterator({destroyOnReturn: false}), chunkBytes)');
    expect(upload.indexOf('authorize(transfer)')).toBeGreaterThan(-1);
    for (const later of ['hasher.update(block)', 'received += block.length', 'database.progress(', 'yield block']) expect(upload.indexOf('authorize(transfer)'), later).toBeLessThan(upload.indexOf(later));
    // Download: the first chunk is authorized before the headers go out, and each later one before it is written to the client.
    const download = server.slice(server.indexOf('const chunks = blocks(stored.body, chunkBytes);'), server.indexOf("res.end();", server.indexOf('const chunks = blocks(stored.body, chunkBytes);')));
    expect(download).toContain('authorize(transfer)');
    expect(download.indexOf('authorize(transfer)')).toBeLessThan(download.indexOf('res.writeHead('));
    expect(download.indexOf('res.writeHead(')).toBeLessThan(download.indexOf('write(res, step.value)'));
    const later = download.indexOf('if (step.done) break;');
    expect(later).toBeGreaterThan(download.indexOf('write(res, step.value)'));
    expect(download.indexOf('authorize(transfer)', later)).toBeGreaterThan(later);
    expect(download.indexOf('authorize(transfer)', later)).toBeLessThan(download.indexOf('res.destroy()', later));
    // And the decision is never kept: no cache, no memo, no remembered answer between chunks.
    expect(server).not.toMatch(/\bcache\b(?!-control)|\bmemo|\blastDecision\b|\bremembered\b/i);
    const database = withoutComments(read('workers/files/src/database.ts'));
    expect(database).not.toMatch(/new Map\(|\bcache\b|\bmemo/i);
  });

  it('answers every response with no-store and nosniff, allows one origin and never a wildcard, and refuses a command that carries an Origin', () => {
    const server = withoutComments(read('workers/files/src/server.ts'));
    expect(server).toMatch(/res\.setHeader\('cache-control', 'no-store'\);/);
    expect(server).toMatch(/res\.setHeader\('x-content-type-options', 'nosniff'\);/);
    expect(server).toMatch(/res\.setHeader\('vary', 'Origin'\);/);
    expect(server).toMatch(/if \(origin !== appOrigin\) return fail\(res, 403, 'forbidden_origin'\);/);
    expect(server).toMatch(/if \(req\.headers\.origin !== undefined\) return fail\(res, 403, 'forbidden_origin'\);/);
    expect(server).toMatch(/res\.setHeader\('referrer-policy', 'no-referrer'\);/);
  });

  it('is the migration of a closed schema: six tables, each with row-level security on and every privilege revoked, and a policy only for the gateway\'s own role', () => {
    for (const table of ['service_key_revocations', 'staging_leases', 'ticket_redemptions', 'transfer_handles', 'attachment_transforms', 'manifests']) {
      expect(migration, table).toMatch(new RegExp(`alter table artifacts\\.${table} enable row level security;`));
      expect(migration, table).toMatch(new RegExp(`revoke all on artifacts\\.${table} from public, anon, authenticated, service_role;`));
    }
    expect([...migration.matchAll(/create table (artifacts\.\w+)/g)].map((match) => match[1]).sort()).toEqual([
      'artifacts.attachment_transforms',
      'artifacts.manifests',
      'artifacts.service_key_revocations',
      'artifacts.staging_leases',
      'artifacts.ticket_redemptions',
      'artifacts.transfer_handles',
    ]);
    // Every policy is for the gateway role alone, and none for another role or for PUBLIC.
    const policies = [...migration.matchAll(/^create policy .*$/gm)].map((match) => match[0]);
    expect(policies).toHaveLength(7);
    for (const policy of policies) expect(policy).toMatch(/^create policy gateway_(?:select|insert|update) on artifacts\.(?:staging_leases|ticket_redemptions|transfer_handles) for (?:select|insert|update) to nova3d_gateway /);
    expect(migration).toMatch(/alter default privileges for role postgres in schema artifacts revoke execute on functions from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/alter default privileges for role postgres in schema artifacts revoke all on tables from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/revoke all on schema artifacts from public, anon, authenticated, service_role;/);
  });

  it('gives the gateway role what its list names and nothing else, and no password: a password in a migration is a secret in the repository', () => {
    const grants = [...migration.matchAll(/^grant .*$/gm)].map((match) => match[0]);
    expect(grants).toEqual([
      'grant usage on schema artifacts to nova3d_gateway;',
      'grant select on artifacts.session_authority to nova3d_gateway;',
      'grant select on artifacts.instance to nova3d_gateway;',
      'grant select, insert on artifacts.ticket_redemptions to nova3d_gateway;',
      'grant select, insert on artifacts.transfer_handles to nova3d_gateway;',
      'grant select, insert on artifacts.staging_leases to nova3d_gateway;',
      'grant update (received_length, state, expires_at) on artifacts.staging_leases to nova3d_gateway;',
      'grant execute on function artifacts.publish_attachment(uuid, bigint, uuid, text, text, text) to nova3d_gateway;',
      'grant execute on function api.revoke_service_key(text, text, text) to service_role;',
      'grant execute on function api.list_expired_staging(integer) to service_role;',
    ]);
    for (const file of files('supabase/migrations', (name) => name.endsWith('.sql'))) {
      expect(read(file).replace(/^\s*--.*$/gm, ''), file).not.toMatch(/(?:create|alter)\s+role[^;]*password/i);
    }
    expect(migration).toMatch(/create role nova3d_gateway login;/);
    expect(read('supabase/seed.sql')).toMatch(/alter role nova3d_gateway with password '/);
    // Every function it creates runs with an empty search_path, and the two that run as their owner say so.
    for (const match of migration.matchAll(/create (?:or replace )?function ((?:artifacts|api)\.\w+)\(/g)) expect(functionBody(match[0]), match[1]).toMatch(/set search_path = ''/);
    for (const header of ['create function artifacts.publish_attachment(', 'create function api.revoke_service_key(', 'create function api.list_expired_staging(', 'create function artifacts.guard_redemption(']) expect(functionBody(header), header).toMatch(/security definer/);
  });

  it('refuses a redemption under a revoked key in the insert itself, and writes a manifest from one function that asserts the authority first', () => {
    expect(functionBody('create function artifacts.guard_redemption(')).toMatch(/errcode = 'N3040'/);
    expect(migration).toMatch(/create trigger ticket_redemptions_guard before insert on artifacts\.ticket_redemptions/);
    expect([...migration.matchAll(/insert into artifacts\.manifests/g)]).toHaveLength(1);
    const publish = functionBody('create function artifacts.publish_attachment(');
    expect(publish).toMatch(/insert into artifacts\.manifests/);
    expect(publish.indexOf('identity.assert_operation_authority(p_account_id, p_epoch)')).toBeGreaterThan(-1);
    expect(publish.indexOf('identity.assert_operation_authority(p_account_id, p_epoch)')).toBeLessThan(publish.indexOf('from artifacts.staging_leases'));
    expect(publish.indexOf('from artifacts.staging_leases')).toBeLessThan(publish.indexOf('insert into artifacts.manifests'));
    expect(publish).toMatch(/for update;/);
  });

  it('reads the session\'s liveness in a view that calls no function of another schema and writes nothing', () => {
    const view = migration.slice(migration.indexOf('create view artifacts.session_authority'), migration.indexOf('comment on view artifacts.session_authority'));
    expect(view).not.toMatch(/\b(?:identity|lifecycle|api|projects)\.\w+\(/);
    expect(view).not.toMatch(/\b(?:insert|update|delete)\b/i);
    for (const state of ['tombstoned', 'disabled', 'no_session', 'subject_mismatch', 'revoked', 'expired', 'idle', 'stale_epoch', 'active']) expect(view, state).toContain(`'${state}'`);
    expect(view).toMatch(/interval '30 days'/);
    expect(view).toMatch(/interval '7 days'/);
  });

  it('writes the contract down for whoever writes the next resolver, and names the three things only Josh can do', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['The file gateway', 'transfer handle', 'artifacts.session_authority', 'artifacts.publish_attachment', 'api.revoke_service_key', 'delete-staging', 'resolvers.ts', 'transferTargetKinds', 'no user file crosses a Vercel function'.replace(/^n/, 'N')]) expect(contract, needle).toContain(needle);
    const ledger = JSON.parse(read('provisioning/ledger.json')) as {items: {id: string; due: string}[]};
    for (const id of ['gateway-database-role', 'gateway-storage-s3-key', 'railway-files-service', 'hosted-gateway-check']) expect(ledger.items.find((item) => item.id === id)?.due, id).toBe('1-12');
  });
});

describe('Operational alarms (Story 1.13) have one channel, one evaluator for each condition, one reader for each variable and records only the api reaches', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'instrumentation.ts',
    'instrumentation-node.ts',
  ];
  const code = (file: string) => withoutComments(read(file));
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(code(file))).sort();
  const migrationFile = 'supabase/migrations/20261016120000_alarms.sql';
  const migration = read(migrationFile).replace(/^\s*--.*$/gm, '');
  const functionBody = (header: string) => {
    const start = migration.indexOf(header);
    expect(start, header).toBeGreaterThan(-1);
    return migration.slice(start, migration.indexOf('$$;', migration.indexOf('$$', start) + 2));
  };
  const route = 'app/api/heartbeat/route.ts';

  it('mails through one door: sendAlarmMail is called by lib/alarms.ts alone, and there is no other function that sends an alarm', () => {
    expect(callers('sendAlarmMail')).toEqual(['lib/alarms.ts', 'lib/mailer.ts']);
    expect(callers('alarmMessage')).toEqual(['lib/mailer.ts']);
    expect(callers('dispatchDueMail')).toEqual(['lib/alarms.ts']);
    // The mailer sends two things, the recovery link and the alarm, through one internal function; nothing else in the application reaches a mail provider.
    const mailer = code('lib/mailer.ts');
    expect([...mailer.matchAll(/^export async function (\w+)/gm)].map((match) => match[1])).toEqual(['sendRecoveryMail', 'sendAlarmMail']);
    expect([...mailer.matchAll(/\bdeliver\(/g)]).toHaveLength(3);
    for (const file of sources.filter((candidate) => candidate !== 'lib/mailer.ts')) expect(code(file), file).not.toMatch(/api\.resend\.com|\/api\/v1\/send|\bnodemailer\b|\bsmtp\b/i);
  });

  it('has no recipient anywhere but the environment: sendAlarmMail takes an alarm and options, and the address is read in the one function that delivers', () => {
    const mailer = code('lib/mailer.ts');
    expect(mailer).toMatch(/export async function sendAlarmMail\(alarm: AlarmNotice, options: MailerOptions = \{\}\)/);
    expect([...mailer.matchAll(/recipientOf\(env\)/g)]).toHaveLength(1);
    expect(mailer).toMatch(/const to = recipientOf\(env\)/);
    expect([...mailer.matchAll(/env\.ADMINISTRATOR_EMAIL/g)]).toHaveLength(1);
    // The alarm type holds no address: a condition, a subject, a time and a detail.
    expect(mailer.slice(mailer.indexOf('export type AlarmNotice'), mailer.indexOf('export type AlarmNotice') + 160)).toMatch(/\{condition: string; subject: string \| null; firstAt: string; detail: AlarmDetail\}/);
    // The message is built from fixed words, the environment, the condition, the subject, the first time, the whole numbers and booleans of the detail by their keys,
    // and three named keys of its text (F2: the whole detail was three keys of text before). Neither the alarm nor its detail is ever dumped whole.
    expect(mailer).toMatch(/export const alarmMailDetailKeys = \['receipt_task', 'receipt_outcome', 'receipt_at'\] as const;/);
    expect(mailer).not.toMatch(/JSON\.stringify\(alarm|Object\.entries\(alarm\)|Object\.values\(alarm|\.\.\.alarm\b/);
    expect([...mailer.matchAll(/Object\.entries\(alarm\.detail\)/g)]).toHaveLength(1);
    expect(mailer).toMatch(/typeof value === 'boolean' \|\| \(typeof value === 'number' && Number\.isSafeInteger\(value\)\)/);
    // The environment is `APP_ENV`, read in one function of the mailer's, from the environment the mailer is given; no new variable.
    expect(mailer).toMatch(/function configuredEnvironment\(env: Env\)/);
    expect(mailer).toMatch(/configuredEnvironment\(options\.env \?\? process\.env\)/);
    expect([...new Set([...mailer.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]))].sort()).toEqual(['ADMINISTRATOR_EMAIL', 'APP_ENV', 'NEXT_PUBLIC_SUPABASE_URL', 'RESEND_API_KEY']);
  });

  it('keeps the alarm path free of environment reads and logging: lib/alarms.ts and lib/alarm-conditions.ts read no variable, print nothing and read no clock', () => {
    for (const file of ['lib/alarms.ts', 'lib/alarm-conditions.ts']) {
      expect(code(file), file).not.toMatch(/process\.env|\benv\.[A-Z]|console\.|\blog\(|\bDate\b|Date\.now|new Date/);
    }
    // The one clock the dispatch reads is a monotonic one, for the elapsed time of its own work, passed in by a test or defaulted in one place (review patch P1).
    expect([...code('lib/alarms.ts').matchAll(/performance\.now\(\)/g)]).toHaveLength(1);
    expect(code('lib/alarms.ts')).toMatch(/const clock = deps\.clock \?\? \(\(\) => performance\.now\(\)\);/);
    expect(code('lib/alarms.ts')).toMatch(/export const dispatchDeadlineMs = 10_000;/);
    // The conditions are pure: the only thing they import is the schedule registry.
    expect([...code('lib/alarm-conditions.ts').matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1])).toEqual(['./schedules.ts']);
    // The monitor imports the database calls and the mailer, and nothing that reads the environment.
    expect([...code('lib/alarms.ts').matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort()).toEqual(['./accounts.ts', './alarm-conditions.ts', './lifecycle.ts', './schedules.ts', '@/lib/mailer']);
  });

  it('keeps the database functions behind the typed calls: nothing but lib/lifecycle.ts names them, and each typed call has the callers it should', () => {
    const names = ['raise_alarm', 'resolve_alarm', 'list_alarms', 'alarms_due_mail', 'record_alarm_notice', 'alarm_observations', 'record_heartbeat'];
    for (const file of sources.filter((candidate) => candidate !== 'lib/lifecycle.ts' && candidate !== 'lib/accounts.ts')) {
      expect(code(file), file).not.toMatch(new RegExp(`['"\`](?:${names.join('|')})['"\`]`));
    }
    for (const name of names) expect(code('lib/lifecycle.ts'), name).toMatch(new RegExp(`callRow\\(\\s*'${name}'`));
    expect(callers('resolveAlarm')).toEqual(['lib/alarms.ts', 'lib/lifecycle.ts']);
    expect(callers('alarmsDueMail')).toEqual(['lib/alarms.ts', 'lib/lifecycle.ts']);
    expect(callers('recordAlarmNotice')).toEqual(['lib/alarms.ts', 'lib/lifecycle.ts']);
    expect(callers('alarmObservations')).toEqual(['lib/alarms.ts', 'lib/lifecycle.ts']);
    expect(callers('recordHeartbeat')).toEqual(['lib/heartbeat.ts', 'lib/lifecycle.ts']);
    expect(callers('listAlarms')).toEqual(['app/admin/operations/page.tsx', 'lib/alarms.ts', 'lib/lifecycle.ts']);
    // The monitor and the pushed helper write an alarm through the one typed call, and nothing else does.
    expect(callers('raiseAlarmRecord')).toEqual(['lib/alarms.ts']);
  });

  it('counts the Auth identities in one function of one migration, and the application never names auth.users', () => {
    for (const file of sources) expect(code(file), file).not.toMatch(/auth\.users/);
    expect([...migration.matchAll(/from auth\.users/g)]).toHaveLength(1);
    expect(functionBody('create function api.alarm_observations(')).toMatch(/from auth\.users u\s+where not exists \(select 1 from identity\.accounts a where a\.user_id = u\.id\)/);
    // ... and the preflight reads no row of it.
    expect(functionBody('create or replace function api.preflight(')).not.toMatch(/auth\.users u|from auth\.users/);
  });

  it('is one POST at one exact path, a one-line caller of the handler in lib/heartbeat.ts, never static, and the second machine path', () => {
    expect(handlersOf(read(route)).map((handler) => handler.method)).toEqual(['POST']);
    const routeCode = code(route);
    expect(routeCode).toMatch(/export const dynamic = 'force-dynamic';/);
    expect(routeCode).toMatch(/import \{handleHeartbeatRequest\} from '@\/lib\/heartbeat';/);
    expect(routeCode).toMatch(/export async function POST\(request: Request\) \{\s*return handleHeartbeatRequest\(request\);\s*\}/);
    expect(routeCode).not.toMatch(/console\.|\blog\(|process\.env|request\.url|nextUrl|searchParams|cookies\(|headers\(\)/);
    expect(files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name)).filter((file) => file.startsWith('app/api/heartbeat'))).toEqual([route]);
    expect(code('lib/public-paths.ts')).toMatch(/export const machinePaths = \['\/api\/jobs', '\/api\/heartbeat'\];/);
  });

  it('checks in the order the contract says, and each check returns before the next one starts', () => {
    const heartbeat = code('lib/heartbeat.ts');
    const order = [
      "request.method !== 'POST'",
      "request.headers.get('origin') !== null",
      'keySetOf(env)',
      'tokenOf(request)',
      'await verifyToken(token',
      'heartbeatClaimsOf(verified.payload)',
      'recordableJti.test(verified.payload.jti)',
      'await readBody(request)',
      'await recordHeartbeat(',
      "recorded.outcome === 'revoked'",
      "recorded.outcome === 'duplicate'",
      'await runHeartbeatEvaluation(',
    ].map((needle) => {
      expect(heartbeat, needle).toContain(needle);
      return heartbeat.indexOf(needle);
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('reads one variable and one environment: the heartbeat key set (never a private key) and the instance, with one default for the process environment', () => {
    const heartbeat = code('lib/heartbeat.ts');
    expect([...new Set([...heartbeat.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]))].sort()).toEqual(['INSTANCE_ID']);
    expect(heartbeat).toMatch(/env\[keySetVariable\('heartbeat'\)\]/);
    expect(heartbeat).not.toMatch(/signingKeyVariable|SERVICE_SIGNING_KEY|loadSigner|signHeartbeat|signToken/);
    expect([...heartbeat.matchAll(/process\.env/g)]).toHaveLength(1);
    expect(heartbeat).toMatch(/const env = options\.env \?\? process\.env;/);
    // It answers no-store, with the one body for every token failure, and prints two fixed sentences and nothing else.
    expect(heartbeat).toMatch(/const headers = \{'cache-control': 'no-store'\};/);
    expect([...heartbeat.matchAll(/console\.error\(([^;]*)\);/g)].map((match) => match[1])).toEqual(["'A heartbeat could not be recorded.'", "'A heartbeat could not be evaluated.'"]);
    // (Four since review patch P3: no token, a token that does not verify, a jti or key ID the database would refuse, and a revoked key.)
    expect([...heartbeat.matchAll(/return invalidToken\(\);/g)]).toHaveLength(4);
    expect(heartbeat).toMatch(/const recordableJti = \/\^\[A-Za-z0-9_-\]\{22\}\$\/;/);
    // The heartbeat is optional in the application, and a deployment does not need it to start.
    const environment = code('lib/environment.ts');
    expect(environment.slice(environment.indexOf('const requiredVariables'), environment.indexOf('const previewForbiddenName'))).not.toMatch(/SERVICE_KEYS_HEARTBEAT|SERVICE_SIGNING_KEY_HEARTBEAT/);
    expect(code('lib/jobs.ts')).toMatch(/isHeartbeatConfigured\(env\)/);
  });

  it('registers exactly the six conditions this story can observe, and none of another story\'s', () => {
    const conditions = code('lib/alarm-conditions.ts');
    expect([...conditions.matchAll(/^\s+id: '([a-z0-9-]+)',$/gm)].map((match) => match[1])).toEqual(['task-late', 'ledger-pending', 'identities-unaccounted', 'heartbeat-stale', 'qstash-stale', 'monitor-late']);
    expect([...conditions.matchAll(/evaluatedBy: '(monitor|heartbeat)',/g)].map((match) => match[1])).toEqual(['monitor', 'monitor', 'monitor', 'monitor', 'heartbeat', 'heartbeat']);
    expect(conditions).toMatch(/export const alarmConditions: readonly AlarmCondition\[\] = \[taskLateCondition, ledgerPendingCondition, identitiesUnaccountedCondition, heartbeatStaleCondition, qstashStaleCondition, monitorLateCondition\];/);
    // F4: two conditions have a precondition and answer `unobservable` without it, and no other does; F3: the monitor is the heartbeat's to watch, and task-late still skips it.
    expect([...conditions.matchAll(/return unobservable;/g)]).toHaveLength(2);
    expect(conditions).toMatch(/if \(relay\?\.outcome === 'no_store'\) return unobservable;/);
    expect(conditions).toMatch(/if \(!observations\.heartbeatConfigured\) return unobservable;/);
    expect(conditions).toMatch(/if \(entry\.task === monitorTask\) continue;/);
    // The thresholds are the story's, written once: twice the interval, 15 minutes, more than 25 identities, two hours.
    expect(conditions).toMatch(/export const lateFactor = 2;/);
    expect(conditions).toMatch(/export const ledgerPendingSeconds = 900;/);
    expect(conditions).toMatch(/export const unaccountedLimit = 25;/);
    expect(conditions).toMatch(/export const schedulerStaleSeconds = 7200;/);
    // A failed run and a damaged relay chain stay deferred: nothing here looks at a `failed` or a `conflict` receipt as a reason to alarm.
    expect(conditions).not.toMatch(/outcome === 'failed'|conflict|corrupt/);
  });

  it('runs the monitor from the scheduler and nowhere else, and gives it no other way in', () => {
    expect(callers('runAlarmMonitor')).toEqual(['lib/alarms.ts', 'lib/job-tasks.ts']);
    expect(callers('runHeartbeatEvaluation')).toEqual(['lib/alarms.ts', 'lib/heartbeat.ts']);
    expect(callers('applyConditions')).toEqual(['lib/alarms.ts']);
    for (const file of sources.filter((candidate) => /^(?:app|components)\//.test(candidate) || candidate === 'proxy.ts')) {
      expect(code(file), file).not.toMatch(/\brunAlarmMonitor\b|\bdispatchDueMail\b|\bapplyConditions\b|\bsendAlarmMail\b/);
    }
  });

  it('closes the three tables and every function: row-level security on, no policy, every privilege revoked, granted to the service role by name and to nobody else', () => {
    for (const table of ['alarms', 'alarm_notices', 'heartbeats']) {
      expect(migration, table).toMatch(new RegExp(`alter table lifecycle\\.${table} enable row level security;`));
      expect(migration, table).toMatch(new RegExp(`revoke all on lifecycle\\.${table} from public, anon, authenticated, service_role;`));
    }
    expect([...migration.matchAll(/create table (lifecycle\.\w+)/g)].map((match) => match[1])).toEqual(['lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats']);
    expect(migration).not.toMatch(/create policy/i);
    const grants = [...migration.matchAll(/^grant .*$/gm)].map((match) => match[0]);
    expect(grants).toEqual([
      'grant execute on function api.raise_alarm(text, text, json) to service_role;',
      'grant execute on function api.resolve_alarm(text, text) to service_role;',
      'grant execute on function api.list_alarms(boolean, integer) to service_role;',
      'grant execute on function api.alarms_due_mail(integer) to service_role;',
      'grant execute on function api.record_alarm_notice(uuid, text) to service_role;',
      'grant execute on function api.alarm_observations() to service_role;',
      'grant execute on function api.record_heartbeat(text, text) to service_role;',
    ]);
    // Every function runs with an empty search_path; the api ones run as their owner, and the lifecycle helpers are granted to nobody.
    for (const match of migration.matchAll(/create (?:or replace )?function ((?:api|lifecycle)\.\w+)\(/g)) {
      const body = functionBody(match[0]);
      expect(body, match[1]).toMatch(/set search_path = ''/);
      if (match[1].startsWith('api.')) expect(body, match[1]).toMatch(/security definer\s+set search_path = ''/);
    }
    expect(migration).not.toMatch(/grant execute on function lifecycle\./);
    // No password, no secret and no literal address anywhere in it.
    expect(migration).not.toMatch(/password|@|secret/i);
  });

  it('writes each table from one place, never deletes an alarm and takes every time from the database clock', () => {
    expect([...migration.matchAll(/insert into lifecycle\.alarms\b/g)]).toHaveLength(1);
    expect(functionBody('create function api.raise_alarm(')).toMatch(/insert into lifecycle\.alarms/);
    expect([...migration.matchAll(/update lifecycle\.alarms\b/g)]).toHaveLength(2);
    expect(functionBody('create function api.raise_alarm(')).toMatch(/update lifecycle\.alarms a set latest_at = greatest\(a\.latest_at, v_now\), detail = p_detail/);
    expect(functionBody('create function api.resolve_alarm(')).toMatch(/update lifecycle\.alarms a\s+set resolved_at = greatest\(a\.latest_at, clock_timestamp\(\)\)/);
    // Two writers of a notice (F1): the claim, written only by api.alarms_due_mail, and the outcome, written only by api.record_alarm_notice, which refuses a claim.
    expect([...migration.matchAll(/insert into lifecycle\.alarm_notices\b/g)]).toHaveLength(2);
    expect(functionBody('create function api.record_alarm_notice(')).toMatch(/insert into lifecycle\.alarm_notices \(alarm_id, outcome\) values \(p_alarm_id, p_outcome\)/);
    expect(functionBody('create function api.record_alarm_notice(')).toMatch(/p_outcome not in \('sent', 'failed', 'unknown'\)/);
    expect(functionBody('create function api.alarms_due_mail(')).toMatch(/insert into lifecycle\.alarm_notices \(alarm_id, outcome\) select i\.id, 'claimed' from unnest\(v_ids\)/);
    expect([...migration.matchAll(/insert into lifecycle\.heartbeats\b/g)]).toHaveLength(1);
    expect(functionBody('create function api.record_heartbeat(')).toMatch(/insert into lifecycle\.heartbeats/);
    expect(migration).not.toMatch(/delete from lifecycle\.(?:alarms|alarm_notices|heartbeats)|truncate lifecycle\.(?:alarms|alarm_notices|heartbeats)/);
    expect(migration).not.toMatch(/\bnow\(\)|current_timestamp|transaction_timestamp|statement_timestamp/i);
    // The partial unique index is what makes the open alarm of a pair one.
    expect(migration).toMatch(/create unique index alarms_one_open on lifecycle\.alarms \(condition, \(coalesce\(subject, ''\)\)\) where resolved_at is null;/);
    // Append-only and immutable by trigger.
    for (const trigger of ['alarms_guard', 'alarms_no_delete', 'alarms_no_truncate', 'alarm_notices_no_change', 'alarm_notices_no_truncate', 'heartbeats_no_change', 'heartbeats_no_truncate']) expect(migration, trigger).toContain(`create trigger ${trigger} `);
    // One advisory lock per (condition, subject), taken before the alarm is read.
    const raise = functionBody('create function api.raise_alarm(');
    expect(raise.indexOf("pg_advisory_xact_lock(hashtextextended('nova3d:alarm:'")).toBeGreaterThan(-1);
    expect(raise.indexOf("pg_advisory_xact_lock(hashtextextended('nova3d:alarm:'")).toBeLessThan(raise.indexOf('from lifecycle.alarms a'));
  });

  it('holds the email rule in one function: the 24 hours, the sent notices and the same-condition rule for an alarm with no subject', () => {
    expect([...migration.matchAll(/interval '24 hours'/g)]).toHaveLength(1);
    const due = functionBody('create function api.alarms_due_mail(');
    expect(due).toMatch(/c_window constant interval := interval '24 hours';/);
    expect(due).toMatch(/n\.alarm_id = a\.id and n\.outcome = 'sent' and n\.at > v_now - c_window/);
    expect(due).toMatch(/a\.subject is not null or not exists/);
    expect(due).toMatch(/b\.condition = a\.condition and n\.outcome = 'sent' and n\.at > v_now - c_window/);
    expect(due).toMatch(/a\.resolved_at is null/);
    // Neither `failed` nor `unknown` is mentioned: they close nothing, and release a claim only by being a LATER notice that is not a claim.
    expect(due).not.toMatch(/'failed'|'unknown'/);
  });

  // F1: the dispatches overlap (the monitor and the heartbeat evaluation both fire at :00), so the function that lists what is due also claims it, under one lock.
  it('claims what it hands out, under one advisory lock taken before anything is read, for 10 minutes, released by a later notice that is not a claim; and is no longer a read-only function', () => {
    const header = (name: string) => { const start = migration.indexOf(name); return migration.slice(start, migration.indexOf('as $$', start)); };
    const due = functionBody('create function api.alarms_due_mail(');
    expect(header('create function api.alarms_due_mail(')).not.toMatch(/\bstable\b|\bimmutable\b/);
    expect(header('create function api.alarms_due_mail(')).toMatch(/security definer\s+set search_path = ''/);
    expect(due).toMatch(/c_hold constant interval := interval '10 minutes';/);
    expect([...migration.matchAll(/interval '10 minutes'/g)]).toHaveLength(1);
    expect(due).toMatch(/perform pg_advisory_xact_lock\(hashtextextended\('nova3d:alarm-mail', 0\)\);/);
    // The lock first, then the clock, then the reading, then the claims, then the answer.
    const order = ["perform pg_advisory_xact_lock(hashtextextended('nova3d:alarm-mail', 0));", 'v_now := clock_timestamp();', 'from lifecycle.alarms a', "insert into lifecycle.alarm_notices (alarm_id, outcome) select i.id, 'claimed'"].map((needle) => {
      expect(due, needle).toContain(needle);
      return due.indexOf(needle);
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // A claim holds its alarm, and for an alarm with no subject every alarm of its condition, unless a LATER notice that is not a claim exists for the claimed alarm.
    expect(due).toMatch(/c\.alarm_id = a\.id and c\.outcome = 'claimed' and c\.at > v_now - c_hold/);
    expect(due).toMatch(/b\.condition = a\.condition and c\.outcome = 'claimed' and c\.at > v_now - c_hold/);
    expect([...due.matchAll(/r\.alarm_id = c\.alarm_id and r\.outcome <> 'claimed' and r\.at > c\.at/g)]).toHaveLength(2);
    // The table knows four outcomes, and the record function accepts three: a caller cannot hold an alarm back.
    expect(migration).toMatch(/check \(outcome in \('claimed', 'sent', 'failed', 'unknown'\)\)/);
    // The page's list reports outcomes, never a claim.
    expect(functionBody('create function api.list_alarms(')).toMatch(/n\.alarm_id = s\.id and n\.outcome <> 'claimed' order by n\.at desc, n\.id desc limit 1/);
    // The dispatch is the one caller of the claim, and it records an outcome for each alarm it was handed.
    expect(code('lib/lifecycle.ts')).toMatch(/export const noticeOutcomes = \['sent', 'failed', 'unknown'\] as const;/);
    expect(code('lib/alarms.ts')).toMatch(/alarmsDueMail\(\{limit: maxDueMail\}, accounts\)/);
  });

  it('changes one existing table, Story 1.9\'s receipts, by one index, and says so in the migration\'s header, in the staging guide\'s migration row and in the ledger (review patch P8)', () => {
    const onExisting = [...migration.matchAll(/^\s*(?:create (?:unique )?index (\w+) on|alter table|drop|create trigger \w+ \w+ \w+ on) (?:lifecycle|identity|projects|artifacts|auth)\.(?!alarms\b|alarm_notices\b|heartbeats\b)(\w+)/gm)].map((match) => `${match[1] ?? 'other'} on ${match[2]}`);
    expect(onExisting).toEqual(['job_receipts_started on job_receipts']);
    expect(migration).toMatch(/create index job_receipts_started on lifecycle\.job_receipts \(started_at\);/);
    const header = read(migrationFile).split('\n').filter((line) => line.startsWith('--')).join('\n');
    expect(header).toMatch(/job_receipts_started\s+ONE INDEX ON AN EXISTING TABLE/);
    expect(read('docs/staging.md')).toMatch(/\| `20261016120000_alarms\.sql` \|[^\n]*`job_receipts_started` on `lifecycle\.job_receipts`/);
    const ledger = JSON.parse(read('provisioning/ledger.json')) as {items: {id: string; howto: string[]}[]};
    expect(ledger.items.find((item) => item.id === 'railway-heartbeat-service')?.howto.join('\n')).toContain('job_receipts_started');
  });

  it('tells the operator what the monitor and the heartbeat now do: a stopped monitor is reported within about 40 minutes, an unobservable condition keeps its alarm open, and the statement that closes one on purpose (F3, F4)', () => {
    const guide = read('docs/staging.md');
    // `monitor-late` is a row of the conditions table, evaluated by the application when a heartbeat arrives, with the time it takes.
    expect(guide).toMatch(/\| `monitor-late` \| none \| the application, when a heartbeat arrives \|[^\n]*within about 40 minutes/);
    // The one statement an operator runs to close the alarm of a condition they removed on purpose, with and without a subject, and when to use it.
    expect(guide).toContain("select * from api.resolve_alarm('<condition>', null)");
    expect(guide).toContain("select * from api.resolve_alarm('<condition>', '<subject>')");
    expect(guide).toMatch(/unobservable[^\n]*stays open|stays open[^\n]*unobservable/);
    expect(guide).toMatch(/Use it only for a condition you have removed on purpose/);
    // The claim: what it holds and for how long, and what the sender's outcomes do with it.
    expect(guide).toMatch(/records a `claimed` notice for each alarm it hands out[^\n]*10 minutes/);
    // The ledger and the README say the same of the monitor.
    const ledger = JSON.parse(read('provisioning/ledger.json')) as {items: {id: string; howto: string[]}[]};
    expect(ledger.items.find((item) => item.id === 'railway-heartbeat-service')?.howto.join('\n')).toMatch(/`monitor-late`[\s\S]*within about 40 minutes/);
    expect(read('README.md')).toMatch(/`qstash-stale` and `monitor-late`/);
    // The heartbeat route's own header names the second condition it evaluates.
    expect(read('lib/heartbeat.ts')).toMatch(/`qstash-stale` and `monitor-late` are evaluated/);
  });

  it('is read only on the Operations page: no Server Action, no form, no control, and the Administrator\'s guard first', () => {
    const page = code('app/admin/operations/page.tsx');
    expect(page).toMatch(/await requireAdministrator\(\);/);
    expect(page).not.toMatch(/'use server'|requireMutationAccess|formData/);
    for (const file of ['components/admin/operations-content.tsx', 'components/admin/alarm-list.tsx']) {
      expect(code(file), file).not.toMatch(/<form|<button|<Button|<input|<select|<textarea|onClick|onSubmit|'use server'|useActionState|\baction=/);
    }
    expect(files('app/admin/operations', (name) => /\.(ts|tsx)$/.test(name))).toEqual(['app/admin/operations/page.tsx']);
  });

  it('keeps the application\'s own times to the database\'s: no module of the alarm path compares a time it read from the application\'s clock with one the database wrote', () => {
    for (const file of ['lib/alarm-conditions.ts', 'lib/alarms.ts', 'lib/operations.ts']) expect(code(file), file).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    // The one clock the heartbeat route reads is for the token's lifetime (seconds since the epoch, injectable), not for an age.
    expect([...code('lib/heartbeat.ts').matchAll(/Date\.now\(\)/g)]).toHaveLength(1);
  });
});

describe('Request revisions (Story 2.1) are created and read through two typed calls, by two Server Actions, for the verified Account, and start nothing', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const code = (file: string) => withoutComments(read(file));
  const actions = 'app/projects/new/actions.ts';
  const migrationFile = 'supabase/migrations/20261018120000_request_revisions.sql';
  const migrationCode = read(migrationFile).replace(/^\s*--.*$/gm, '');
  const functionBody = (name: string) => {
    const start = migrationCode.indexOf(`create function api.${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
  };

  it('creates and reads from lib/projects.ts and the few places that need it: the one Server Action and the page loader', () => {
    expect(callers('createProjectRequest')).toEqual([actions, 'lib/projects.ts']);
    expect(callers('readProjectRequest')).toEqual(['lib/project-pages.ts', 'lib/projects.ts']);
    // The Project typed calls did not move.
    expect(callers('renameProjectCommand')).toEqual(['app/projects/actions.ts', 'lib/projects.ts']);
    expect(callers('readProject')).toEqual(['lib/project-pages.ts', 'lib/project-target.ts', 'lib/projects.ts']);
  });

  it('has no page or component call a typed call or the database, and keeps the database functions behind the typed calls', () => {
    for (const file of sources.filter((candidate) => /^(?:app\/.*page\.tsx|components\/.*)$/.test(candidate))) {
      expect(code(file), file).not.toMatch(/\b(?:createProjectRequest|readProjectRequest|callApi|callRow)\b/);
    }
    for (const file of sources.filter((candidate) => candidate !== 'lib/projects.ts' && candidate !== 'lib/accounts.ts')) {
      expect(code(file), file).not.toMatch(/['"`](?:create_project_request|read_project_request)['"`]/);
    }
    expect(code('lib/projects.ts')).toMatch(/callRow\(\s*'create_project_request'/);
    expect(code('lib/projects.ts')).toMatch(/callRow\('read_project_request'/);
    // callApi and callRow still have the same three users.
    // On purpose changed (Story 2.4): lib/usage.ts is the fourth user of the call helpers, and the only caller of the three Usage functions.
    // On purpose changed (Story 2.11): lib/job-records.ts is the fifth, and the only caller of the six Job functions.
    expect(sources.filter((file) => /\b(?:callApi|callRow)\b/.test(code(file))).sort()).toEqual(['lib/accounts.ts', 'lib/job-records.ts', 'lib/lifecycle.ts', 'lib/projects.ts', 'lib/usage.ts']);
  });

  it('is two Server Actions behind withActiveAccount in their own file, with the Account from the verified access and nothing about it from the form', () => {
    expect(read(actions).trimStart()).toMatch(/^'use server';/);
    expect([...code(actions).matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['understandRequest', 'confirmRequest']);
    expect([...code(actions).matchAll(/^export\s/gm)]).toHaveLength(2);
    expect([...code(actions).matchAll(/return withActiveAccount<(\w+)>\(/g)].map((match) => match[1])).toEqual(['UnderstandState', 'ConfirmState']);
    expect(code(actions)).toMatch(/operationOf\(access\.account\)/);
    const reads = [...code(actions).matchAll(/formData\.get\(['"](\w+)['"]\)/g)].map((match) => match[1]);
    expect(reads).toEqual(['description', 'personalization', 'commandId', 'subjectId', 'description', 'scope', 'outcome', 'personalization']);
    for (const forbidden of [/\baccountId\s*:\s*(?:formData|String\()/, /\bepoch\s*:\s*(?:formData|Number\()/, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\.url\b/, /cookies\(/, /\badministered\b|\bcheckMarker\b/, /formData\.get\(['"](?:mode|title|approved|permission|payment)/]) {
      expect(code(actions)).not.toMatch(forbidden);
    }
    // No route handler and no token: a Server Action is not an API route.
    expect(files('app', (name) => /^route\.(ts|js)$/.test(name)).filter((file) => /project/i.test(file))).toEqual([]);
  });

  it('understands for free (no database call of its own), and confirms only after it has recomputed the request from the submitted fields', () => {
    const body = code(actions);
    const understanding = body.slice(body.indexOf('export async function understandRequest'), body.indexOf('function failed'));
    expect(understanding).not.toMatch(/createProjectRequest|callRow|callApi|fetch\(|operationOf|withinBudget/);
    expect(understanding).toMatch(/understand\(\{description, wording\}, defaultDomainRegistry\)/);
    const confirming = body.slice(body.indexOf('export async function confirmRequest'));
    const enclosing = confirming.indexOf('return withActiveAccount<ConfirmState>(');
    expect(enclosing).toBeGreaterThan(-1);
    const check = confirming.indexOf('checkRequest(');
    const create = confirming.indexOf('createProjectRequest(operationOf');
    expect(check).toBeGreaterThan(enclosing);
    expect(create).toBeGreaterThan(check);
    // The mode is the text request's, whatever the form says; the title is the registry's.
    expect(confirming).toMatch(/mode: 'evidence_text'/);
    expect(confirming).not.toMatch(/title:/);
    // redirect() is called outside the try block (it throws to leave the action).
    const tryAt = confirming.indexOf('try {');
    const catchAt = confirming.indexOf('} catch (error)');
    expect(tryAt).toBeGreaterThan(-1);
    for (const match of confirming.matchAll(/redirect\(/g)) expect(match.index < tryAt || match.index > catchAt, `redirect at ${match.index}`).toBe(true);
  });

  it('prints a failure by name and message only, and never a description, a scope, a wording, a title or an ID', () => {
    for (const file of [actions, 'lib/projects.ts', 'lib/project-pages.ts']) {
      const lines = code(file).split('\n').filter((line) => /console\.(?:log|info|warn|error|debug)\(|\blog\(/.test(line));
      for (const line of lines) {
        expect(line, file).toMatch(/describe\(error\)/);
        expect(line, file).not.toMatch(/title|projectId|accountId|formData|email|description|scope|wording|subject/);
      }
    }
  });

  it('keeps understanding free, pure and the same on the server and in the browser: no run-time import, no process, no I/O, no network, no model', () => {
    // Story 2.3 adds lib/picture-quality.ts on purpose: the shared quality rule is pure, client-safe and reused by Story 7.9.
    const pure = ['lib/request-intake.ts', 'lib/domain-registry.ts', 'packages/contracts/domain-manifest.ts', 'packages/domains/middot/manifest.ts', 'lib/picture-quality.ts'];
    for (const file of pure) {
      const text = code(file);
      expect(text, file).not.toMatch(/\bprocess\b|\bfetch\(|XMLHttpRequest|node:|require\(|await import\(|\bDate\.now\(|Math\.random|crypto\./);
      // Every import is type-only, or (the registry) of the contract and the manifest it registers.
      for (const line of text.split('\n').filter((candidate) => /^\s*import\b/.test(candidate))) {
        if (file === 'lib/domain-registry.ts') expect(line, `${file}: ${line}`).toMatch(/^import (?:type )?\{[^}]*\} from '\.\.\/packages\/(?:contracts\/domain-manifest|domains\/middot\/manifest)\.ts';$/);
        else expect(line, `${file}: ${line}`).toMatch(/^import type\b/);
      }
    }
    for (const file of ['packages/contracts/domain-manifest.ts', 'packages/domains/middot/manifest.ts']) {
      expect(text(file), file).not.toMatch(/^\s*import (?!type\b)/m);
    }
    function text(file: string) {
      return code(file);
    }
    // No model, provider or new secret anywhere in the story's modules.
    for (const file of [...pure, actions, 'lib/request-view.ts', 'components/projects/request-intake.tsx']) {
      expect(code(file), file).not.toMatch(/anthropic|brave|stripe|openai|claude-|SECRET|process\.env/i);
    }
  });

  it('keeps the screens\' modules free of the server-only ones', () => {
    for (const file of ['lib/request-intake.ts', 'lib/request-view.ts', 'lib/domain-registry.ts', 'components/projects/request-intake.tsx', 'components/projects/request-section.tsx', 'components/projects/personalization-summary.tsx']) {
      expect(code(file), file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth|authority|projects|project-pages|project-target)'|node:crypto|next\/headers|next\/cache/);
    }
    // Only the intake screen reaches the two actions.
    expect(callers('confirmRequest')).toEqual([actions, 'components/projects/request-intake.tsx']);
    expect(callers('understandRequest')).toEqual([actions, 'components/projects/request-intake.tsx']);
  });

  it('puts the fixture second subject in the tests only: no production file registers it', () => {
    for (const file of [...sources, 'packages/contracts/domain-manifest.ts', 'packages/domains/middot/manifest.ts']) expect(code(file), file).not.toMatch(/fixture-incense|incense/);
    // The manifest moved to its own file so a test that replaces the default registry can load it; the registry file only builds on it.
    expect(read('tests/support/fixture-manifest.ts')).toContain('fixture-incense-altar');
    expect(read('tests/support/fixture-domains.ts')).toContain("from './fixture-manifest'");
  });

  it('adds no dependency, no environment variable and no secret', () => {
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@aws-sdk/client-s3', '@aws-sdk/lib-storage', '@supabase/ssr', '@supabase/supabase-js', '@upstash/qstash', '@upstash/redis', '@upstash/workflow', 'next', 'pg', 'react', 'react-dom']);
    expect(Object.keys(manifest.devDependencies).sort()).toEqual(['@axe-core/playwright', '@playwright/test', '@tailwindcss/postcss', '@types/node', '@types/pg', '@types/react', '@types/react-dom', 'bmad-method', 'eslint', 'eslint-config-next', 'tailwindcss', 'typescript', 'vite', 'vitest', 'yaml']);
  });

  it('adds one closed table, two functions and four helpers, and changes the Project table by one check', () => {
    expect([...migrationCode.matchAll(/^create table (\S+) \(/gm)].map((match) => match[1])).toEqual(['projects.request_revisions']);
    // On purpose changed from one helper to four with the review patches: the digest's field prefix, the two text checks the table and the command share
    // (a text that draws nothing, a bidirectional control), and the guard that refuses to edit a revision.
    expect([...migrationCode.matchAll(/create (?:or replace )?function ([\w.]+)\(/g)].map((match) => match[1])).toEqual([
      'projects.is_invisible',
      'projects.has_bidi_control',
      'projects.refuse_revision_change',
      'projects.length_prefixed',
      'api.create_project_request',
      'api.read_project_request',
      'api.preflight',
    ]);
    // The existing table: the stage check replaced, nothing else (no column, trigger or index).
    const onProjects = [...migrationCode.matchAll(/^alter table projects\.projects (?:drop|add) constraint (\w+)/gm)].map((match) => match[1]);
    expect(onProjects).toEqual(['projects_stage_check', 'projects_stage_check']);
    expect(migrationCode).toMatch(/stage in \('request_confirmed', 'researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready'\)/);
    expect(migrationCode).not.toMatch(/alter table projects\.projects (?:add|drop) column/);
    // Names no table or column "manifest" (artifacts.manifests is a different thing), and no alarm subject.
    expect(migrationCode).not.toMatch(/\bmanifest\b/i);
  });

  it('has a request revision hold the request and nothing else: no approval, permission, payment, cost or Job column', () => {
    const table = migrationCode.slice(migrationCode.indexOf('create table projects.request_revisions'), migrationCode.indexOf('comment on table projects.request_revisions'));
    const columns = [...table.matchAll(/^  (\w+) (?:uuid|integer|text|boolean|timestamptz)\b/gm)].map((match) => match[1]);
    expect(columns).toEqual([
      'id', 'project_id', 'account_id', 'seq', 'command_id', 'mode', 'subject_id', 'scope', 'outcome', 'description',
      'personalization_wording', 'personalization_text', 'personalization_style', 'personalization_applied', 'personalization_reason', 'digest', 'confirmed_at', 'created_at',
    ]);
    for (const column of columns) expect(column).not.toMatch(/approv|permission|payment|cost|job|reserv|price|charge/i);
  });

  it('begins both functions with the authority check, after their argument checks and before any Project or revision is read or written', () => {
    for (const name of ['create_project_request', 'read_project_request']) {
      const body = functionBody(name);
      const check = body.indexOf('identity.assert_operation_authority(p_account_id, p_epoch)');
      expect(check, `${name} calls the authority check`).toBeGreaterThan(-1);
      expect(check, `${name}: before any table is read`).toBeLessThan(body.search(/from projects\.|update projects\.|insert into projects\./));
      expect(body, name).toMatch(/exception when sqlstate 'N3010' then[\s\S]*?outcome := 'denied'/);
      expect(body, name).toMatch(/security definer\s+set search_path = ''/);
      // The arguments are checked first (22023), as every command of the Spine does.
      expect(body.indexOf("errcode = '22023'"), name).toBeLessThan(check);
    }
    const create = functionBody('create_project_request');
    // The lock is the one api.rename_project takes, so a create and a rename of one command ID are serial; the rename ledger is looked at before the revision's.
    expect(create).toContain("pg_advisory_xact_lock(hashtextextended('project_command:' || p_account_id::text || ':' || p_command_id::text, 0))");
    expect(create.indexOf('identity.assert_operation_authority')).toBeLessThan(create.indexOf('pg_advisory_xact_lock'));
    expect(create.indexOf('pg_advisory_xact_lock')).toBeLessThan(create.indexOf('from projects.project_commands'));
    expect(create.indexOf('from projects.project_commands')).toBeLessThan(create.indexOf('from projects.request_revisions'));
    expect(create.indexOf('from projects.request_revisions')).toBeLessThan(create.indexOf('insert into projects.projects'));
    expect(create.indexOf('insert into projects.projects')).toBeLessThan(create.indexOf('insert into projects.request_revisions'));
    // One Project and one revision 1, in the stage that is true.
    expect(create).toMatch(/'request_confirmed'/);
    expect(create).toMatch(/v_project_id, p_account_id, 1, p_command_id/);
  });

  it('filters every read by the Account in the query itself, and returns a revision of a live, untombstoned Project only', () => {
    const read = functionBody('read_project_request');
    for (const statement of read.match(/from projects\.\w+ \w+[\s\S]*?;/g) ?? []) expect(statement, statement.slice(0, 60)).toMatch(/account_id = p_account_id/);
    expect(read).toMatch(/deleted_at is null/);
    expect(read).toMatch(/not lifecycle\.is_tombstoned\('project', p\.id\)/);
    expect(read).toMatch(/order by r\.seq desc\s+limit 1/);
  });

  it('keeps the status handle out of both functions, and sets deleted_at nowhere', () => {
    for (const name of ['create_project_request', 'read_project_request']) expect(functionBody(name), name).not.toMatch(/status_handle|deleted_at\s*=|set\s+deleted_at/i);
    expect(migrationCode).not.toMatch(/deleted_at\s*=|set\s+deleted_at/i);
  });

  it('closes the table like the others, grants exactly the two functions to the service role, and creates no policy', () => {
    const grants = [...migrationCode.matchAll(/^grant .*$/gm)].map((match) => match[0]);
    expect(grants).toEqual([
      'grant execute on function api.create_project_request(uuid, bigint, uuid, text, text, text, text, text, text, text, text, text, boolean, text) to service_role;',
      'grant execute on function api.read_project_request(uuid, bigint, uuid) to service_role;',
    ]);
    expect(migrationCode).toMatch(/alter table projects\.request_revisions enable row level security/);
    expect(migrationCode).toMatch(/revoke all on projects\.request_revisions from public, anon, authenticated, service_role/);
    expect(migrationCode).not.toMatch(/create policy/i);
    expect(migrationCode).not.toMatch(/grant execute on function (?:projects|identity|lifecycle)\./);
  });

  it('never updates a revision and never truncates the table: a trigger refuses both, and deleting is the purge\'s', () => {
    expect(migrationCode).toMatch(/create trigger request_revisions_no_update before update on projects\.request_revisions/);
    expect(migrationCode).toMatch(/create trigger request_revisions_no_truncate before truncate on projects\.request_revisions/);
    expect(migrationCode).not.toMatch(/(?:update|delete\s+from|truncate(?: table)?)\s+projects\.request_revisions/i);
    expect(migrationCode).toMatch(/foreign key \(project_id, account_id\) references projects\.projects \(id, account_id\) on delete restrict/);
  });

  it('has the preflight carry the new table, the two functions and the privilege to run them, with the bucket check last', () => {
    const preflight = migrationCode.slice(migrationCode.indexOf('create or replace function api.preflight()'));
    expect(preflight).toContain('from projects.request_revisions q limit 1');
    expect(preflight).toContain("the Story 2.1 migration is not applied");
    expect(preflight).toContain("'api.create_project_request(uuid,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,text)'");
    expect(preflight).toContain("'api.read_project_request(uuid,bigint,uuid)'");
    expect(preflight.lastIndexOf('from storage.buckets')).toBeGreaterThan(preflight.lastIndexOf('has_table_privilege'));
    expect(preflight.indexOf('Story 2.1 migration')).toBeGreaterThan(preflight.indexOf('Story 1.13 migration'));
  });

  it('keeps the digest\'s field prefix truly immutable: octet_length, not the stable convert_to', () => {
    const start = migrationCode.indexOf('create function projects.length_prefixed(');
    const body = migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
    expect(body).toMatch(/\bimmutable\b/);
    expect(body).toContain("octet_length(p_value)::text || ':' || p_value");
    expect(body).not.toMatch(/convert_to/);
    // The digest itself is built with convert_to once, over the whole text: that call is not in an immutable function.
    expect(functionBody('create_project_request')).toContain("convert_to(");
  });

  it('refuses text that draws nothing and bidirectional controls in every free-text field, in the table\'s checks and in the command\'s validation, with the same two helpers', () => {
    const table = migrationCode.slice(migrationCode.indexOf('create table projects.request_revisions'), migrationCode.indexOf('comment on table projects.request_revisions'));
    const create = functionBody('create_project_request');
    for (const field of ['scope', 'outcome', 'description', 'personalization_wording', 'personalization_text']) {
      expect(table, `${field}: table check`).toContain(`not projects.is_invisible(${field}) and not projects.has_bidi_control(${field})`);
      const parameter = `p_${field.startsWith('personalization') ? field : field}`;
      expect(create, `${field}: command`).toContain(`projects.is_invisible(${parameter}) or projects.has_bidi_control(${parameter})`);
    }
    // The class is written out once, and neither joiner is refused as such: the bidi class is the nine controls only.
    expect([...migrationCode.matchAll(/\^\[\\u0001-\\u0020/g)]).toHaveLength(1);
    expect(migrationCode).toContain("p_value ~ '[\\u202a-\\u202e\\u2066-\\u2069]'");
    expect(migrationCode).not.toMatch(/has_bidi_control[\s\S]{0,200}u200[cd]/);
  });

  it('says in the migration\'s header what the shared lock does and does not refuse, and that a replay does not outlive its Project', () => {
    const header = read(migrationFile).split('\n').filter((line) => line.startsWith('--')).join('\n');
    expect(header).toContain('a rename that reuses a creation\'s command ID is not refused');
    expect(header).toContain('Only this direction is refused');
    expect(header).toMatch(/`unavailable` once the Project is deleted or tombstoned/);
    const create = functionBody('create_project_request');
    expect(create).toMatch(/v_result\.outcome := 'unavailable';/);
    expect(create.indexOf("v_result.outcome := 'unavailable'")).toBeLessThan(create.indexOf("v_result.outcome := 'replayed'"));
    expect(create).toMatch(/p\.deleted_at is null\s+and not lifecycle\.is_tombstoned\('project', p\.id\)/);
  });

  it('maps the unavailable replay to a message and not to a redirect, and chooses the command ID only when Confirm is pressed', () => {
    const body = code(actions);
    expect(body).toMatch(/case 'unavailable':[\s\S]*?return \{outcome: 'gone'\};/);
    expect(body.slice(body.indexOf("case 'unavailable':"), body.indexOf("default:"))).not.toMatch(/redirect\(/);
    expect(code('lib/projects.ts')).toMatch(/\['created', 'replayed', 'reused', 'unavailable', 'denied'\] as const/);
    const screen = code('components/projects/request-intake.tsx');
    // One call that makes an ID, in the submit handler; nothing keeps an entry for each keystroke.
    expect([...screen.matchAll(/newCommandId\(/g)]).toHaveLength(1);
    expect(screen.indexOf('newCommandId(')).toBeGreaterThan(screen.indexOf('const submitConfirm'));
    expect(screen).not.toMatch(/commandIds|new Map|setCommandIds/);
    expect(screen).toMatch(/lastSent\.current = \{key, id: chosenId\}/);
  });

  it('gives the four text fields their own direction, and truncates nothing', () => {
    const screen = code('components/projects/request-intake.tsx');
    expect([...screen.matchAll(/dir="auto"/g)]).toHaveLength(4);
    expect(screen).not.toMatch(/maxLength/);
  });

  it('reads a Project\'s request as the Project is read: no authority goes Home, unavailable is the unavailable page, only a failed read is an unreadable section', () => {
    const page = code('app/projects/[projectId]/page.tsx');
    expect(page).toMatch(/if \(request\.state === 'denied'\) return redirect\(homePath\);/);
    expect(page).toMatch(/if \(request\.state === 'unavailable'\) return notFound\(\);/);
    expect(page.indexOf("request.state === 'denied'")).toBeGreaterThan(page.indexOf('loadProjectRequest('));
  });

  it('holds the contract and the registry to the review\'s rules: no hole in a list, a package ID and a display name registered once', () => {
    const contract = code('packages/contracts/domain-manifest.ts');
    expect(contract).not.toMatch(/\.forEach\(/);
    expect(contract).toMatch(/export function comparable\(/);
    const registry = code('lib/domain-registry.ts');
    expect(registry).toContain('is already registered');
    expect(registry).toContain('has the same display name as subject');
    expect(read('packages/contracts/domain-manifest.ts')).toContain('tests/unit/domain-manifest.test.ts holds the two equal');
    expect(read('packages/contracts/domain-manifest.ts')).not.toContain('tests/unit/request-intake.test.ts');
  });

  it('writes the contract down for the people who add a subject and a successor revision', () => {
    const packages = read('docs/domain-packages.md');
    for (const needle of ['DomainManifest', 'validateManifest', 'createDomainRegistry', 'middot-altar-ramp', 'G-1', 'not approved', 'fixture-incense-altar', 'import type']) expect(packages, needle).toContain(needle);
    const contract = read('docs/authority-contract.md');
    for (const needle of ['api.create_project_request', 'api.read_project_request', 'projects.request_revisions', 'FOR SHARE', 'FOR UPDATE', 'lifecycle.assert_not_tombstoned', 'exactly one']) expect(contract, needle).toContain(needle);
    expect(read('README.md')).toMatch(/domain-packages\.md/);
    expect(read('README.md')).toMatch(/request_revisions|request revision/i);
  });
});

describe('Picture sets (Story 2.2) are recorded through two typed calls, by two Server Actions, for the verified Account, and no picture passes through the application', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'next.config.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const code = (file: string) => withoutComments(read(file));
  const actions = 'app/projects/new/pictures/actions.ts';
  const screen = 'components/projects/picture-intake.tsx';
  const pictureLibs = ['lib/picture-set.ts', 'lib/picture-upload.ts', 'lib/picture-camera.ts', 'lib/picture-view.ts'];
  const pictureFiles = [...pictureLibs, screen, 'components/projects/pictures-locked.tsx', actions, 'app/projects/new/pictures/page.tsx', 'app/projects/[projectId]/pictures/page.tsx'];
  const migrationFile = 'supabase/migrations/20261019120000_picture_sets.sql';
  const migration = read(migrationFile);
  const migrationCode = migration.replace(/^\s*--.*$/gm, '');
  const functionBody = (name: string) => {
    const start = migrationCode.indexOf(`create function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
  };

  it('finds every file of the story', () => {
    for (const file of [...pictureFiles, migrationFile]) expect(() => read(file), file).not.toThrow();
  });

  it('records and releases from lib/projects.ts and the one actions file, and reaches the actions from the screen alone', () => {
    expect(callers('recordPictureSet')).toEqual([actions, 'lib/projects.ts']);
    expect(callers('releaseStagedPictures')).toEqual([actions, 'lib/projects.ts']);
    expect(callers('savePictureSet')).toEqual([actions, screen]);
    expect(callers('discardPictures')).toEqual([actions, screen]);
    // The Project typed calls did not move.
    expect(callers('createProjectRequest')).toEqual(['app/projects/new/actions.ts', 'lib/projects.ts']);
    expect(callers('readProjectRequest')).toEqual(['lib/project-pages.ts', 'lib/projects.ts']);
  });

  it('keeps the two database functions behind the typed calls, and callApi and callRow with their three users', () => {
    for (const file of sources.filter((candidate) => candidate !== 'lib/projects.ts' && candidate !== 'lib/accounts.ts')) {
      expect(code(file), file).not.toMatch(/['"`](?:record_picture_set|release_staged_pictures)['"`]/);
    }
    expect(code('lib/projects.ts')).toMatch(/callRow\(\s*'record_picture_set'/);
    expect(code('lib/projects.ts')).toMatch(/callRow\('release_staged_pictures'/);
    for (const file of sources.filter((candidate) => /^(?:app\/.*page\.tsx|components\/.*)$/.test(candidate))) {
      expect(code(file), file).not.toMatch(/\b(?:recordPictureSet|releaseStagedPictures|callApi|callRow)\b/);
    }
    // On purpose changed (Story 2.4): lib/usage.ts is the fourth user of the call helpers, and the only caller of the three Usage functions.
    // On purpose changed (Story 2.11): lib/job-records.ts is the fifth, and the only caller of the six Job functions.
    expect(sources.filter((file) => /\b(?:callApi|callRow)\b/.test(code(file))).sort()).toEqual(['lib/accounts.ts', 'lib/job-records.ts', 'lib/lifecycle.ts', 'lib/projects.ts', 'lib/usage.ts']);
  });

  it('is two Server Actions behind withActiveAccount in a file of their own, with the Account from the verified access and only a command, a Project and uploads from the form', () => {
    expect(read(actions).trimStart()).toMatch(/^'use server';/);
    expect([...code(actions).matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['savePictureSet', 'discardPictures']);
    expect([...code(actions).matchAll(/^export\s/gm)]).toHaveLength(2);
    expect([...code(actions).matchAll(/withActiveAccount<(\w+)>\(/g)].map((match) => match[1])).toEqual(['SaveState', 'void']);
    expect([...code(actions).matchAll(/operationOf\(access\.account\)/g)]).toHaveLength(2);
    expect([...code(actions).matchAll(/formData\.(?:get|getAll)\(['"](\w+)['"]\)/g)].map((match) => match[1])).toEqual(['uploadId', 'commandId', 'projectId']);
    for (const forbidden of [/\baccountId\s*:\s*(?:formData|String\()/, /\bepoch\s*:\s*(?:formData|Number\()/, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\.url\b/, /cookies\(/, /formData\.get\(['"](?:mode|title|accountId|epoch|approved|permission|payment)/, /\.arrayBuffer\(|\.stream\(|\.blob\(|\.text\(\)/]) {
      expect(code(actions)).not.toMatch(forbidden);
    }
    // A Server Action is not an API route, and checks no token of its own (Next compares the Origin, the proxy refuses a foreign one).
    expect(code(actions)).not.toMatch(/verifyCsrf|requireMutationAccess|csrfHeaderName/);
    expect(files('app', (name) => /^route\.(ts|js)$/.test(name)).filter((file) => /project|picture/i.test(file))).toEqual([]);
  });

  it('adds no route: the application\'s routes are the ones it had', () => {
    expect(files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name)).sort()).toEqual([
      'app/api/health/route.ts',
      'app/api/heartbeat/route.ts',
      'app/api/jobs/route.ts',
      'app/api/kit/mutation/route.ts',
      'app/api/status/route.ts',
      'app/api/transfers/tickets/route.ts',
      'app/auth/callback/route.ts',
    ]);
  });

  it('takes the title of a new Project from the catalog and the command, Project and uploads from the form, and decides nothing the form says', () => {
    const body = code(actions);
    // The catalog's phrase with the UTC date of the save, and no direction control around it (Story 2.2 review: drafts are told apart in My Projects).
    expect(body).toMatch(/\(await getI18n\(\)\)\.t\('picture\.projectTitle', \{date: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}, \{isolate: false\}\)/);
    expect(body).toMatch(/const title = projectId \? null :/);
    const saving = body.slice(body.indexOf('export async function savePictureSet'), body.indexOf('export async function discardPictures'));
    expect(saving.indexOf('recordPictureSet(operationOf')).toBeGreaterThan(saving.indexOf('uploadIdsOf(formData)'));
    // Every outcome of the typed call has a branch, and an unknown one is never a redirect to a Project.
    for (const outcome of ['created', 'revised', 'replayed', 'unchanged', 'unknown_upload', 'not_ready', 'expired_upload', 'duplicate_image', 'too_large', 'reused', 'not_editable', 'unavailable']) expect(saving, outcome).toContain(`case '${outcome}':`);
    expect(saving).toMatch(/case 'unavailable':[\s\S]*?return \{outcome: 'gone'\};/);
    expect(saving.slice(saving.indexOf("case 'unavailable':"), saving.indexOf('default:'))).not.toMatch(/redirect\(/);
    expect(saving).toMatch(/default:[\s\S]*?return redirect\(homePath\);/);
    expect(code('lib/projects.ts')).toMatch(/const pictureSetOutcomes = \['created', 'revised', 'replayed', 'unchanged', 'unknown_upload', 'not_ready', 'expired_upload', 'duplicate_image', 'too_large', 'reused', 'unavailable', 'not_editable', 'denied'\] as const;/);
  });

  it('prints only the name and message of an error in the actions and the screen\'s modules: never an ID', () => {
    for (const file of pictureFiles) {
      for (const line of code(file).split('\n').filter((candidate) => /console\.(?:log|info|warn|error|debug)\(|\blog\(/.test(candidate))) {
        expect(line, file).toMatch(/describe\(error\)/);
        expect(line, file).not.toMatch(/title|projectId|accountId|formData|email|uploadId|uploadIds|commandId/);
      }
    }
  });

  it('keeps the screen and its libraries free of every server-only module, of Node, and of the environment', () => {
    for (const file of [...pictureLibs, screen, 'components/projects/pictures-locked.tsx', 'components/projects/request-section.tsx']) {
      const source = code(file);
      expect(source, file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth|authority|projects|project-pages|project-target|lifecycle)'|from '\.\/(?:accounts|access|auth|authority|projects)(?:\.ts)?'|node:|next\/headers|next\/cache|\brequire\(/);
      expect(source, file).not.toMatch(/process\.env|\benv\.[A-Z]|FILE_GATEWAY_URL|SERVICE_KEYS_|SERVICE_SIGNING_KEY|SUPABASE|SECRET|INSTANCE_ID|APP_ORIGIN/);
    }
    for (const file of pictureFiles) expect(code(file), file).not.toMatch(/process\.env/);
  });

  it('has the pure set import nothing at run time, and the other libraries import only what is browser-safe', () => {
    const imports = (file: string) => code(file).match(/^import\b.*$/gm) ?? [];
    expect(imports('lib/picture-set.ts')).toEqual([]);
    expect(imports('lib/picture-camera.ts')).toEqual([]);
    expect(imports('lib/picture-upload.ts')).toEqual(["import {csrfFetch} from './csrf-client';", "import type {PictureType, UploadProblem} from './picture-set';"]);
    for (const line of imports('lib/picture-view.ts')) expect(line).toMatch(/from '@\/lib\/(?:administration|i18n|picture-set|request-view)';$/);
  });

  it('sends a picture from the browser to the gateway by one module: the ticket by csrfFetch, the file by XMLHttpRequest, to the address in the ticket', () => {
    // On purpose changed (Story 2.3): the review reads a saved picture back with a download ticket, asked for by csrfFetch in lib/picture-fetch.ts, the one new module.
    expect(callers('csrfFetch')).toEqual(['lib/csrf-client.ts', 'lib/picture-fetch.ts', 'lib/picture-upload.ts']);
    expect(callers('XMLHttpRequest')).toEqual(['lib/picture-upload.ts']);
    expect(callers('v1/uploads')).toEqual(['lib/picture-upload.ts']);
    expect(callers('fetchTicket')).toEqual(['lib/picture-upload.ts']);
    for (const file of pictureFiles) {
      // No fetch of any kind in the screen, the actions or the libraries (the ticket goes through csrfFetch and the file through XMLHttpRequest), and no way to read a staged picture back.
      expect(code(file), file).not.toMatch(/(?<![\w.])fetch\(|\.sendBeacon\(|new WebSocket\(|new EventSource\(/);
      expect(code(file), file).not.toMatch(/<a\b[^>]*\bdownload\b|\bdownload=|createSignedUrl|createSignedUploadUrl|getSignedUrl|presign|\.storage\.from\(|@aws-sdk|\/v1\/files\b|\/d\/|direction: 'download'|\/h\/\$/i);
    }
    // The gateway is the ticket's and nobody's else: the address is never read from the environment, a constant or a request.
    expect(code('lib/picture-upload.ts')).toMatch(/uploadUrl\(input\.gateway, input\.id\)/);
    expect(code('lib/picture-upload.ts')).not.toMatch(/https?:\/\//);
  });

  it('names the CSRF header and cookie nowhere in the picture files, and lets the browser echo the token only through csrfFetch', () => {
    for (const file of pictureFiles) expect(code(file), file).not.toMatch(/x-csrf-token|nova3d-csrf|csrfHeaderName|csrfCookieName|document\.cookie/i);
  });

  it('shows no picture of the server: a preview is the object URL of the file the person chose, made and revoked by the screen', () => {
    const body = code(screen);
    expect([...body.matchAll(/URL\.createObjectURL\(/g)]).toHaveLength(1);
    expect(body).toMatch(/URL\.revokeObjectURL\(/);
    expect([...body.matchAll(/<img\b/g)]).toHaveLength(1);
    expect(body).toMatch(/<img src=\{item\.previewUrl\} alt=/);
    for (const file of ['components/projects/request-section.tsx', 'components/projects/project-overview.tsx', 'components/projects/pictures-locked.tsx', 'app/projects/[projectId]/pictures/page.tsx', 'app/projects/new/pictures/page.tsx']) {
      expect(code(file), file).not.toMatch(/<img\b|<video|<canvas|\bsrc=/);
    }
    // ... and nothing sets a drag-and-drop handler: order is changed with buttons.
    expect(body).not.toMatch(/draggable|onDrag|onDrop|dataTransfer/);
  });

  it('asks for the camera in one place, when Take photo is pressed, and records nothing about it', () => {
    expect(callers('getUserMedia')).toEqual(['lib/picture-camera.ts']);
    expect(callers('openCamera')).toEqual([screen, 'lib/picture-camera.ts']);
    const body = code(screen);
    // openCamera is called in the handler of the button, and in no effect.
    expect([...body.matchAll(/openCamera\(/g)]).toHaveLength(1);
    expect(body.slice(body.indexOf('const takePhoto')).indexOf('openCamera(')).toBeGreaterThan(-1);
    expect(body).toMatch(/onClick=\{takePhoto\}/);
    expect(code('lib/picture-camera.ts')).not.toMatch(/localStorage|sessionStorage|indexedDB|permissions\.query|console\./);
  });

  it('shows a preview the way the review asked: the whole picture in a fixed frame, decoded without blocking and loaded when near (review patch B10)', () => {
    expect(code(screen)).toMatch(/<img src=\{item\.previewUrl\} alt=\{.+?\} decoding="async" loading="lazy"\/>/);
    const css = read('app/globals.css');
    expect(css).toMatch(/\.picture-thumb img \{[^}]*object-fit: contain;/);
    expect(css).not.toMatch(/\.picture-thumb img \{[^}]*object-fit: cover/);
    expect(css).toMatch(/\.picture-thumb \{[^}]*inline-size: [\d.]+rem; block-size: [\d.]+rem;/);
    // The reason a saved picture has no preview is text on the screen, not a title attribute.
    expect(code(screen)).toMatch(/<p className="picture-nopreview project-muted">\{t\('picture\.item\.noPreview'\)\}<\/p>/);
    expect(code(screen)).not.toMatch(/\btitle=\{t\('picture\.item\.noPreview'\)\}/);
  });

  it('starts no queued upload or hashing once the screen has gone, and gives back what it staged and never saved when it goes (review patches B1, B11)', () => {
    const body = code(screen);
    expect(body).toMatch(/const send = async \(key: string\) => \{\s*if \(!mounted\.current\) return;/);
    expect(body).toMatch(/hashQueue\.current\.run\(async \(\) => \{\s*if \(!mounted\.current\) return;/);
    // On unmount and on pagehide the uploads that are ready, unsaved and not in the Save that was sent are released; the tab asks before it closes with unsaved pictures.
    expect(body).toMatch(/window\.addEventListener\('beforeunload', ask\)/);
    expect(body).toMatch(/window\.addEventListener\('pagehide', leave\)/);
    expect(body).toMatch(/window\.removeEventListener\('beforeunload', ask\)/);
    expect(body).toMatch(/window\.removeEventListener\('pagehide', leave\)/);
    expect(body).toMatch(/return \(\) => \{[^]*?leave\(\);\s*mounted\.current = false;/);
    expect(body).toMatch(/unsavedUploadIds\(\[\.\.\.setRef\.current, \.\.\.held\.current\.values\(\)\], submitted\.current\)/);
    expect(code('lib/picture-set.ts')).toMatch(/export function unsavedUploadIds\(items: readonly PictureItem\[\], submitted: readonly string\[\]\): string\[\]/);
    expect(body).toMatch(/if \(saving\.current\) return;\s*const unsaved/);
    // What the release takes at most is 12 at a time, and it is asked through the silent wrapper.
    expect(body).toMatch(/attemptDiscard\(discardPictures, uploadIds\.slice\(from, from \+ maxPictures\)\)/);
    // The word on the comment of `discardable` says what it does: best effort.
    expect(read('lib/picture-set.ts')).toMatch(/best effort[^]*?lapses on its own, 24 hours after its last activity/);
  });

  it('freezes the set while a Save is out, and reads an answer against the uploads that were submitted, by one pure rule (review patches B2, B3)', () => {
    const body = code(screen);
    expect(body).toMatch(/const locked = initial\.locked \?\? savePending;/);
    expect(body).toMatch(/formData\.getAll\('uploadId'\)/);
    expect(body).toMatch(/settleSave\(result, sent, setRef\.current\)/);
    expect(body).not.toMatch(/setRef\.current\[result\.position/);
    for (const guard of ['addChosen', 'remove', 'move', 'replace']) expect(body, guard).toMatch(new RegExp(`const ${guard} = [^]*?saving\\.current`));
    expect(code('lib/picture-view.ts')).toMatch(/export function settleSave\(answer: SaveAnswer, submitted: readonly string\[\], set: PictureSet\)/);
    // A reused or vanished command is forgotten by the screen's wrapper, from the pure rule's word.
    expect(body).toMatch(/if \(settled\.forgetCommand\) \{[^}]*forgetCommandId\([^}]*lastSent\.current = null;/);
  });

  it('keeps a replaced picture aside until its replacement is settled, and rehashes a file the gateway found changed (review patches B4, B5)', () => {
    const body = code(screen);
    expect(body).toMatch(/settleHash\(setRef\.current, key, outcome, original\)/);
    expect(body).toMatch(/held\.current\.set\(result\.added\.key, result\.replaced\)/);
    expect(body).toMatch(/if \(original\) letGo\(original\);/);
    expect(body).toMatch(/commit\(retryItem\(setRef\.current, key\)\)/);
    expect(code('lib/picture-set.ts')).toMatch(/\.\.\.\(item\.problem === 'changed' \? \{sha256: null\} : \{\}\)/);
  });

  it('hardens the camera: one frame at a time, a dropped frame when the camera was closed meanwhile, tracks watched, and a throw is no picture (review patch B6)', () => {
    const body = code(screen);
    expect(body).toMatch(/if \(!video \|\| capturing\.current\) return;/);
    expect(body).toMatch(/const run = cameraRun\.current;[^]*?await captureFrame\(video\);[^]*?run !== cameraRun\.current\) return;/);
    expect(body).toMatch(/watchTracks\(result\.stream,/);
    expect(body).toMatch(/if \(result\.ok\) stopStream\(result\.stream\);/);
    const camera = code('lib/picture-camera.ts');
    expect(camera).toMatch(/try \{[^]*?canvas\.toBlob[^]*?\} catch \{\s*return null;/);
    expect(camera).toMatch(/width: \{ideal: 1920\}, height: \{ideal: 1080\}/);
    expect(camera).not.toMatch(/\bexact\b/);
  });

  it('cleans a file\'s name before a message says it, writes sizes with the limit in mind, and names a move for a screen reader in one phrase (review patches B8, B9, C5)', () => {
    const body = code(screen);
    expect([...body.matchAll(/displayName\(file\.name\)/g)].length).toBeGreaterThanOrEqual(1);
    expect(code('lib/picture-set.ts')).toMatch(/name: displayName\(file\.name\)/);
    expect(code('lib/picture-set.ts')).toMatch(/const name = item\.file \? displayName\(item\.file\.name\) : null/);
    expect(body).toMatch(/formatBytes\(counted\.bytes, maxSetBytes\)/);
    expect(body).toMatch(/moving\('picture\.item\.earlier', 'picture\.item\.earlierNamed'\)/);
    expect(body).toMatch(/moving\('picture\.item\.later', 'picture\.item\.laterNamed'\)/);
    expect(body).toMatch(/<span aria-hidden="true">\{t\(key\)\}<\/span>\s*<span className="visually-hidden">\{t\(spoken, \{position\}\)\}<\/span>/);
    // The formats are three placeholders: the screen never writes the names into a message as one string.
    expect(body).not.toMatch(/acceptedFormats|formats:/);
    expect(body).toMatch(/\.\.\.formatParams/);
  });

  it('changes no header policy and no setting: no Content-Security-Policy or Permissions-Policy in the application', () => {
    for (const file of sources) expect(code(file), file).not.toMatch(/content-security-policy|permissions-policy|feature-policy|Permissions-Policy/i);
    expect(read('vercel.json')).not.toMatch(/content-security-policy|permissions-policy|headers/i);
  });

  it('adds no dependency', () => {
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@aws-sdk/client-s3', '@aws-sdk/lib-storage', '@supabase/ssr', '@supabase/supabase-js', '@upstash/qstash', '@upstash/redis', '@upstash/workflow', 'next', 'pg', 'react', 'react-dom']);
    expect(Object.keys(manifest.devDependencies).sort()).toEqual(['@axe-core/playwright', '@playwright/test', '@tailwindcss/postcss', '@types/node', '@types/pg', '@types/react', '@types/react-dom', 'bmad-method', 'eslint', 'eslint-config-next', 'tailwindcss', 'typescript', 'vite', 'vitest', 'yaml']);
  });

  it('still reads the signing variables and the gateway\'s address in the four files that read them, and the picture code reads none', () => {
    const readers = sources.filter((file) => /SERVICE_SIGNING_KEY_|SERVICE_KEYS_|FILE_GATEWAY_URL|signingKeyVariable|keySetVariable/.test(code(file))).sort();
    expect(readers).toEqual(['lib/environment.ts', 'lib/gateway-client.ts', 'lib/heartbeat.ts', 'lib/service-signing.ts']);
  });

  it('keeps the word the Spine reserves for Story 1.8 out of the application code outside the three modules that name it', () => {
    expect(sources.filter((file) => /tombstone/i.test(code(file))).sort()).toEqual(['lib/accounts.ts', 'lib/authority.ts', 'lib/lifecycle.ts']);
  });

  it('adds one closed table, three helpers, two functions, two types, and widens two checks, in a migration that creates no role, secret or policy', () => {
    expect([...migrationCode.matchAll(/^create table (\S+) \(/gm)].map((match) => match[1])).toEqual(['projects.request_images']);
    expect([...migrationCode.matchAll(/create (?:or replace )?function ([\w.]+)\(/g)].map((match) => match[1])).toEqual([
      'projects.check_revision_seq',
      'projects.refuse_image_change',
      'projects.picture_set_digest',
      'api.record_picture_set',
      'api.release_staged_pictures',
      'api.read_project_request',
      'api.rename_project',
      'api.preflight',
    ]);
    expect([...migrationCode.matchAll(/^create type (\S+) as/gm)].map((match) => match[1])).toEqual(['api.picture_set_recording', 'api.picture_release', 'api.project_request_view']);
    expect(migrationCode).toMatch(/revoke all on projects\.request_images from public, anon, authenticated, service_role;/);
    expect(migrationCode).toMatch(/alter table projects\.request_images enable row level security;/);
    expect(migrationCode).not.toMatch(/create policy|create role|alter role|password|create extension|create schema/i);
    // The grants are the two new functions and the read function that was dropped with its type: nothing to anyone else.
    const grants = [...migrationCode.matchAll(/^grant .*$/gm)].map((match) => match[0]);
    expect(grants).toEqual([
      'grant execute on function api.record_picture_set(uuid, bigint, uuid, uuid, text, uuid[]) to service_role;',
      'grant execute on function api.release_staged_pictures(uuid, bigint, uuid[]) to service_role;',
      'grant execute on function api.read_project_request(uuid, bigint, uuid) to service_role;',
    ]);
    // Projects and their revisions change only where the story says: the stage check, the four nullable columns, three checks, a key and a trigger.
    expect([...migrationCode.matchAll(/^alter table projects\.projects (?:drop|add) constraint (\w+)/gm)].map((match) => match[1])).toEqual(['projects_stage_check', 'projects_stage_check']);
    expect(migrationCode).toMatch(/stage in \('request_draft', 'request_confirmed', 'researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready'\)/);
    expect([...migrationCode.matchAll(/^alter table projects\.request_revisions alter column (\w+) drop not null;/gm)].map((match) => match[1])).toEqual(['confirmed_at', 'description', 'scope', 'outcome']);
    expect([...migrationCode.matchAll(/^alter table projects\.request_revisions add constraint (\w+)/gm)].map((match) => match[1])).toEqual([
      'request_revisions_confirmed_shape',
      'request_revisions_text_confirmed',
      'request_revisions_unconfirmed_shape',
      'request_revisions_id_project_key',
    ]);
    expect(migrationCode).toMatch(/create trigger request_revisions_seq before insert on projects\.request_revisions/);
    expect(migrationCode).not.toMatch(/alter table projects\.projects (?:add|drop) column/);
  });

  it('names the pictures\' columns as the story says, and avoids the names the Spine keeps for other stories', () => {
    const table = migrationCode.slice(migrationCode.indexOf('create table projects.request_images ('), migrationCode.indexOf(');', migrationCode.indexOf('create table projects.request_images (')));
    const columns = [...table.matchAll(/^  (\w+) (?:uuid|integer|text|bigint)\b/gm)].map((match) => match[1]);
    expect(columns).toEqual(['revision_id', 'project_id', 'account_id', 'position', 'upload_id', 'sha256', 'length', 'content_type']);
    expect(table).toMatch(/primary key \(revision_id, position\)/);
    expect(table).toMatch(/unique \(revision_id, upload_id\)/);
    expect(table.match(/on delete restrict/g)).toHaveLength(2);
    for (const name of ['record_picture_set', 'release_staged_pictures', 'picture_set_digest', 'check_revision_seq', 'refuse_image_change']) {
      const body = migrationCode.slice(migrationCode.indexOf(name), migrationCode.indexOf('$$;', migrationCode.indexOf(name)));
      expect(body, name).not.toMatch(/\b(?:manifest|retained|pin|ordinal\w*)\b|\bdigest\b.*\bimage|status_handle/i);
    }
    expect(table).not.toMatch(/\bdigest\b|manifest|retained|\bpin\b|ordinal/i);
  });

  it('begins the writer with the authority check, after its argument checks and before any table is read, under the lock rename and create take', () => {
    const body = functionBody('api.record_picture_set');
    const check = body.indexOf('identity.assert_operation_authority(p_account_id, p_epoch)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.search(/from projects\.|from artifacts\.|update projects\.|insert into projects\./));
    expect(body).toMatch(/exception when sqlstate 'N3010' then[\s\S]*?outcome := 'denied'/);
    expect(body).toMatch(/security definer\s+set search_path = ''/);
    expect(body.indexOf("errcode = '22023'")).toBeLessThan(check);
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended('project_command:' || p_account_id::text || ':' || p_command_id::text, 0))");
    expect(check).toBeLessThan(body.indexOf('pg_advisory_xact_lock'));
    // The order of the story: a rename's command, then the revision as the receipt, then the Project row, then the leases, then the size, then "unchanged", then the write.
    const order = ['from projects.project_commands', "outcome := 'replayed'", 'for update', "outcome := 'not_editable'", "outcome := 'unknown_upload'", "outcome := 'not_ready'", "outcome := 'expired_upload'", "outcome := 'too_large'", "outcome := 'unchanged'", "'request_draft'"];
    const positions = order.map((needle) => body.indexOf(needle));
    for (const [index, position] of positions.entries()) expect(position, order[index]).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('holds the Project row, refuses a tombstone, raises the Project by exactly one, renews within the bound, and releases what left the set', () => {
    const body = functionBody('api.record_picture_set');
    expect(body).toMatch(/where p\.id = p_project_id and p\.account_id = p_account_id and p\.deleted_at is null\s+for update/);
    expect(body).toContain("lifecycle.is_tombstoned('project', p_project_id)");
    expect(body).toMatch(/update projects\.projects p set revision = p\.revision \+ 1, updated_at = v_now where p\.id = p_project_id/);
    expect(body).toMatch(/set expires_at = least\(clock_timestamp\(\) \+ interval '24 hours', l\.created_at \+ interval '7 days'\)/);
    expect(body).toMatch(/set state = 'released'/);
    expect(body).toContain('62914560');
    expect(body).toContain("'evidence_images'");
    // The lengths, digests and types are the leases', never the caller's: the function has no parameter for any of them.
    expect(body.slice(0, body.indexOf(')\nreturns'))).not.toMatch(/p_(?:sha|length|content|digest|size)/);
    // The release is bounded by what no other Project's latest revision still uses.
    expect(body).toMatch(/orv\.seq = \(select max\(x\.seq\) from projects\.request_revisions x where x\.project_id = orv\.project_id\)/);
  });

  it('releases only the Account\'s own picture uploads that no revision uses, and writes nothing else', () => {
    const body = functionBody('api.release_staged_pictures');
    expect(body).toMatch(/l\.account_id = p_account_id and l\.kind = 'picture' and l\.state in \('receiving', 'complete'\)/);
    expect(body).toMatch(/not exists \(select 1 from projects\.request_images i where i\.upload_id = l\.id\)/);
    expect(body).toMatch(/set state = 'released'/);
    expect(body).not.toMatch(/insert into|delete from|expires_at/);
    expect(body.indexOf('identity.assert_operation_authority')).toBeLessThan(body.indexOf('update artifacts.staging_leases'));
  });

  it('closes the command-ID lock in both directions: rename refuses a command a revision used, after it has locked the Project row', () => {
    const rename = migrationCode.slice(migrationCode.indexOf('create or replace function api.rename_project('), migrationCode.indexOf('$$;', migrationCode.indexOf('create or replace function api.rename_project(')));
    expect(rename).toMatch(/exists \(select 1 from projects\.request_revisions r where r\.account_id = p_account_id and r\.command_id = p_command_id\) then\s+v_result\.outcome := 'reused';/);
    expect(rename.indexOf('for update')).toBeLessThan(rename.indexOf('from projects.request_revisions'));
    expect(rename.indexOf('from projects.request_revisions')).toBeLessThan(rename.indexOf('from projects.project_commands c'));
    // The create function of Story 2.1 is not edited.
    expect(read('supabase/migrations/20261018120000_request_revisions.sql')).toContain("v_result.outcome := 'reused';");
  });

  it('answers the pictures of the latest revision without a key, an address or a download', () => {
    const read_ = migrationCode.slice(migrationCode.indexOf('create function api.read_project_request('), migrationCode.indexOf('$$;', migrationCode.indexOf('create function api.read_project_request(')));
    expect(read_).toContain("'available', coalesce(l.state = 'complete' and l.expires_at > clock_timestamp(), false)");
    expect(read_).not.toMatch(/storage|bucket|\burls?\b|ticket|handle|signed|download/i);
    const view = migrationCode.slice(migrationCode.indexOf('create type api.project_request_view as ('), migrationCode.indexOf(');', migrationCode.indexOf('create type api.project_request_view as (')));
    const columns = [...view.matchAll(/^  (\w+) \w+/gm)].map((match) => match[1]);
    expect(columns.slice(-2)).toEqual(['confirmed', 'images']);
    for (const column of columns) expect(column).not.toMatch(/manifest|job|cost|price|payment|url|key|ticket|handle/i);
  });

  it('writes the story down: the writer, the lease bound, the release rules, the origin the gateway allows, and the README', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['Saving pictures', 'api.record_picture_set', 'api.release_staged_pictures', 'projects.request_images', 'request_draft', 'check_revision_seq', '24 hours', '7 days', 'evidence_images', 'FOR UPDATE', 'exactly one', 'released']) expect(contract, needle).toContain(needle);
    const guide = read('docs/staging.md');
    for (const needle of ['20261019120000_picture_sets.sql', 'request_draft', 'APP_ORIGIN', 'localhost']) expect(guide, needle).toContain(needle);
    expect(guide).toMatch(/gateway's `APP_ORIGIN` must equal the application's own origin/);
    const readme = read('README.md');
    for (const needle of ['Story 2.2', 'picture_sets', 'request_images', 'recordPictureSet', 'savePictureSet', 'discardPictures', 'request_draft', 'picture-intake']) expect(readme, needle).toContain(needle);
  });
});

describe('Picture review (Story 2.3) is recorded through one typed call, by one Server Action, for the verified Account; the browser measures, and the pixels go nowhere', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'next.config.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const code = (file: string) => withoutComments(read(file));
  const actions = 'app/projects/[projectId]/pictures/review/actions.ts';
  const screen = 'components/projects/picture-review.tsx';
  const page = 'app/projects/[projectId]/pictures/review/page.tsx';
  const qualityLibs = ['lib/picture-quality.ts', 'lib/picture-decode.ts', 'lib/picture-fetch.ts', 'lib/picture-review.ts'];
  const reviewFiles = [...qualityLibs, screen, actions, page];
  const migrationFile = 'supabase/migrations/20261020120000_picture_review.sql';
  const migration = read(migrationFile);
  const migrationCode = migration.replace(/^\s*--.*$/gm, '');
  const functionBody = (name: string) => {
    const start = migrationCode.indexOf(`create function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return migrationCode.slice(start, migrationCode.indexOf('$$;', migrationCode.indexOf('$$', start) + 2));
  };

  it('finds every file of the story', () => {
    for (const file of [...reviewFiles, migrationFile, 'docs/picture-quality.md', 'tests/support/pixels.ts']) expect(() => read(file), file).not.toThrow();
  });

  it('records from lib/projects.ts and the one actions file, and reaches the action from the screen alone', () => {
    expect(callers('recordPictureReview')).toEqual([actions, screen, 'lib/projects.ts'].sort());
    expect(code('lib/projects.ts')).toMatch(/callRow\(\s*'record_picture_review'/);
    for (const file of sources.filter((candidate) => candidate !== 'lib/projects.ts' && candidate !== 'lib/accounts.ts')) {
      expect(code(file), file).not.toMatch(/['"`]record_picture_review['"`]/);
    }
    for (const file of sources.filter((candidate) => /^(?:app\/.*page\.tsx|components\/.*)$/.test(candidate))) {
      expect(code(file), file).not.toMatch(/\b(?:callApi|callRow)\b/);
    }
    // On purpose changed (Story 2.4): lib/usage.ts is the fourth user of the call helpers, and the only caller of the three Usage functions.
    // On purpose changed (Story 2.11): lib/job-records.ts is the fifth, and the only caller of the six Job functions.
    expect(sources.filter((file) => /\b(?:callApi|callRow)\b/.test(code(file))).sort()).toEqual(['lib/accounts.ts', 'lib/job-records.ts', 'lib/lifecycle.ts', 'lib/projects.ts', 'lib/usage.ts']);
    // The Project typed calls did not move.
    expect(callers('recordPictureSet')).toEqual(['app/projects/new/pictures/actions.ts', 'lib/projects.ts']);
    expect(callers('readProjectRequest')).toEqual(['lib/project-pages.ts', 'lib/projects.ts']);
  });

  it('is one Server Action behind withActiveAccount in a file of its own, with the Account from the verified access and only a command, a Project, the revision, the choice and the review from the form', () => {
    expect(read(actions).trimStart()).toMatch(/^'use server';/);
    // On purpose changed (Story 2.12): the file holds a second Server Action, `retainPictures`, which keeps the pictures BEFORE this one records the review.
    expect([...code(actions).matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['retainPictures', 'recordPictureReview']);
    expect([...code(actions).matchAll(/^export\s/gm)]).toHaveLength(2);
    expect([...code(actions).matchAll(/withActiveAccount<(\w+)>\(/g)].map((match) => match[1])).toEqual(['RetainState', 'ReviewState']);
    expect([...code(actions).matchAll(/operationOf\(access\.account\)/g)]).toHaveLength(2);
    expect([...code(actions).matchAll(/formData\.(?:get|getAll)\(['"](\w+)['"]\)/g)].map((match) => match[1])).toEqual([
      'uploadId', 'label', 'shortEdge', 'blur', 'clipped', 'uploadId', 'projectId', 'expectedSeq', 'commandId', 'projectId', 'expectedSeq', 'mode', 'scope', 'outcome', 'obstruction', 'acknowledge',
    ]);
    for (const forbidden of [/\baccountId\s*:\s*(?:formData|String\()/, /\bepoch\s*:\s*(?:formData|Number\()/, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\.url\b/, /cookies\(/, /formData\.get\(['"](?:title|accountId|epoch|approved|permission|payment|ok|pass|passed|fail|failed|verdict|incomplete|complete|digest|sha256|length|contentType|stage|subject)/, /\.arrayBuffer\(|\.stream\(|\.blob\(|\.text\(\)/]) {
      expect(code(actions)).not.toMatch(forbidden);
    }
    // A Server Action is not an API route, and checks no token of its own.
    expect(code(actions)).not.toMatch(/verifyCsrf|requireMutationAccess|csrfHeaderName/);
    expect(files('app', (name) => /^route\.(ts|js)$/.test(name)).filter((file) => /project|picture|review/i.test(file))).toEqual([]);
  });

  it('recomputes nothing the database recomputes: the action holds no rule of the quality module and trusts no verdict', () => {
    const body = code(actions);
    expect(body).not.toMatch(/\b(?:assess|incomplete|coverage|analyze|incompleteFacts|itemsIncomplete|thresholds)\b/);
    // The only import from the quality family is the label check and the form reader.
    expect(body.match(/^import .*$/gm)?.filter((line) => /picture-(?:quality|review)/.test(line))).toEqual([
      "import {measurementsFromFields} from '@/lib/picture-review';",
      "import {isViewLabel} from '@/lib/picture-quality';",
    ]);
  });

  it('has a branch for every outcome of the typed call, and an unknown one is never a redirect to a Project', () => {
    // On purpose changed (Story 2.12): the file holds the retain action first; the review writer's branches are those of the second action.
    const whole = code(actions);
    const body = whole.slice(whole.indexOf('export async function recordPictureReview'));
    for (const outcome of ['created', 'replayed', 'unchanged', 'stale', 'unknown_upload', 'not_ready', 'expired_upload', 'not_retained', 'obstruction_not_confirmed', 'acknowledgment_required', 'reused', 'not_editable', 'unavailable']) expect(body, outcome).toContain(`case '${outcome}':`);
    expect(body).toMatch(/case 'unavailable':[\s\S]*?return \{outcome: 'gone'\};/);
    expect(body.slice(body.indexOf("case 'unavailable':"), body.indexOf('default:'))).not.toMatch(/redirect\(/);
    expect(body).toMatch(/default:[\s\S]*?return redirect\(homePath\);/);
    // On purpose changed (review patch A2): an identical re-confirmation is `unchanged`, and it goes to the Project like a created or replayed review.
    expect(body).toMatch(/case 'created':\s*case 'replayed':\s*case 'unchanged':[^]*?return redirect\(projectPath\(receipt\.projectId\)\);/);
    expect(code('lib/projects.ts')).toMatch(/const pictureReviewOutcomes = \[\s*'created', 'replayed', 'unchanged', 'stale', 'unknown_upload', 'not_ready', 'expired_upload', 'not_retained', 'obstruction_not_confirmed', 'acknowledgment_required', 'reused', 'unavailable', 'not_editable', 'denied',\s*\] as const;/);
    // The outcome is read after the call and the redirect is outside the try that decides whether the call may have happened.
    const tryAt = body.indexOf('try {');
    const catchAt = body.indexOf('} catch (error) {');
    for (const match of body.matchAll(/redirect\(/g)) expect(match.index < tryAt || match.index > catchAt, `redirect at ${match.index}`).toBe(true);
  });

  it('prints only the name and message of an error in the action and the screen\'s modules: never an ID', () => {
    for (const file of reviewFiles) {
      for (const line of code(file).split('\n').filter((candidate) => /console\.(?:log|info|warn|error|debug)\(|\blog\(/.test(candidate))) {
        expect(line, file).toMatch(/describe\(error\)/);
        expect(line, file).not.toMatch(/title|projectId|accountId|formData|email|uploadId|uploadIds|commandId/);
      }
    }
    for (const file of ['lib/picture-quality.ts', 'lib/picture-decode.ts', 'lib/picture-fetch.ts', 'lib/picture-review.ts', screen]) expect(code(file), file).not.toMatch(/console\./);
  });

  it('keeps the screen and its libraries free of every server-only module, of Node, and of the environment', () => {
    for (const file of [...qualityLibs, screen]) {
      const source = code(file);
      expect(source, file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth|authority|projects|project-pages|project-target|lifecycle)'|from '\.\/(?:accounts|access|auth|authority|projects)(?:\.ts)?'|node:|next\/headers|next\/cache|\brequire\(/);
      expect(source, file).not.toMatch(/process\.env|\benv\.[A-Z]|FILE_GATEWAY_URL|SERVICE_KEYS_|SERVICE_SIGNING_KEY|SUPABASE|SECRET|INSTANCE_ID|APP_ORIGIN/);
    }
    for (const file of reviewFiles) expect(code(file), file).not.toMatch(/process\.env/);
  });

  it('keeps the quality rule pure and the other modules to what is browser-safe', () => {
    const imports = (file: string) => code(file).match(/^import\b.*$/gm) ?? [];
    expect(imports('lib/picture-quality.ts')).toEqual([]);
    expect(imports('lib/picture-decode.ts')).toEqual(["import {analyze, copySize, imageDimensions, overPixelCap, type Measurements, type Pixels} from './picture-quality.ts';"]);
    // On purpose changed (review patch B4): the download address is made from the ticket's own gateway, so `uploadUrl` is no longer imported.
    expect(imports('lib/picture-fetch.ts')).toEqual([
      "import {csrfFetch} from './csrf-client.ts';",
      "import {maxPictureBytes, maxPictures} from './picture-set.ts';",
      "import {sha256Hex, type UploadDeps} from './picture-upload.ts';",
    ]);
    for (const line of imports('lib/picture-review.ts')) expect(line).toMatch(/^import (?:type )?\{[^}]*\} from '\.\/(?:i18n\/index|picture-fetch|picture-quality|picture-set)\.ts';$/);
    // lib/picture-view.ts still imports what it did: the review adds no import to it.
    for (const line of imports('lib/picture-view.ts')) expect(line).toMatch(/from '@\/lib\/(?:administration|i18n|picture-set|request-view)';$/);
    // lib/picture-set.ts and lib/picture-camera.ts are untouched in what they import.
    expect(imports('lib/picture-set.ts')).toEqual([]);
    expect(imports('lib/picture-camera.ts')).toEqual([]);
  });

  it('reads a staged picture back in ONE module, in the browser: a download ticket by csrfFetch, the file by fetch with the ticket in a header, to the gateway the ticket names', () => {
    // On purpose changed (Story 2.3): the first story that downloads staged bytes allows it in lib/picture-fetch.ts alone. The Story 2.2 files keep their ban.
    const family = sources.filter((file) => /^(?:lib\/picture-|components\/projects\/|app\/projects\/)/.test(file));
    expect(family.filter((file) => /direction: 'download'/.test(code(file)))).toEqual(['lib/picture-fetch.ts']);
    expect(family.filter((file) => /\/v1\/files\b/.test(code(file)))).toEqual(['lib/picture-fetch.ts']);
    expect(family.filter((file) => /\bfetchDownloadTicket\b/.test(code(file)))).toEqual(['lib/picture-fetch.ts']);
    expect(family.filter((file) => /(?<![\w.])fetch\(/.test(code(file)))).toEqual(['lib/picture-fetch.ts']);
    expect(callers('csrfFetch')).toEqual(['lib/csrf-client.ts', 'lib/picture-fetch.ts', 'lib/picture-upload.ts']);
    // On purpose changed (review patch C2): the screen asks for a picture by `loadPicture`, which holds the held-File check and the read-back together.
    expect(callers('fetchStagedPicture')).toEqual(['lib/picture-fetch.ts']);
    expect(callers('fetchRetainedPicture')).toEqual(['lib/picture-fetch.ts']);
    expect(callers('loadPicture')).toEqual([screen, 'lib/picture-fetch.ts']);
    const body = code('lib/picture-fetch.ts');
    // The ticket is in a header, never in the address; nothing else is sent; the gateway is the ticket's and nobody else's.
    expect(body).toMatch(/headers: \{authorization: `Ticket \$\{ticket\.ticket\}`\}/);
    expect(body).toMatch(/credentials: 'omit'/);
    expect(body).toMatch(/referrerPolicy: 'no-referrer'/);
    // On purpose changed (Story 2.12): a picture the revision pins is read from its retained copy, by the same ticket and the same hash check, with the kind `retained`.
    expect(body).toMatch(/downloadUrl\(ticket\.gateway, picture\.uploadId, source\)/);
    expect(body).toContain('return `${base.origin}/v1/files/${kind}/${id}`;');
    expect(body).toContain("export type PictureSource = 'staging' | 'retained';");
    expect(body).toMatch(/return fetchPicture\('staging', picture, hooks, deps\);/);
    expect(body).toMatch(/return fetchPicture\('retained', picture, hooks, deps\);/);
    expect(body).not.toMatch(/uploadUrl|https?:\/\//);
    expect(body).toMatch(/JSON\.stringify\(\{direction: 'download', kind, id\}\)/);
    // A pinned picture is read from its retained copy and never from staging or from a held File, checked against the RETAINED SHA-256 and length.
    expect(body).toMatch(/if \(picture\.retained\) \{\s*const kept = await fetchRetainedPicture\(\{uploadId: picture\.uploadId, sha256: picture\.retained\.sha256, length: picture\.retained\.length\}, hooks, deps\);/);
    // The bytes live in memory only: no address made of them, no storage, no link, no log.
    expect(body).not.toMatch(/createObjectURL|localStorage|sessionStorage|indexedDB|document\.|<a\b|\bdownload=|console\.|caches\b|navigator\.storage/);
    // The hash must equal the saved SHA-256, or the picture is not used.
    expect(body).toMatch(/sha256 === picture\.sha256 \? \{ok: true, blob: read\.blob\} : \{ok: false, problem: 'changed'\}/);
    // The body is read through a reader that stops at the saved length (and a length announced by the gateway that is not it is not read at all).
    expect(body).toMatch(/declared !== null && Number\(declared\) !== length/);
    expect(body).toMatch(/if \(total > length\) \{\s*await reader\.cancel\(\)/);
    expect(body).not.toMatch(/\.arrayBuffer\(|\.blob\(\)|response\.text\(/);
    // Each request has 30 seconds, and a request that is not finished by then is the retryable network problem.
    expect(body).toContain('export const fetchTimeoutMs = 30_000;');
    expect(body).toMatch(/answered === expired \? \{ok: false, problem: 'network'\} : answered/);
    expect(body).toMatch(/if \(status === 404 \|\| status === 410\) return 'lapsed';/);
    expect(body).toMatch(/if \(status === 408 \|\| status === 425 \|\| status === 429 \|\| status >= 500\) return 'network';/);
    // The Story 2.2 read function of the request still says nothing of a download.
    expect(code('lib/projects.ts').slice(code('lib/projects.ts').indexOf('function picturesOf'), code('lib/projects.ts').indexOf('function requestOf'))).not.toMatch(/download|ticket|url/i);
  });

  it('hands the Files of the picture screen to the review in memory only, for the last Save, and lets go of them when the review is left', () => {
    expect(callers('holdFiles')).toEqual(['components/projects/picture-intake.tsx', 'lib/picture-fetch.ts']);
    // On purpose changed (review patches B6 and C2): the screen no longer reads the held File itself (`loadPicture` does), and the picture screen lets the Files go when
    // an answer to Save comes back that is not a save.
    expect(callers('heldFile')).toEqual(['lib/picture-fetch.ts']);
    expect(callers('releaseFiles')).toEqual([screen, 'lib/picture-fetch.ts']);
    expect(callers('releaseUnlessSaved')).toEqual(['components/projects/picture-intake.tsx', 'lib/picture-fetch.ts']);
    expect(code('components/projects/picture-intake.tsx')).toMatch(/const result = await attemptSave\(savePictureSet, previous, formData\);\s*(?:\/\/[^\n]*\n\s*)*releaseUnlessSaved\(result\.outcome\);/);
    expect(code('lib/picture-fetch.ts')).toContain("const savedOutcomes = new Set(['created', 'revised', 'replayed', 'unchanged']);");
    // The Files are let go of by themselves after 15 minutes, by a timer started when they are held.
    expect(code('lib/picture-fetch.ts')).toContain('export const heldForMs = 15 * 60_000;');
    expect(code('lib/picture-fetch.ts')).toContain('heldTimer = setTimeout(releaseFiles, heldForMs);');
    // The hand-over is made when Save is pressed, from the ready items that still have their File; a File is never stored, only held in a module-level map.
    expect(code('components/projects/picture-intake.tsx')).toMatch(/holdFiles\(setRef\.current\.flatMap\(\(item\) => \(item\.state === 'ready' && item\.uploadId && item\.file \? \[\{uploadId: item\.uploadId, file: item\.file\}\] : \[\]\)\)\);/);
    expect(code('lib/picture-fetch.ts')).toMatch(/const held = new Map<string, File>\(\);/);
    // The held File is checked against the saved SHA-256 before it is used, and otherwise the picture is read back: in loadPicture, once, behind a unit test.
    expect(code('lib/picture-fetch.ts')).toMatch(/if \(\(await sha256Hex\(file, deps\)\) === picture\.sha256\) return \{ok: true, blob: file, from: 'held'\};/);
    expect(code(screen)).toMatch(/await loadPicture\(\{uploadId: item\.uploadId, sha256: item\.sha256, length: item\.length, retained: item\.retained\}, \{signal\}\);/);
    expect(code(screen)).not.toMatch(/\bsha256Hex\b|\bheldFile\b|\bfetchStagedPicture\b/);
  });

  it('shows a picture only as a small JPEG the browser drew from its own copy, as an object URL made once and revoked by the screen', () => {
    const body = code(screen);
    expect([...body.matchAll(/URL\.createObjectURL\(/g)]).toHaveLength(1);
    expect(body).toMatch(/URL\.createObjectURL\(decoded\.thumbnail\)/);
    expect(body).toMatch(/URL\.revokeObjectURL\(/);
    expect([...body.matchAll(/<img\b/g)]).toHaveLength(1);
    expect(body).toMatch(/<img src=\{item\.thumbnailUrl\} alt=\{t\('review\.picture\.preview', \{position\}\)\} decoding="async"\/>/);
    expect(body).not.toMatch(/<video|<canvas|\bdownload=|<a\b[^>]*\bhref=\{item|\.src =/);
    // The bytes are only a local of the function that measures ONE picture (nothing keeps them for the next), and the Files handed over go when the screen does.
    expect(body).toMatch(/const decoded = await decodePicture\(loaded\.blob\);/);
    expect(body).not.toMatch(/useState<Blob|useRef<Blob|useRef<File|useState<File|new Blob|\bBlob\[\]/);
    expect(body).toMatch(/releaseFiles\(\);/);
    // Nothing in the review, the decoder or the fetch keeps a picture or a measurement: no storage of any kind.
    for (const file of ['lib/picture-decode.ts', 'lib/picture-review.ts', 'lib/picture-fetch.ts', screen]) expect(code(file), file).not.toMatch(/localStorage|sessionStorage|indexedDB|navigator\.storage|document\.cookie/);
    // The decoder reaches no network and no server.
    expect(code('lib/picture-decode.ts')).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|csrfFetch|createObjectURL/);
  });

  it('measures in the browser: the server decodes nothing, resizes nothing and holds no image library', () => {
    for (const file of sources.filter((candidate) => /^(?:app\/|lib\/(?:accounts|projects|project-pages|authority|lifecycle|request-intake|picture-set|picture-upload|picture-view))/.test(candidate))) {
      expect(code(file), file).not.toMatch(/createImageBitmap|OffscreenCanvas|getImageData|\bsharp\b|jimp|pngjs|jpeg-js|canvas\b.*\bnode/i);
    }
    expect(callers('createImageBitmap')).toEqual(['lib/picture-decode.ts']);
    expect(callers('getImageData')).toEqual(['lib/picture-decode.ts']);
    expect(callers('analyze')).toEqual(['lib/picture-decode.ts', 'lib/picture-quality.ts']);
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@aws-sdk/client-s3', '@aws-sdk/lib-storage', '@supabase/ssr', '@supabase/supabase-js', '@upstash/qstash', '@upstash/redis', '@upstash/workflow', 'next', 'pg', 'react', 'react-dom']);
  });

  it('asks for the camera nowhere in the review, and reads no environment variable, adds no route, header or secret', () => {
    expect(callers('getUserMedia')).toEqual(['lib/picture-camera.ts']);
    expect(files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name)).sort()).toEqual([
      'app/api/health/route.ts',
      'app/api/heartbeat/route.ts',
      'app/api/jobs/route.ts',
      'app/api/kit/mutation/route.ts',
      'app/api/status/route.ts',
      'app/api/transfers/tickets/route.ts',
      'app/auth/callback/route.ts',
    ]);
    for (const file of sources) expect(code(file), file).not.toMatch(/content-security-policy|permissions-policy|feature-policy/i);
    expect(read('vercel.json')).not.toMatch(/content-security-policy|permissions-policy|headers/i);
  });

  it('decides the stage of a review in the database, not in the application: no stage is named by the action or the screen', () => {
    for (const file of [actions, screen, 'lib/picture-review.ts']) expect(code(file), file).not.toMatch(/request_confirmed|request_draft/);
  });

  it('adds columns and checks and one writer, in a migration that creates no table, role, secret or policy', () => {
    expect([...migrationCode.matchAll(/^create table (\S+) \(/gm)].map((match) => match[1])).toEqual([]);
    expect([...migrationCode.matchAll(/create (?:or replace )?function ([\w.]+)\(/g)].map((match) => match[1])).toEqual([
      'projects.picture_review_images_valid',
      'projects.picture_review_incomplete',
      'projects.picture_review_digest',
      'projects.picture_review_command_digest',
      'api.record_picture_set',
      'api.record_picture_review',
      'api.read_project_request',
      'api.preflight',
    ]);
    expect([...migrationCode.matchAll(/^create type (\S+) as/gm)].map((match) => match[1])).toEqual(['api.picture_review_recording', 'api.project_request_view']);
    expect([...migrationCode.matchAll(/^alter table projects\.request_images add column (\w+)/gm)].map((match) => match[1])).toEqual(['view_label', 'short_edge_px', 'blur_variance', 'clipped_fraction']);
    expect([...migrationCode.matchAll(/^alter table projects\.request_revisions add column (\w+)/gm)].map((match) => match[1])).toEqual(['obstruction_confirmed_at', 'incomplete_acknowledged_at', 'incomplete_acknowledged_digest']);
    expect([...migrationCode.matchAll(/^alter table projects\.request_(?:images|revisions) add constraint (\w+)/gm)].map((match) => match[1])).toEqual([
      'request_images_review_shape',
      'request_revisions_confirmed_shape',
      'request_revisions_obstruction_shape',
      'request_revisions_acknowledgment_shape',
    ]);
    expect(migrationCode).toMatch(/alter table projects\.request_revisions drop constraint request_revisions_confirmed_shape;/);
    expect(migrationCode).not.toMatch(/create policy|create role|alter role|password|create extension|create schema|create table|alter table projects\.projects/i);
    // The grants are the new writer and the read function that was dropped with its type: nothing to anyone else.
    expect([...migrationCode.matchAll(/^grant .*$/gm)].map((match) => match[0])).toEqual([
      'grant execute on function api.record_picture_review(uuid, bigint, uuid, uuid, integer, text, text, text, jsonb, boolean, boolean) to service_role;',
      'grant execute on function api.read_project_request(uuid, bigint, uuid) to service_role;',
    ]);
    // The new columns avoid the words the Spine keeps for other stories (and any approval, permission, payment, cost or Job).
    for (const column of ['view_label', 'short_edge_px', 'blur_variance', 'clipped_fraction']) expect(column).not.toMatch(/manifest|root|retain|pin|ordinal|digest|approv|permission|payment|cost|job/);
    for (const column of ['obstruction_confirmed_at', 'incomplete_acknowledged_at', 'incomplete_acknowledged_digest']) expect(column).not.toMatch(/approv|permission|payment|paid|cost|price|job|reserv|manifest/);
    // No pass or fail, approval or payment member in the revision or the view of it.
    const view = migrationCode.slice(migrationCode.indexOf('create type api.project_request_view as ('), migrationCode.indexOf(');', migrationCode.indexOf('create type api.project_request_view as (')));
    for (const column of [...view.matchAll(/^  (\w+) \w+/gm)].map((match) => match[1])) expect(column).not.toMatch(/manifest|job|cost|price|payment|url|key|ticket|handle|approv|permission|pass|fail|verdict/);
  });

  it('replaces the confirmed shape so a confirmed direct revision needs no description and every other confirmed one still does', () => {
    const shape = migrationCode.slice(migrationCode.indexOf('add constraint request_revisions_confirmed_shape'), migrationCode.indexOf(');', migrationCode.indexOf('add constraint request_revisions_confirmed_shape')));
    expect(shape).toMatch(/\(confirmed_at is null\) = \(scope is null\) and \(confirmed_at is null\) = \(outcome is null\)/);
    expect(shape).toMatch(/\(confirmed_at is not null or description is null\)/);
    expect(shape).toMatch(/\(confirmed_at is null or description is not null or mode = 'image_direct'\)/);
    // Earlier migrations are not edited.
    expect(read('supabase/migrations/20261019120000_picture_sets.sql')).toContain('request_revisions_confirmed_shape');
    expect(migrationCode).toMatch(/incomplete_acknowledged_at is null or \(mode = 'image_direct' and confirmed_at is not null and obstruction_confirmed_at is not null\)/);
  });

  it('begins the writer with the authority check, after its argument checks and before any table is read, under the lock rename, create and the picture-set writer take', () => {
    const body = functionBody('api.record_picture_review');
    const check = body.indexOf('identity.assert_operation_authority(p_account_id, p_epoch)');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(body.search(/from projects\.|from artifacts\.|update projects\.|insert into projects\./));
    expect(body).toMatch(/exception when sqlstate 'N3010' then[\s\S]*?outcome := 'denied'/);
    expect(body).toMatch(/security definer\s+set search_path = ''/);
    expect(body.indexOf("errcode = '22023'")).toBeLessThan(check);
    expect(body).toContain("pg_advisory_xact_lock(hashtextextended('project_command:' || p_account_id::text || ':' || p_command_id::text, 0))");
    expect(check).toBeLessThan(body.indexOf('pg_advisory_xact_lock'));
    // The order of the story: a rename's command, the revision as the receipt, the Project row, the latest revision, the leases, the obstruction, the acknowledgment, the write.
    // (On purpose changed, review patch A2: an identical re-confirmation is answered `unchanged` after the acknowledgment and before anything is written.)
    const order = [
      'from projects.project_commands', "outcome := 'replayed'", 'for update', "outcome := 'not_editable'", "outcome := 'unknown_upload'", "outcome := 'not_ready'", "outcome := 'expired_upload'",
      "outcome := 'obstruction_not_confirmed'", "outcome := 'acknowledgment_required'", "outcome := 'unchanged'", 'update projects.projects p', 'insert into projects.request_revisions', 'insert into projects.request_images', "outcome := 'created'",
    ];
    const positions = order.map((needle) => body.indexOf(needle));
    for (const [index, position] of positions.entries()) expect(position, order[index]).toBeGreaterThan(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    // `stale` is answered twice, both after the Project row is held and before a lease is read: there is no revision, or it is not the one reviewed.
    const stale = [...body.matchAll(/outcome := 'stale'/g)].map((match) => match.index);
    expect(stale).toHaveLength(2);
    for (const position of stale) {
      expect(position).toBeGreaterThan(body.indexOf('for update'));
      expect(position).toBeLessThan(body.indexOf("outcome := 'unknown_upload'"));
    }
  });

  it('holds the Project row, refuses a tombstone, raises the Project by exactly one, sets the stage, renews within the bound, and recomputes the rule from the claims', () => {
    const body = functionBody('api.record_picture_review');
    expect(body).toMatch(/where p\.id = p_project_id and p\.account_id = p_account_id and p\.deleted_at is null\s+for update/);
    expect(body).toContain("lifecycle.is_tombstoned('project', p_project_id)");
    expect(body).toMatch(/set revision = p\.revision \+ 1, updated_at = v_now, stage = case when v_direct then 'request_confirmed' else 'request_draft' end/);
    expect(body).toMatch(/set expires_at = least\(clock_timestamp\(\) \+ interval '24 hours', l\.created_at \+ interval '7 days'\)/);
    expect(body).toContain('projects.picture_review_incomplete(p_images)');
    expect(body).toContain('v_latest.seq + 1');
    expect(body).toMatch(/v_latest\.seq <> p_expected_seq or v_current <> v_upload_ids/);
    // A review never moves a Project backwards: only a Project still at the request stage is reviewed, and the stage update is guarded the same way (review patch A1).
    expect(body).toMatch(/select p\.stage into v_stage\s+from projects\.projects p\s+where p\.id = p_project_id and p\.account_id = p_account_id and p\.deleted_at is null\s+for update/);
    expect(body).toMatch(/v_latest\.mode = 'evidence_text' or v_stage not in \('request_draft', 'request_confirmed'\) then\s+v_result\.outcome := 'not_editable'/);
    expect(body).toMatch(/where p\.id = p_project_id and p\.stage in \('request_draft', 'request_confirmed'\);/);
    // An identical re-confirmation (same mode, scope, outcome, obstruction confirmation, pictures with labels and measurements, and acknowledgment state) writes nothing (review patch A2).
    const same = body.slice(body.indexOf('v_same :='), body.indexOf("v_result.outcome := 'unchanged'"));
    for (const needle of ['v_latest.mode = p_mode', 'v_latest.scope is not distinct from p_scope', 'v_latest.outcome is not distinct from p_outcome', '(v_latest.confirmed_at is not null) = v_direct', 'v_latest.obstruction_confirmed_at is not null', '(v_latest.incomplete_acknowledged_at is not null) = v_incomplete', 'i.upload_id = (e.value ->> \'upload_id\')::uuid', 'i.view_label is not distinct from (e.value ->> \'label\')', 'i.short_edge_px = ', 'i.blur_variance = ', 'i.clipped_fraction = ']) expect(same, needle).toContain(needle);
    expect(same).not.toMatch(/insert into|update projects\./);
    // A direct revision has no subject and no description; a research-assisted one is unconfirmed; the lengths, digests and types are the leases'.
    expect(body).toMatch(/p_project_id, p_account_id, v_latest\.seq \+ 1, p_command_id, p_mode, null, p_scope, p_outcome, null,/);
    expect(body).toContain('case when v_direct then v_now end');
    expect(body.slice(0, body.indexOf(')\nreturns'))).not.toMatch(/p_(?:sha|length|content|digest|size|stage|approved|incomplete|passed|ok)/);
    // The acknowledgment is recorded only when the database found the inputs incomplete.
    expect(body).toMatch(/case when v_incomplete then v_now end,\s+case when v_incomplete then projects\.picture_review_digest\(p_account_id, p_scope, p_outcome, v_upload_ids, v_labels\) end/);
    // Nothing is released or retained here: the pictures stay the revision's.
    expect(body).not.toMatch(/state = 'released'|delete from|attached|manifest/);
  });

  it('applies one rule in the database, the same as the module: three distinct angles among front to bottom, 800 px, blur 100, clipped 0.35', () => {
    const body = functionBody('projects.picture_review_incomplete');
    expect(body).toContain("in ('front', 'back', 'left', 'right', 'top', 'bottom')");
    expect(body).toContain(') < 3');
    expect(body).toContain("(i.value ->> 'short_edge_px')::integer < 800");
    expect(body).toContain("(i.value ->> 'blur_variance')::numeric < 100");
    expect(body).toContain("(i.value ->> 'clipped_fraction')::numeric > 0.35");
    expect(body).not.toContain("'detail'");
    expect(code('lib/picture-quality.ts')).toContain('minShortEdgePx: 800, minBlurVariance: 100, maxClippedFraction: 0.35');
    expect(code('lib/picture-quality.ts')).toContain('minDistinctViews = 3');
  });

  it('changes record_picture_set in one place only: a latest revision that is an unconfirmed picture revision of either mode', () => {
    const before = read('supabase/migrations/20261019120000_picture_sets.sql').replace(/^\s*--.*$/gm, '');
    const body = (source: string) => source.slice(source.indexOf('function api.record_picture_set('), source.indexOf('$$;', source.indexOf('$$', source.indexOf('function api.record_picture_set(')) + 2));
    const lines = (source: string) => source.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
    const oldLines = lines(body(before));
    const newLines = lines(body(migrationCode));
    // Same function, same lines, but for the single check Story 2.3 changes (the header `create function` becomes `create or replace function`).
    expect(oldLines.filter((line) => !newLines.includes(line))).toEqual(["    if not found or v_latest.mode <> 'evidence_images' or v_latest.confirmed_at is not null then"]);
    expect(newLines.filter((line) => !oldLines.includes(line))).toEqual(["    if not found or v_latest.mode not in ('evidence_images', 'image_direct') or v_latest.confirmed_at is not null then"]);
    expect(newLines).toHaveLength(oldLines.length);
    const newBody = body(migrationCode);
    expect(newBody).toContain("v_latest.mode not in ('evidence_images', 'image_direct') or v_latest.confirmed_at is not null");
  });

  it('answers the label and measurements of each picture and the review of the revision, without a key, an address or a download', () => {
    const read_ = migrationCode.slice(migrationCode.indexOf('create function api.read_project_request('), migrationCode.indexOf('$$;', migrationCode.indexOf('create function api.read_project_request(')));
    expect(read_).toContain("'label', i.view_label,");
    expect(read_).toContain("'short_edge_px', i.short_edge_px,");
    expect(read_).toContain("'blur_variance', i.blur_variance,");
    expect(read_).toContain("'clipped_fraction', i.clipped_fraction");
    expect(read_).toContain('v_result.obstruction_confirmed := v_revision.obstruction_confirmed_at is not null;');
    expect(read_).toContain('v_result.acknowledged := v_revision.incomplete_acknowledged_at is not null;');
    expect(read_).not.toMatch(/storage|bucket|\burls?\b|ticket|handle|signed|download|digest/i);
  });

  it('re-creates the preflight with every earlier probe, a Story 2.3 block, and thirty-six functions', () => {
    const body = migrationCode.slice(migrationCode.indexOf('create or replace function api.preflight()'), migrationCode.indexOf('$$;', migrationCode.indexOf('$$', migrationCode.indexOf('create or replace function api.preflight()')) + 2));
    const before = read('supabase/migrations/20261019120000_picture_sets.sql').replace(/^\s*--.*$/gm, '');
    const oldBody = before.slice(before.indexOf('create or replace function api.preflight()'), before.indexOf('$$;', before.indexOf('$$', before.indexOf('create or replace function api.preflight()')) + 2));
    for (const probe of oldBody.match(/perform [^;]+;/g) ?? []) {
      // The two probes of the tables this story widens grow; every other probe is carried unchanged.
      if (/from projects\.request_(?:revisions|images)\b/.test(probe)) continue;
      expect(body, probe).toContain(probe);
    }
    expect(body).toContain('q.obstruction_confirmed_at, q.incomplete_acknowledged_at, q.incomplete_acknowledged_digest from projects.request_revisions q limit 1');
    expect(body).toContain('y.view_label, y.short_edge_px, y.blur_variance, y.clipped_fraction from projects.request_images y limit 1');
    expect(body).toContain('the Story 2.3 migration is not applied');
    expect(body).toContain("'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)'");
    const privileges = body.slice(body.lastIndexOf('from unnest(array[', body.indexOf('has_function_privilege')), body.indexOf('has_function_privilege'));
    expect([...privileges.matchAll(/'api\.[a-z_]+\(/g)]).toHaveLength(36);
    // The bucket check stays last.
    expect(body.indexOf("b.id = 'private-files'")).toBeGreaterThan(body.indexOf('has_table_privilege'));
    expect(body.indexOf('v_result.ok := true')).toBeGreaterThan(body.indexOf("b.id = 'private-files'"));
  });

  it('writes the story down: the writer, the acknowledgment that is not an approval, the definitions for Josh to approve, the rollout and the README', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['Reviewing pictures', 'api.record_picture_review', 'stale', 'acknowledgment is not an approval', 'projects.picture_review_incomplete', 'unreviewed successor', 'Research-assisted', 'FOR UPDATE', 'exactly one', 'staged SHA-256']) expect(contract, needle).toContain(needle);
    const quality = read('docs/picture-quality.md');
    for (const needle of ['512 px', '299', 'Laplacian', 'population variance', '800 px', 'at most 0.35', 'detail', 'Josh', 'Story 7.9', 'server never decodes', 'single-use download ticket', 'Known limits', '100 megapixels']) expect(quality, needle).toContain(needle);
    const guide = read('docs/staging.md');
    for (const needle of ['20261020120000_picture_review.sql', 'api.record_picture_review', 'Do not roll the build back once a direct revision exists']) expect(guide, needle).toContain(needle);
    const readme = read('README.md');
    for (const needle of ['Story 2.3', 'picture_review', 'recordPictureReview', 'picture-review', 'docs/picture-quality.md', 'picture-quality', 'Generate anyway', '("Reviewing pictures")']) expect(readme, needle).toContain(needle);
    // The Projects row says the gateway's APP_ORIGIN once, with the picture-set writer's pointer ("Saving pictures"), and points the review writer to "Reviewing pictures".
    const cell = readme.split('\n').find((line) => line.startsWith('| Projects |')) ?? '';
    expect(cell.match(/APP_ORIGIN/g)).toHaveLength(1);
    expect(cell.indexOf('("Saving pictures")')).toBeLessThan(cell.indexOf('Story 2.3 ('));
    expect(cell.indexOf('("Reviewing pictures")')).toBeGreaterThan(cell.indexOf('Story 2.3 ('));
    expect(contract).toContain('`unchanged`');
    expect(contract).toContain('never moves a Project backwards');
  });

  it('gives the stage request_draft its destination, the review, and rewrites the review path when its ID cannot be decoded', () => {
    expect(code('lib/project-stage.ts')).toMatch(/request_draft: \{[^}]*destination: reviewPath\}/);
    expect(code('lib/project-paths.ts')).toContain('export const reviewPath = (projectId: string) => `/projects/${projectId}/pictures/review`;');
    expect(code('lib/project-paths.ts')).toContain('(?:\\/(?:sources|pictures(?:\\/review)?))?');
  });
});

describe('Retaining the confirmed pictures (Story 2.12) is one module, before the review is recorded, with no root or key in a page, an address or a log', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'next.config.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const code = (file: string) => withoutComments(read(file));
  const retention = 'lib/retention.ts';
  const actions = 'app/projects/[projectId]/pictures/review/actions.ts';
  const page = 'app/projects/[projectId]/pictures/review/page.tsx';
  const screen = 'components/projects/picture-review.tsx';

  it('is the one caller of the gateway\'s attach, and the one place the strip transform is named in the application', () => {
    // `attach(` is the gateway client's method; its definition is in lib/gateway-client.ts and its one caller is lib/retention.ts.
    expect(sources.filter((file) => /\bgateway\.attach\(|\.attach\(\{/.test(code(file)))).toEqual([retention]);
    expect(sources.filter((file) => /strip-picture-metadata/.test(code(file)))).toEqual([retention]);
    expect(code(retention)).toContain("export const stripTransform = 'strip-picture-metadata';");
    expect(code(retention)).toMatch(/transform: stripTransform/);
    // Nothing in the application deletes through the gateway on its behalf here, and nothing signs a command of its own.
    expect(code(retention)).not.toMatch(/deleteStaging|deleteRoot|signCommand|signTicket/);
    expect(callers('retainPictures')).toEqual([actions, screen, retention].sort());
  });

  it('runs the pre-check first and asks the gateway for nothing when there is nothing to attach, with at most 4 in flight and 30 seconds for each attach', () => {
    const body = code(retention);
    expect(body).toContain('export const maxInFlight = 4;');
    expect(body).toContain('export const attachLimitMs = 30_000;');
    expect(body).toContain('export const retainBudgetMs = 60_000;');
    expect(body.indexOf('await check(')).toBeLessThan(body.indexOf('gateway.attach('));
    expect(body).toMatch(/if \(pending\.length === 0\) return \{outcome: 'retained', count: checked\.pictures\.length\};/);
    // The client is built only after that line: a run that attaches nothing needs no gateway.
    expect(body.indexOf('if (pending.length === 0)')).toBeLessThan(body.indexOf('deps.gateway ??'));
    expect(body).toMatch(/withDeadline\(gateway\.attach\(/);
    // A failure that trying again cannot cure stops new attaches; one that it may cure does not.
    expect(body).toMatch(/if \(!failure\.retryable\) stopped = true;/);
  });

  it('keeps every root, key and address out of what it answers and prints: it reads no environment, logs nothing and returns no root', () => {
    const body = code(retention);
    expect(body).not.toMatch(/process\.env|console\.|\blog\(/);
    // The pre-check's pictures carry a root; the module reads `action` and `position` and `uploadId` of them, and never `root`.
    expect(body).not.toMatch(/\.root\b|\broot\b/);
    expect(body).not.toMatch(/objects\/|staging\/|\/v1\/|https?:\/\//);
    for (const file of [retention, actions, page, screen, 'lib/picture-view.ts', 'lib/project-pages.ts']) expect(code(file), file).not.toMatch(/\.root\b|retained_root|retainedRoot|\bretained\.root\b/);
  });

  it('reaches the database through two typed calls in lib/projects.ts and nothing else, and the pages take the pins without a root', () => {
    expect(code('lib/projects.ts')).toMatch(/callRow\(\s*'check_picture_retention'/);
    expect(code('lib/projects.ts')).toMatch(/callRow\('read_retained_pictures'/);
    for (const file of sources.filter((candidate) => candidate !== 'lib/projects.ts' && candidate !== 'lib/accounts.ts')) {
      expect(code(file), file).not.toMatch(/['"`](?:check_picture_retention|read_retained_pictures)['"`]/);
    }
    expect(callers('checkPictureRetention')).toEqual(['lib/projects.ts', retention]);
    expect(callers('readRetainedPictures')).toEqual(['lib/project-pages.ts', 'lib/projects.ts']);
    // The pages' shape of a pinned picture is the upload and the retained copy's SHA-256 and length.
    expect(code('lib/project-view.ts')).toContain('export type KeptPicture = {uploadId: string; sha256: string; length: number};');
  });

  it('is a second Server Action beside the review writer, with a budget of its own, and the page names the limit the action runs under', () => {
    const body = code(actions);
    expect(body).toMatch(/export async function retainPictures\(_previous: RetainState, formData: FormData\): Promise<RetainState>/);
    expect(body).toContain('createBudget(retainBudgetMs)');
    // The Account is the verified access's; the form names the Project, the revision and the uploads and nothing else.
    expect(body.slice(body.indexOf('export async function retainPictures'), body.indexOf('export async function recordPictureReview'))).not.toMatch(/accountId\s*:\s*(?:formData|String\()|epoch\s*:\s*(?:formData|Number\()|formData\.get\(['"](?:root|key|sha256|digest|length|stage|label)/);
    expect(read(page)).toMatch(/^export const maxDuration = 60;$/m);
    expect(read(page)).toContain('maxDuration.md');
    // No new route handler: the actions are Server Actions.
    expect(files('app', (name) => /^route\.(ts|js)$/.test(name)).filter((file) => /retain|retention|picture|review/i.test(file))).toEqual([]);
  });

  it('records the review only when every picture was kept: the screen confirms through one function that calls the record action after the retain action answered retained', () => {
    const body = code(screen);
    expect([...body.matchAll(/confirmReview\(/g)]).toHaveLength(1);
    expect(body).toMatch(/retain: retainPictures,\s*record: recordPictureReview,/);
    // The screen no longer calls the record action itself.
    expect(body).not.toMatch(/attemptReview\(|attemptRetain\(/);
    const view = code('lib/picture-view.ts');
    const confirm = view.slice(view.indexOf('export async function confirmReview('), view.indexOf('/** The message of an answer to Confirm'));
    expect(confirm.indexOf('attemptRetain(steps.retain')).toBeGreaterThan(0);
    expect(confirm.indexOf('attemptRetain(steps.retain')).toBeLessThan(confirm.indexOf('attemptReview(steps.record'));
    expect([...confirm.matchAll(/attemptReview\(steps\.record/g)]).toHaveLength(1);
    // Anything but "kept", and a count that is not the form's pictures, is Confirm's own answer; the record call comes after those returns.
    expect(confirm.indexOf("if (kept.outcome !== 'retained') return reviewOfRetain(kept);")).toBeLessThan(confirm.indexOf('attemptReview(steps.record'));
    expect(confirm).toContain("kept.count !== formData.getAll('uploadId').length");
    expect(callers('attemptRetain')).toEqual(['lib/picture-view.ts']);
    expect(callers('confirmReview')).toEqual([screen, 'lib/picture-view.ts']);
    // The screen reads the page's pins (never a root), and reads a picture from where it is kept.
    expect(body).toContain('retained: item.retained');
    expect(body).toMatch(/kept\?: readonly KeptPicture\[\]/);
  });

  it('uses no new dependency, variable or secret, and no CSP or header policy', () => {
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>; devDependencies: Record<string, string>};
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@aws-sdk/client-s3', '@aws-sdk/lib-storage', '@supabase/ssr', '@supabase/supabase-js', '@upstash/qstash', '@upstash/redis', '@upstash/workflow', 'next', 'pg', 'react', 'react-dom']);
    expect(read('next.config.ts')).not.toMatch(/Content-Security-Policy|Permissions-Policy|headers\(/);
  });
});

describe('Usage limits (Story 2.4) are changed through one typed module and one gate, in integer microdollars, and nothing writes a figure', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'next.config.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const code = (file: string) => withoutComments(read(file));
  const actions = 'app/admin/usage/actions.ts';
  const page = 'app/admin/usage/page.tsx';
  const migrationFile = 'supabase/migrations/20261022120000_usage_limits.sql';
  const migration = read(migrationFile).replace(/^\s*--.*$/gm, '');
  const browserPieces = ['lib/usage-view.ts', 'components/use-usage-action.ts', ...files('components/admin', (name) => /^usage-.*\.tsx$/.test(name))];

  it('finds the files it reads', () => {
    for (const file of [actions, page, 'lib/usage.ts', 'lib/usage-view.ts', 'components/admin/usage-content.tsx', 'components/admin/usage-list.tsx', 'components/admin/usage-meter.tsx', 'components/admin/usage-failure-notice.tsx', migrationFile]) {
      expect(() => read(file), file).not.toThrow();
    }
    expect(browserPieces.sort()).toEqual(['components/admin/usage-content.tsx', 'components/admin/usage-failure-notice.tsx', 'components/admin/usage-list.tsx', 'components/admin/usage-meter.tsx', 'components/use-usage-action.ts', 'lib/usage-view.ts']);
  });

  it('reaches the three database functions through lib/usage.ts and nothing else names them', () => {
    for (const file of sources.filter((candidate) => candidate !== 'lib/usage.ts' && candidate !== 'lib/accounts.ts')) {
      expect(code(file), file).not.toMatch(/['"`](?:set_usage_limit|list_usage|record_usage_refusal)['"`]/);
    }
    expect(code('lib/usage.ts')).toMatch(/callRow\(\s*'list_usage'/);
    expect(code('lib/usage.ts')).toMatch(/callRow\(\s*'set_usage_limit'/);
    expect(code('lib/usage.ts')).toMatch(/callRow\(\s*'record_usage_refusal'/);
    expect(callers('setUsageLimit')).toEqual([actions, 'lib/usage.ts']);
    expect(callers('listUsage')).toEqual([page, 'lib/usage.ts']);
    expect(callers('recordUsageRefusal')).toEqual([actions, 'lib/usage.ts']);
    for (const file of sources.filter((candidate) => /^(?:app\/.*page\.tsx|components\/.*)$/.test(candidate))) {
      expect(code(file), file).not.toMatch(/\b(?:setUsageLimit|recordUsageRefusal|callApi|callRow)\b/);
    }
  });

  it('is the third user of the administrator wrapper: two Server Actions behind it, the Account only from the verified access, and the rest of the form only after the role and the marker', () => {
    expect(read(actions).trimStart()).toMatch(/^'use server';/);
    const body = code(actions);
    expect([...body.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map((match) => match[1])).toEqual(['changeUsageLimit', 'resetUsageCount']);
    expect([...body.matchAll(/^export\s/gm)]).toHaveLength(2);
    // One wrapper call, in the one function both actions share; the file never names the marker itself (the wrapper is the only gate).
    expect([...body.matchAll(/\badministered\(/g)]).toHaveLength(1);
    expect(body).not.toMatch(/\bcheckMarker\b|\bwithActiveAccount\b|startedAfter/);
    const wrapped = body.slice(body.indexOf('return administered('));
    // Only the Account is read before the wrapper (the refusal is audited against it); the command, the period and the limit only inside its callback.
    expect([...body.matchAll(/formData\.get\(['"](\w+)['"]\)/g)].map((match) => match[1])).toEqual(['commandId', 'expectedSeq', 'limit', 'accountId', 'accountId']);
    expect(wrapped).toContain('commandOf(formData)');
    expect(wrapped).toContain("parseDollars(formData.get('limit'))");
    expect(body.slice(0, body.indexOf('return administered(')).replace(/function commandOf[\s\S]*?\n\}\n/, '')).not.toMatch(/commandOf\(formData\)|parseDollars\(/);
    expect([...body.matchAll(/accountIdOf\(formData\.get\('accountId'\)\)/g)]).toHaveLength(2);
    // The Administrator's Account and epoch come from the verified access, never from the form.
    expect(wrapped).toMatch(/operationOf\(access\.account\)/);
    for (const forbidden of [/\baccountId\s*:\s*(?:formData|String\()/, /\bepoch\s*:\s*(?:formData|Number\()/, /\bsearchParams\b/, /\bheaders\(\)/, /\brequest\.url\b/, /cookies\(/, /formData\.get\(['"](?:actor|userId|epoch|adminAccountId|role)/]) {
      expect(body).not.toMatch(forbidden);
    }
    // A change is never made before both checks: the typed call is inside the wrapper's callback.
    expect(body.indexOf('setUsageLimit(')).toBeGreaterThan(body.indexOf('return administered('));
    // The refusals are the Usage ones, recorded through the Usage module (not by widening the Accounts recorder).
    expect(body).toContain("'usage.denied'");
    expect(body).toContain("'usage.limit_refused'");
    expect(body).not.toMatch(/recordAccountRefusal|recordInvitationRefusal|account\.denied/);
  });

  it('gives the page the same guard and metadata as the other Administration pages, and a 404 when the database says denied', () => {
    const body = code(page);
    expect(body).toMatch(/await requireAdministrator\(\)/);
    expect(body).toMatch(/export async function generateMetadata/);
    expect(body).toContain("'meta.usage'");
    expect(body).toContain("'meta.notFound'");
    expect(body).toMatch(/list\?\.outcome === 'denied'\) return notFound\(\)/);
    expect(body).toMatch(/readConfirmation\(access\.user\)/);
    // A read that fails is a page that says so: rows are null, and no number is made up.
    expect(body).toMatch(/rows=\{list \? list\.rows : null\}/);
    // The page reads the confirmation to decide whether to offer the step-up beforehand, and returns nowhere of its own.
    expect(body).not.toMatch(/['"`]\/step-up|returnTo|stepUpReturnPaths/);
    expect(code('lib/step-up.ts')).toMatch(/administration: '\/admin',/);
  });

  it('keeps the browser-bound pieces free of the server-only modules, and money out of floats and locales', () => {
    for (const file of browserPieces) {
      const text = code(file);
      expect(text, file).not.toMatch(/from '@\/lib\/(?:accounts|access|auth|authority|administered|usage)'|from '\.\/(?:accounts|authority)(?:\.ts)?'|node:crypto|next\/headers|next\/cache/);
      expect(text, file).not.toMatch(/\bIntl\b|toLocale|toFixed|parseFloat|Number\.parseFloat|\bMath\.round\b/);
    }
    // Dollars are written by one function and read by one: no component or action does the arithmetic of money itself.
    for (const file of [actions, ...browserPieces.filter((candidate) => candidate.startsWith('components/')), page]) {
      expect(code(file), file).not.toMatch(/\/ ?1_?000_?000\b|\* ?1_?000_?000\b|\b10_?000\b|\bmicrodollarsPerCent\b/);
    }
    expect(callers('formatDollars')).toEqual(['components/admin/usage-list.tsx', 'components/admin/usage-meter.tsx', 'lib/usage-view.ts']);
    expect(callers('parseDollars')).toEqual([actions, 'components/admin/usage-list.tsx', 'lib/usage-view.ts']);
  });

  it('computes the state with integer arithmetic only, in the one module', () => {
    const view = code('lib/usage-view.ts');
    expect(view).toContain('BigInt(used) * BigInt(5) < BigInt(limit) * BigInt(4)');
    expect(view).toContain('if (used >= limit) return \'reached\';');
    expect(callers('classify')).toEqual(['lib/usage-view.ts']);
    expect(callers('figuresOf')).toEqual(['components/admin/usage-list.tsx', 'lib/usage-view.ts']);
  });

  it('writes no figure: nothing in the application, a script or an api function names the fixture table, and nothing but the owner\'s tests inserts into it', () => {
    for (const file of [...sources, ...files('scripts', (name) => /\.(mjs|ts|js)$/.test(name)), ...files('workers', (name) => /\.ts$/.test(name))]) {
      expect(code(file), file).not.toMatch(/fixture_figures|fixtureFigures/);
    }
    const apiFunctions = [...migration.matchAll(/create function api\.\w+[\s\S]*?\n\$\$;/g)].map((match) => match[0]);
    expect(apiFunctions.length).toBe(3);
    for (const fn of apiFunctions) expect(fn).not.toMatch(/fixture_figures/);
    // The figures of a period come from one function, over the table; nothing else in the file reads the table.
    const readers = [...migration.matchAll(/create function (usage\.\w+)[\s\S]*?\n\$\$;/g)].filter((match) => /fixture_figures/.test(match[0])).map((match) => match[1]);
    expect(readers).toEqual(['usage.period_figures']);
    expect(migration).not.toMatch(/insert\s+into\s+usage\.fixture_figures|update\s+usage\.fixture_figures|delete\s+from\s+usage\.fixture_figures/i);
  });

  it('closes the usage schema like the others, makes a period immutable, and gives it the limits the story names', () => {
    expect(migration).toMatch(/create schema usage;/);
    expect(migration).toMatch(/revoke all on schema usage from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/alter default privileges for role postgres in schema usage revoke execute on functions from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/alter default privileges for role postgres in schema usage revoke all on tables from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/alter table usage\.periods enable row level security;/);
    expect(migration).toMatch(/alter table usage\.fixture_figures enable row level security;/);
    expect(migration).not.toMatch(/create policy/i);
    // Update and truncate are refused; delete is left for the Epic 8 purge.
    expect(migration).toMatch(/create trigger periods_no_update before update on usage\.periods/);
    expect(migration).toMatch(/create trigger periods_no_truncate before truncate on usage\.periods/);
    expect(migration).not.toMatch(/before delete on usage\.periods|before update or delete on usage\.periods/);
    expect(migration).not.toMatch(/(?:update\s+usage\.periods|delete\s+from\s+usage\.periods)/i);
    // Whole cents from $0 to $10,000, in integer microdollars, and the restricting key.
    expect(migration).toContain('limit_microdollars between 0 and 10000000000 and limit_microdollars % 10000 = 0');
    expect(migration).toContain('references identity.accounts (id) on delete restrict');
    expect(migration).toMatch(/unique \(account_id, seq\)/);
    expect(migration).toMatch(/unique \(account_id, command_id\)/);
    expect(migration).toMatch(/cause text not null check \(cause in \('initial', 'month', 'change', 'reset'\)\)/);
    // The UTC month, never the session's time zone; the lock Story 2.6 reuses; the defaults.
    expect(migration).toContain("date_trunc('month', clock_timestamp() at time zone 'UTC')::date");
    expect(migration).toContain("'nova3d:usage:' || p_account_id::text");
    expect(migration).toContain("'nova3d:usage:' || p_target_account_id::text");
    expect(migration).toMatch(/return 50000000;/);
    expect(migration).toMatch(/return 25000000;/);
    // No money in a float, and no scheduler.
    expect(migration).not.toMatch(/\b(?:double precision|float|float4|float8|numeric|decimal|money)\b/i);
    expect(migration).not.toMatch(/pg_cron|cron\.schedule/i);
  });

  it('re-creates activate_account with the initial period in its transaction, backfills, and rolls the month over under the lock before anything reads or writes', () => {
    const activate = migration.slice(migration.indexOf('create or replace function identity.activate_account'), migration.indexOf('$$;', migration.indexOf('create or replace function identity.activate_account')));
    expect(activate).toContain('perform projects.provision_workspace(v_account_id);');
    expect(activate).toContain('perform usage.create_initial_period(v_account_id, p_role);');
    expect(migration).toMatch(/select usage\.ensure_period\(a\.id\) from identity\.accounts a order by a\.created_at, a\.id;/);
    // Every `api` function of the story calls ensure_period before it reads or changes a period.
    const list = migration.slice(migration.indexOf('create function api.list_usage'), migration.indexOf('comment on function api.list_usage'));
    expect(list.indexOf('usage.ensure_period(')).toBeGreaterThan(list.indexOf('assert_operation_authority'));
    expect(list.indexOf('usage.ensure_period(')).toBeLessThan(list.indexOf('jsonb_agg'));
    const command = migration.slice(migration.indexOf('create function api.set_usage_limit'), migration.indexOf('comment on function api.set_usage_limit'));
    expect(command.indexOf('usage.ensure_period(')).toBeGreaterThan(command.indexOf('pg_advisory_xact_lock'));
    expect(command.indexOf('usage.ensure_period(')).toBeLessThan(command.indexOf('usage.append_period('));
  });

  it('runs the command in the order the story names, and audits in the same transaction', () => {
    const command = migration.slice(migration.indexOf('create function api.set_usage_limit'), migration.indexOf('comment on function api.set_usage_limit'));
    const order = [
      "raise exception 'invalid argument'",
      'identity.assert_operation_authority(p_admin_account_id, p_epoch)',
      "v_role is distinct from 'administrator'",
      "lifecycle.is_tombstoned('account', p_target_account_id)",
      'pg_advisory_xact_lock(',
      "v_target.status <> 'active'",
      'usage.ensure_period(',
      "v_result.outcome := 'replayed'",
      "v_result.outcome := 'reused'",
      "v_result.outcome := 'stale'",
      "v_result.outcome := 'invalid_limit'",
      "v_result.outcome := 'unchanged'",
      'usage.append_period(',
      'identity.record_audit(p_actor',
    ].map((needle) => command.indexOf(needle));
    expect(order.every((index) => index >= 0), order.join(',')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(command).toContain("'usage.limit_changed'");
    expect(command).toContain("'usage.limit_reset'");
    // The audit table's five columns are pinned: nothing here alters it or puts a limit in it.
    expect(migration).not.toMatch(/alter table identity\.audit_events/i);
    expect(command).toContain("identity.record_audit(p_actor, case when p_kind = 'change' then 'usage.limit_changed' else 'usage.limit_reset' end, 'account:' || p_target_account_id::text)");
    // The marker is the application's check: the function never reads one.
    expect(command).not.toMatch(/fresh_authentications|use_marker/);
  });

  it('re-creates the preflight with every earlier probe, a Story 2.4 block, and forty-one functions', () => {
    const body = migration.slice(migration.indexOf('create or replace function api.preflight()'), migration.indexOf('$$;', migration.indexOf('$$', migration.indexOf('create or replace function api.preflight()')) + 2));
    const before = read('supabase/migrations/20261021120000_retained_pictures.sql').replace(/^\s*--.*$/gm, '');
    const oldBody = before.slice(before.indexOf('create or replace function api.preflight()'), before.indexOf('$$;', before.indexOf('$$', before.indexOf('create or replace function api.preflight()')) + 2));
    for (const probe of oldBody.match(/perform [^;]+;/g) ?? []) expect(body, probe).toContain(probe);
    expect(body).toContain('from usage.periods u limit 1');
    expect(body).toContain('from usage.fixture_figures x2 limit 1');
    expect(body).toContain('the Story 2.4 migration is not applied');
    for (const signature of ['api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)', 'api.list_usage(uuid,bigint)', 'api.record_usage_refusal(uuid,text,uuid)', 'usage.ensure_period(uuid)', 'usage.period_figures(uuid)', 'usage.available_microdollars(uuid)', 'usage.default_limit(text)']) {
      expect(body, signature).toContain(`'${signature}'`);
    }
    const privileges = body.slice(body.lastIndexOf('from unnest(array[', body.indexOf('has_function_privilege')), body.indexOf('has_function_privilege'));
    expect([...privileges.matchAll(/'api\.[a-z_]+\(/g)]).toHaveLength(41);
    // The bucket check stays last.
    expect(body.indexOf("b.id = 'private-files'")).toBeGreaterThan(body.indexOf('has_table_privilege'));
    expect(body.indexOf('v_result.ok := true')).toBeGreaterThan(body.indexOf("b.id = 'private-files'"));
    expect(migration.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it('adds no route, no dependency, no variable and no secret, and leaves the Accounts list and Account disable alone', () => {
    expect(files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name)).sort()).toEqual([
      'app/api/health/route.ts',
      'app/api/heartbeat/route.ts',
      'app/api/jobs/route.ts',
      'app/api/kit/mutation/route.ts',
      'app/api/status/route.ts',
      'app/api/transfers/tickets/route.ts',
      'app/auth/callback/route.ts',
    ]);
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>};
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@aws-sdk/client-s3', '@aws-sdk/lib-storage', '@supabase/ssr', '@supabase/supabase-js', '@upstash/qstash', '@upstash/redis', '@upstash/workflow', 'next', 'pg', 'react', 'react-dom']);
    for (const file of ['lib/usage.ts', 'lib/usage-view.ts', actions, page, ...browserPieces]) expect(code(file), file).not.toMatch(/process\.env/);
    // Usage is not on the Accounts list and Account disable is untouched.
    expect(code('lib/account-admin.ts')).not.toMatch(/usage/i);
    expect(code('components/admin/account-list.tsx')).not.toMatch(/usage/i);
    expect(code('app/admin/accounts/actions.ts')).not.toMatch(/usage/i);
    expect(migration).not.toMatch(/create or replace function api\.(?:disable_account|enable_account|list_accounts)|alter function api\.(?:disable_account|enable_account|list_accounts)/i);
  });

  it('prints only the name and message of an error, and records a refusal with the actor, the action and the Account alone', () => {
    const body = code(actions);
    const lines = body.split('\n').filter((line) => /console\.(?:log|info|warn|error|debug)\(/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/describe\(error\)/);
      expect(line).not.toMatch(/email|accountId|formData|amount|\$\{/i);
    }
    expect(body).toMatch(/recordUsageRefusal\(\{userId, action, accountId\}/);
    for (const file of ['lib/usage.ts', ...browserPieces]) expect(code(file), file).not.toMatch(/console\./);
  });

  it('writes the story down: the contract, the stand-in, the deferred work, the staging row and the README', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of ['Usage periods', 'usage.periods', 'usage.ensure_period', 'nova3d:usage:', 'usage.fixture_figures', 'usage.period_figures', 'api.set_usage_limit', 'carried', 'reset', 'Story 2.6', 'immutable']) expect(contract, needle).toContain(needle);
    const guide = read('docs/staging.md');
    for (const needle of ['20261022120000_usage_limits.sql', 'api.set_usage_limit', 'usage.fixture_figures', 'forty-one']) expect(guide, needle).toContain(needle);
    const readme = read('README.md');
    for (const needle of ['Story 2.4', 'usage_limits', 'lib/usage.ts', 'lib/usage-view.ts', '/admin/usage', '("Usage periods")']) expect(readme, needle).toContain(needle);
    expect(readme.split('\n').find((line) => line.startsWith('| Usage')) ?? '').not.toContain('nothing yet');
    const deferred = read('_bmad-output/implementation-artifacts/deferred-work.md');
    for (const needle of ['Story 2.4', 'usage.fixture_figures', '$10,000', 'scheduler', 'history']) expect(deferred, needle).toContain(needle);
  });
});

describe('Job records (Story 2.11) are written by six commands and read through one typed module that nothing calls yet, in an order that lets neither a duplicate nor a retry through', () => {
  const sources = [
    ...files('app', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('components', (name) => /\.(ts|tsx)$/.test(name)),
    ...files('lib', (name) => /\.(ts|tsx)$/.test(name)),
    'proxy.ts',
    'next.config.ts',
  ];
  const callers = (name: string) => sources.filter((file) => new RegExp(`\\b${name}\\b`).test(withoutComments(read(file)))).sort();
  const code = (file: string) => withoutComments(read(file));
  const moduleFile = 'lib/job-records.ts';
  const migrationFile = 'supabase/migrations/20261023120000_job_records.sql';
  const migration = read(migrationFile).replace(/^\s*--.*$/gm, '');
  const apiNames = ['accept_job', 'begin_step', 'advance_operation', 'move_attempt', 'request_retry', 'read_job'];
  const tables = ['jobs', 'attempts', 'steps', 'operations', 'commands'];
  /** The text of one `api` function, from its `create function` to its `comment on function`. */
  const body = (name: string) => migration.slice(migration.indexOf(`create function api.${name}(`), migration.indexOf(`comment on function api.${name}(`));
  /** The text of one table's definition. */
  const table = (name: string) => migration.slice(migration.indexOf(`create table jobs.${name} (`), migration.indexOf('\n);', migration.indexOf(`create table jobs.${name} (`)) + 3);
  /** The position of each needle in the text, which must all be found and must come in this order. */
  const inOrder = (text: string, needles: string[], label = '') => {
    const positions = needles.map((needle) => text.indexOf(needle));
    expect(positions.every((index) => index >= 0), `${label}: ` + needles.filter((needle, index) => positions[index] < 0).join(' | ')).toBe(true);
    expect([...positions].sort((a, b) => a - b), `${label}: ${needles.join(' < ')}`).toEqual(positions);
  };

  it('finds the files it reads', () => {
    for (const file of [moduleFile, migrationFile]) expect(() => read(file), file).not.toThrow();
    for (const name of apiNames) expect(body(name).length, name).toBeGreaterThan(200);
    for (const name of tables) expect(table(name).length, name).toBeGreaterThan(100);
  });

  // The module -----------------------------------------------------------------------------------------------------------------------------

  it('reaches the six database functions through lib/job-records.ts and nothing else names them', () => {
    for (const file of sources.filter((candidate) => candidate !== moduleFile && candidate !== 'lib/accounts.ts')) {
      expect(code(file), file).not.toMatch(/['"`](?:accept_job|begin_step|advance_operation|move_attempt|request_retry|read_job)['"`]/);
    }
    for (const name of apiNames) expect(code(moduleFile), name).toMatch(new RegExp(`callRow\\(\\s*'${name}'`));
    expect([...code(moduleFile).matchAll(/callRow\(\s*'([a-z_]+)'/g)].map((match) => match[1]).sort()).toEqual([...apiNames].sort());
    // callApi, the other call helper, is not used at all.
    expect(code(moduleFile)).not.toMatch(/\bcallApi\b/);
  });

  it('has no caller yet, as lib/project-target.ts has none: Stories 2.6 to 2.8 are the first', () => {
    for (const name of ['acceptJob', 'beginStep', 'advanceOperation', 'moveAttempt', 'requestRetry', 'readJob']) expect(callers(name), name).toEqual([moduleFile]);
    expect(callers('isChargeable')).toEqual([moduleFile]);
    // Nothing in the application, not even a page or a component, imports the module.
    expect(sources.filter((file) => file !== moduleFile && /lib\/job-records|\.\/job-records/.test(code(file)))).toEqual([]);
  });

  it('names no tombstone, reads no environment, prints nothing and imports only the call helpers and the Operation type', () => {
    const source = code(moduleFile);
    expect(source).not.toMatch(/tombstone/i);
    expect(source).not.toMatch(/process\.env|console\.|node:|next\/|\brequire\(|window|document\.|localStorage|sessionStorage|fetch\(/);
    expect([...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]).sort()).toEqual(['@/lib/accounts', '@/lib/authority']);
    expect(source).toMatch(/import type \{Operation\} from '@\/lib\/authority';/);
    // Server-only by reading, like the other typed modules: it sits on lib/accounts.ts, which refuses to load in a browser.
    expect(read(moduleFile)).toContain('SERVER-ONLY');
  });

  it('exports the vocabularies and the pure isChargeable, and nothing that retries, waits or dispatches', () => {
    const source = code(moduleFile);
    for (const exported of ['jobStates', 'storedReasons', 'waitingReasons', 'jobReasons', 'fixedStages', 'operationStates', 'chargeableOperationStates', 'isChargeable', 'acceptJob', 'beginStep', 'advanceOperation', 'moveAttempt', 'requestRetry', 'readJob']) {
      expect(source, exported).toMatch(new RegExp(`export (?:async )?(?:function|const) ${exported}\\b`));
    }
    expect(source).not.toMatch(/setTimeout|setInterval|\bsleep\b|while \(|for \(;;|\bdispatch(?:ed)?\(|outbox|fencing/i);
  });

  it('reads a Job in one statement from stable helpers, so its public state and its attempts are one snapshot', () => {
    const read = body('read_job');
    // One query over the attempts, with the public state joined to it; no second statement for the highest attempt.
    expect([...read.matchAll(/from jobs\.attempts/g)]).toHaveLength(1);
    expect([...read.matchAll(/jobs\.public_state\(/g)]).toHaveLength(1);
    expect(read).toContain('left join lateral jobs.public_state(v_job.id) s on true');
    // It writes nothing and takes no lock of its own.
    expect(read).not.toMatch(/\bfor (?:update|share)\b|insert into|update jobs\.|delete from|pg_advisory|record_command/i);
    // The helpers it asks are STABLE, so they read the snapshot of that statement (a volatile one takes a snapshot of its own for each call).
    for (const helper of ['charge_open', 'derived_reason', 'public_state']) {
      const start = migration.indexOf(`create function jobs.${helper}(`);
      const header = migration.slice(start, migration.indexOf("set search_path = ''", start));
      expect(header, helper).toMatch(/language sql\s+stable\s*$/);
    }
  });

  // The schema -------------------------------------------------------------------------------------------------------------------------------

  it('closes the jobs schema like the others: row-level security on, no policy, every privilege revoked, nothing granted but the six functions', () => {
    expect(migration).toMatch(/create schema jobs;/);
    expect(migration).toMatch(/revoke all on schema jobs from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/alter default privileges for role postgres in schema jobs revoke execute on functions from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/alter default privileges for role postgres in schema jobs revoke all on tables from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/alter default privileges for role postgres in schema jobs revoke all on sequences from public, anon, authenticated, service_role;/);
    for (const name of tables) {
      expect(migration, name).toContain(`alter table jobs.${name} enable row level security;`);
      expect(migration, name).toContain(`revoke all on jobs.${name} from public, anon, authenticated, service_role;`);
    }
    expect(migration).toMatch(/revoke all on all tables in schema jobs from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/revoke all on all functions in schema jobs from public, anon, authenticated, service_role;/);
    expect(migration).not.toMatch(/create policy/i);
    // The only grants anywhere in the file: execute on the six `api` functions, to the service role.
    const grants = [...migration.matchAll(/^grant .*;$/gm)].map((match) => match[0]);
    expect(grants).toHaveLength(6);
    for (const [index, name] of apiNames.entries()) expect(grants[index], name).toMatch(new RegExp(`^grant execute on function api\\.${name}\\([a-z, ]+\\) to service_role;$`));
    expect(migration).not.toMatch(/\bgrant\b[^;]*\b(?:anon|authenticated|public|nova3d_gateway)\b/i);
    // The `jobs` functions are granted to nobody, and every function pins its search path.
    expect(migration).not.toMatch(/grant execute on function jobs\./);
    const functions = [...migration.matchAll(/create (?:or replace )?function ([a-z_.]+)\(/g)];
    expect(functions.length).toBeGreaterThanOrEqual(19);
    for (const match of functions) {
      const definition = migration.slice(match.index, migration.indexOf('$$;', migration.indexOf('$$', match.index) + 2) + 3);
      expect(definition, match[1]).toContain("set search_path = ''");
      if (match[1].startsWith('api.') && match[1] !== 'api.preflight') expect(definition, match[1]).toContain('security definer');
    }
  });

  it('gives a Job no state of its own, and the four families the keys and the shapes the story names', () => {
    // A Job has no state column: its state is its highest attempt's.
    expect(table('jobs')).not.toMatch(/\b(?:state|stage|reason|status)\b/);
    expect(table('jobs')).toContain('constraint jobs_project_fkey foreign key (project_id, account_id) references projects.projects (id, account_id) on delete restrict');
    expect(table('jobs')).toContain("kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,39}$')");
    expect(table('jobs')).toContain('references identity.accounts (id) on delete restrict');
    // Attempts: unique by (Job, number), at most one open, linked to the one before, a closed state set, a stored reason that agrees with the state.
    expect(table('attempts')).toContain('constraint attempts_job_number_key unique (job_id, number)');
    expect(table('attempts')).toContain('constraint attempts_job_fkey foreign key (job_id, account_id) references jobs.jobs (id, account_id) on delete restrict');
    expect(table('attempts')).toContain('constraint attempts_previous_shape check ((previous_attempt_id is null) = (number = 1))');
    expect(table('attempts')).toContain("state text not null check (state in ('waiting', 'running', 'completed', 'failed', 'cancelled'))");
    expect(table('attempts')).toContain("stage text not null check (stage ~ '^[a-z][a-z0-9_]{0,39}$')");
    expect(table('attempts')).toContain("input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$')");
    expect(table('attempts')).toContain("reason in ('step_failed', 'lease_lost', 'user_cancelled', 'account_disabled')");
    expect(table('attempts')).toContain("when 'failed' then reason is not null and reason in ('step_failed', 'lease_lost')");
    expect(table('attempts')).toContain("when 'cancelled' then reason is not null and reason in ('user_cancelled', 'account_disabled')");
    expect(migration).toContain("create unique index attempts_one_open_key on jobs.attempts (job_id) where state in ('waiting', 'running');");
    // Steps and operations: unique by their logical keys, owned by composite keys.
    expect(table('steps')).toContain('constraint steps_attempt_key_key unique (attempt_id, step_key)');
    expect(table('steps')).toContain('references jobs.attempts (id, account_id) on delete restrict');
    expect(table('operations')).toContain('constraint operations_step_ordinal_key unique (step_id, ordinal)');
    expect(table('operations')).toContain('references jobs.steps (id, account_id) on delete restrict');
    expect(table('operations')).toContain('ordinal integer not null check (ordinal between 1 and 100)');
    expect(table('operations')).toContain("check (state in ('planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned'))");
    // Printable ASCII without spaces, 1 to 200 characters, written once.
    expect(table('operations')).toMatch(/request_id text check \(request_id ~ '\^\[(?:!-~|\\u0021-\\u007e)\]\{1,200\}\$'\)/);
    expect(table('operations')).toContain("constraint operations_noncharge_request check (state <> 'noncharge' or request_id is not null)");
    // Receipts: one for each (Account, command ID).
    expect(table('commands')).toContain('primary key (account_id, command_id)');
    expect(table('commands')).toContain("kind text not null check (kind in ('accept_job', 'begin_step', 'advance_operation', 'move_attempt', 'request_retry'))");
    expect(table('commands')).toContain("digest text not null check (digest ~ '^[0-9a-f]{64}$')");
    // Times are the database clock's.
    for (const name of tables) expect(table(name), name).toContain('created_at timestamptz not null default clock_timestamp()');
    expect(migration).not.toMatch(/\bnow\(\)|current_timestamp|statement_timestamp|transaction_timestamp/i);
  });

  it('refuses to edit what is never edited, and lets an attempt and an operation change only by a guarded move; delete is left for the purge', () => {
    for (const name of ['jobs', 'steps', 'commands']) {
      expect(migration, name).toMatch(new RegExp(`create trigger ${name}_no_update before update on jobs\\.${name}`));
      expect(migration, name).toMatch(new RegExp(`create trigger ${name}_no_truncate before truncate on jobs\\.${name}`));
    }
    for (const [name, trigger] of [['attempts', 'attempts_guard'], ['operations', 'operations_guard']]) {
      expect(migration, name).toMatch(new RegExp(`create trigger ${trigger} before update on jobs\\.${name}`));
      expect(migration, name).toMatch(new RegExp(`create trigger ${name}_no_truncate before truncate on jobs\\.${name}`));
    }
    expect(migration).not.toMatch(/before delete on jobs\.|before update or delete on jobs\.|(?:^|\s)delete\s+from\s+jobs\./im);
    // The moves are the story's, and nothing else.
    const attempt = migration.slice(migration.indexOf('create function jobs.guard_attempt_change'), migration.indexOf('create trigger attempts_guard'));
    expect(attempt).toContain("(('waiting', 'running'), ('waiting', 'cancelled'), ('running', 'completed'), ('running', 'failed'), ('running', 'cancelled'))");
    expect(attempt).toContain("old.state in ('completed', 'failed', 'cancelled')");
    expect(attempt).toContain('an identity column is not changed');
    const operation = migration.slice(migration.indexOf('create function jobs.guard_operation_change'), migration.indexOf('create trigger operations_guard'));
    expect(operation).toContain("('planned', 'dispatched'), ('planned', 'abandoned'), ('dispatched', 'completed'), ('dispatched', 'ambiguous'), ('dispatched', 'noncharge')");
    expect(operation).toContain("('ambiguous', 'settled'), ('ambiguous', 'noncharge')");
    expect(operation).toContain("old.state in ('completed', 'noncharge', 'settled', 'abandoned')");
    expect(operation).toContain('a time and the request ID are written once');
    // An attempt is created by two commands only, a step and an operation only in a running attempt.
    expect([...migration.matchAll(/insert into jobs\.attempts/g)]).toHaveLength(2);
    expect(body('accept_job')).toContain('insert into jobs.attempts');
    expect(body('request_retry')).toContain('insert into jobs.attempts');
    expect(migration.slice(migration.indexOf('create function jobs.check_step'), migration.indexOf('create trigger steps_check'))).toContain("a.state = 'running'");
    expect(migration.slice(migration.indexOf('create function jobs.check_operation'), migration.indexOf('create trigger operations_check'))).toContain("a.state = 'running'");
    // Every update in the file is inside a command.
    const updates = [...migration.matchAll(/(?:^|\n)\s*update (jobs\.[a-z]+)/g)].map((match) => {
      const owner = [...migration.slice(0, match.index).matchAll(/create function ([a-z_.]+)\(/g)].pop()![1];
      return `${match[1]} in ${owner}`;
    });
    expect(updates.sort()).toEqual(['jobs.attempts in api.begin_step', 'jobs.attempts in api.move_attempt', 'jobs.operations in api.advance_operation', 'jobs.operations in api.move_attempt'].sort());
    // Nothing is inserted anywhere but by the commands (and the one receipt writer).
    const inserts = [...migration.matchAll(/insert into (jobs\.[a-z]+)/g)].map((match) => `${match[1]} in ${[...migration.slice(0, match.index).matchAll(/create function ([a-z_.]+)\(/g)].pop()![1]}`);
    expect(inserts.sort()).toEqual([
      'jobs.attempts in api.accept_job', 'jobs.attempts in api.request_retry', 'jobs.commands in jobs.record_command', 'jobs.jobs in api.accept_job',
      'jobs.operations in api.begin_step', 'jobs.steps in api.begin_step',
    ]);
  });

  it('names no reservation, rate, provider, lease, signing, outbox or result field, writes no other module\'s table and records no audit event', () => {
    for (const name of tables) {
      expect(table(name), name).not.toMatch(/\b(?:reservation\w*|rates?|provider\w*|model\w*|lease_(?!lost\b)\w*|leases\b|leased\w*|fenc\w*|signing\w*|signature\w*|outbox\w*|results?|payload\w*|cost\w*|amount\w*|microdollars?\w*|worker\w*|dispatch_id|callback\w*)\b/i);
    }
    expect(migration).not.toMatch(/(?:insert into|update|delete from)\s+(?:usage|lifecycle|identity|projects|artifacts)\./i);
    // (The preflight, last, names the older functions it checks.)
    const own = migration.slice(0, migration.indexOf('create or replace function api.preflight'));
    expect(own).not.toMatch(/record_audit|record_tombstone|audit_events/);
    expect(migration).not.toMatch(/alter table (?!jobs\.)/i);
    expect(migration).not.toMatch(/create or replace function (?!api\.preflight)/);
    expect(migration).not.toMatch(/pg_cron|cron\.schedule|pg_sleep|pg_advisory_lock\(|pg_try_advisory|\bnowait\b|skip locked/i);
  });

  // The commands -------------------------------------------------------------------------------------------------------------------------------

  it('runs the four commands on a record in the order the story names: arguments, authority, the command lock, the Project held, the Job lock, the receipt, then its own checks', () => {
    const common = (name: string, own: string[]) => [
      "raise exception 'invalid argument'",
      'identity.assert_operation_authority(p_account_id, p_epoch)',
      "exception when sqlstate 'N3010'",
      "v_result.outcome := 'denied'",
      "pg_advisory_xact_lock(hashtextextended('nova3d:jobs-command:' || p_account_id::text || ':' || p_command_id::text, 0))",
      'jobs.hold_project(p_account_id, v_project_id)',
      "v_result.outcome := 'unavailable'",
      "pg_advisory_xact_lock(hashtextextended('nova3d:job:' ||",
      `jobs.command_digest('${name}'`,
      'from jobs.commands c where c.account_id = p_account_id and c.command_id = p_command_id',
      "v_result.outcome := 'reused'",
      "v_result.outcome := 'replayed'",
      ...own,
    ];
    inOrder(body('begin_step'), common('begin_step', ["v_step.id is not null and (p_ordinal is null or v_operation.id is not null)", "v_attempt.state <> 'running'", 'insert into jobs.steps', 'insert into jobs.operations']), 'begin_step');
    inOrder(body('advance_operation'), common('advance_operation', ['if v_operation.state = p_to then', "(v_operation.state, p_to) not in (", 'update jobs.operations o']), 'advance_operation');
    // A dispatch needs a running attempt: after the replay, before the write (whether it comes before or after the list of moves).
    const advance = body('advance_operation');
    expect(advance.indexOf("p_to = 'dispatched' and v_attempt_state <> 'running'")).toBeGreaterThan(advance.indexOf('if v_operation.state = p_to then'));
    expect(advance.indexOf("p_to = 'dispatched' and v_attempt_state <> 'running'")).toBeLessThan(advance.indexOf('update jobs.operations o'));
    expect(advance).toContain("v_result.outcome := 'not_running'");
    inOrder(body('move_attempt'), common('move_attempt', ['if v_attempt.state = p_to then', "(v_attempt.state, p_to) not in (", "p_to = 'running' and jobs.charge_open(", "p_to = 'completed' and exists (", "p_to in ('failed', 'cancelled') then", 'update jobs.attempts a']), 'move_attempt');
    inOrder(body('request_retry'), common('request_retry', ["v_latest.number <> p_expected_number", "v_latest.state <> 'failed'", 'insert into jobs.attempts']), 'request_retry');
    // The receipt of the work done is the last thing each command writes; a receipt of a replay is written where the replay is found.
    for (const [name, last] of [['begin_step', 'insert into jobs.operations'], ['advance_operation', 'update jobs.operations o'], ['move_attempt', 'update jobs.attempts a'], ['request_retry', 'insert into jobs.attempts']]) {
      expect(body(name).lastIndexOf('jobs.record_command('), name).toBeGreaterThan(body(name).lastIndexOf(last));
    }
    // The first command has no Job to lock yet: a new Job is its own.
    inOrder(body('accept_job'), [
      "raise exception 'invalid argument'", 'identity.assert_operation_authority(p_account_id, p_epoch)', "exception when sqlstate 'N3010'", "'nova3d:jobs-command:'", 'jobs.hold_project(p_account_id, p_project_id)',
      "jobs.command_digest('accept_job'", 'from jobs.commands c', "v_result.outcome := 'reused'", "v_result.outcome := 'replayed'", 'insert into jobs.jobs', 'insert into jobs.attempts', "jobs.record_command(p_account_id, p_command_id, 'accept_job'",
    ]);
    expect(body('accept_job')).not.toContain("'nova3d:job:'");
    // The read takes no command ID and no lock: only the checks it needs.
    inOrder(body('read_job'), ["raise exception 'invalid argument'", 'identity.assert_operation_authority(p_account_id, p_epoch)', "exception when sqlstate 'N3010'", "lifecycle.is_tombstoned('project', p.id)", 'jobs.public_state(']);
    expect(body('read_job')).not.toMatch(/p_command_id|pg_advisory|for share|for update|insert into|\bupdate\b/);
  });

  it('holds the Project row FOR SHARE, live and without a tombstone, before every write, so a step can never land after one', () => {
    const hold = migration.slice(migration.indexOf('create function jobs.hold_project'), migration.indexOf('comment on function jobs.hold_project'));
    inOrder(hold, ['from projects.projects p', 'p.account_id = p_account_id', 'p.deleted_at is null', 'for share;', "lifecycle.is_tombstoned('project', p_project_id)"]);
    // Every command that writes asks for it, before any write; none takes the Project FOR UPDATE.
    for (const name of apiNames.filter((candidate) => candidate !== 'read_job')) expect([...body(name).matchAll(/jobs\.hold_project\(/g)], name).toHaveLength(1);
    expect(migration).not.toMatch(/projects\.projects[^;]*for update/i);
    // The subject belongs to the Account: every lookup of a subject names it.
    expect(body('begin_step')).toContain('where a.id = p_attempt_id and a.account_id = p_account_id');
    expect(body('advance_operation')).toContain('where o.id = p_operation_id and o.account_id = p_account_id');
    expect(body('move_attempt')).toContain('where a.id = p_attempt_id and a.account_id = p_account_id');
    expect(body('request_retry')).toContain('where j.id = p_job_id and j.account_id = p_account_id');
    expect(body('read_job')).toContain('j.id = p_job_id and j.account_id = p_account_id');
  });

  it('leaves a receipt from one writer, whenever a command did its work or replayed, and the digest covers the kind and every argument', () => {
    expect([...migration.matchAll(/insert into jobs\.commands/g)]).toHaveLength(1);
    expect(migration.slice(migration.indexOf('create function jobs.record_command'), migration.indexOf('comment on function jobs.record_command'))).toContain('insert into jobs.commands');
    // begin_step, advance_operation and move_attempt record a receipt when they find the work done (a second command ID) and when they do it.
    for (const [name, calls] of [['accept_job', 1], ['begin_step', 2], ['advance_operation', 2], ['move_attempt', 2], ['request_retry', 1]] as const) {
      expect([...body(name).matchAll(/jobs\.record_command\(/g)], name).toHaveLength(calls);
    }
    const digest = migration.slice(migration.indexOf('create function jobs.command_digest'), migration.indexOf('comment on function jobs.command_digest'));
    expect(digest).toContain('projects.length_prefixed(p_kind)');
    expect(digest).toContain('projects.length_prefixed(x.argument)');
    expect(digest).toContain("encode(sha256(");
    expect(body('accept_job')).toContain("array[p_project_id::text, p_kind, p_input_digest]");
    expect(body('begin_step')).toContain("array[p_attempt_id::text, p_step_key, p_ordinal::text]");
    expect(body('advance_operation')).toContain("array[p_operation_id::text, p_to, p_request_id]");
    expect(body('move_attempt')).toContain("array[p_attempt_id::text, p_to, p_reason]");
    expect(body('request_retry')).toContain("array[p_job_id::text, p_expected_number::text, p_input_digest]");
    // Neither the Account, nor the epoch, nor the command ID is in a digest.
    for (const name of apiNames.slice(0, 5)) expect(body(name).match(/command_digest\([^;]*;/)![0], name).not.toMatch(/p_account_id|p_epoch|p_command_id/);
  });

  it('puts the retry wait at the one move that could bypass it, over every earlier attempt, and derives the waiting reason from it', () => {
    const gate = migration.slice(migration.indexOf('create function jobs.charge_open'), migration.indexOf('comment on function jobs.charge_open'));
    expect(gate).toContain('a.number < p_before_number');
    expect(gate).toContain("o.state in ('dispatched', 'ambiguous')");
    expect(gate).toContain('a.job_id = p_job_id');
    const start = body('move_attempt');
    expect(start).toContain("p_to = 'running' and jobs.charge_open(v_attempt.job_id, v_attempt.number)");
    expect(start.indexOf('jobs.charge_open(')).toBeLessThan(start.indexOf('update jobs.attempts a'));
    expect(start.indexOf("v_result.outcome := 'blocked'")).toBeGreaterThan(start.indexOf('jobs.charge_open('));
    // The gate is asked nowhere else but where the reason is derived, and request_retry never starts, waits or sleeps.
    expect([...migration.matchAll(/(?<!function )jobs\.charge_open\(/g)].length).toBe(2);
    const derived = migration.slice(migration.indexOf('create function jobs.derived_reason'), migration.indexOf('comment on function jobs.derived_reason'));
    expect(derived).toContain("when p_state = 'waiting' then case when jobs.charge_open(p_job_id, p_number) then 'awaiting_reconciliation' else 'awaiting_dispatch' end");
    expect(body('request_retry')).not.toMatch(/update jobs\.attempts|'running'|charge_open|pg_sleep|loop/);
    const state = migration.slice(migration.indexOf('create function jobs.public_state'), migration.indexOf('comment on function jobs.public_state'));
    expect(state).toContain('order by a.number desc');
    expect(state).toContain('limit 1');
    expect(state).toContain('jobs.derived_reason(');
    // Ending an attempt abandons only what never went out.
    expect(start).toContain("set state = 'abandoned'");
    expect(start).toContain("o.state = 'planned'");
  });

  it('re-creates the preflight with every earlier probe, a Story 2.11 block, and forty-seven functions', () => {
    const preflight = (text: string) => text.slice(text.indexOf('create or replace function api.preflight()'), text.indexOf('$$;', text.indexOf('$$', text.indexOf('create or replace function api.preflight()')) + 2));
    const current = preflight(migration);
    const before = preflight(read('supabase/migrations/20261022120000_usage_limits.sql').replace(/^\s*--.*$/gm, ''));
    for (const probe of before.match(/perform [^;]+;/g) ?? []) expect(current, probe).toContain(probe);
    for (const signature of before.match(/'(?:api|usage|identity|lifecycle|artifacts|projects)\.[a-z_]+\([^']*\)'/g) ?? []) expect(current, signature).toContain(signature);
    for (const probe of ['from jobs.jobs jb limit 1', 'from jobs.attempts at limit 1', 'from jobs.steps sp limit 1', 'from jobs.operations op limit 1', 'from jobs.commands cm limit 1']) expect(current, probe).toContain(probe);
    expect(current).toContain("raise exception 'api.preflight: the Story 2.11 migration is not applied (missing %)', v_missing using errcode = 'N3020';");
    const block = current.slice(current.indexOf("'api.accept_job(uuid,bigint,uuid,uuid,text,text)'"), current.indexOf('the Story 2.11 migration is not applied'));
    expect([...block.matchAll(/'api\.[a-z_]+\(/g)]).toHaveLength(6);
    for (const signature of ['api.accept_job(uuid,bigint,uuid,uuid,text,text)', 'api.begin_step(uuid,bigint,uuid,uuid,text,integer)', 'api.advance_operation(uuid,bigint,uuid,uuid,text,text)', 'api.move_attempt(uuid,bigint,uuid,uuid,text,text)', 'api.request_retry(uuid,bigint,uuid,uuid,integer,text)', 'api.read_job(uuid,bigint,uuid)']) {
      expect(block, signature).toContain(`'${signature}'`);
    }
    const privileges = current.slice(current.lastIndexOf('from unnest(array[', current.indexOf('has_function_privilege')), current.indexOf('has_function_privilege'));
    expect([...privileges.matchAll(/'api\.[a-z_]+\(/g)]).toHaveLength(47);
    // The bucket check stays last.
    expect(current.indexOf("b.id = 'private-files'")).toBeGreaterThan(current.indexOf('has_table_privilege'));
    expect(current.indexOf('v_result.ok := true')).toBeGreaterThan(current.indexOf("b.id = 'private-files'"));
    // The file ends by having the Data API reload its schema cache.
    expect(migration.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it('adds no route, no dependency, no variable, no screen and no copy, and leaves the scheduled tasks of Story 1.9 alone', () => {
    expect(files('app', (name) => /^route\.(ts|js|tsx|jsx|mjs|cjs)$/.test(name)).sort()).toEqual([
      'app/api/health/route.ts',
      'app/api/heartbeat/route.ts',
      'app/api/jobs/route.ts',
      'app/api/kit/mutation/route.ts',
      'app/api/status/route.ts',
      'app/api/transfers/tickets/route.ts',
      'app/auth/callback/route.ts',
    ]);
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>};
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['@aws-sdk/client-s3', '@aws-sdk/lib-storage', '@supabase/ssr', '@supabase/supabase-js', '@upstash/qstash', '@upstash/redis', '@upstash/workflow', 'next', 'pg', 'react', 'react-dom']);
    // No page, action or component names a Job record, and `lib/i18n` has no copy for one.
    for (const file of sources.filter((candidate) => candidate.startsWith('app/') || candidate.startsWith('components/') || candidate.startsWith('lib/i18n'))) {
      expect(code(file), file).not.toMatch(/awaiting_reconciliation|awaiting_dispatch|\bjobs\.(?:jobs|attempts|steps|operations|commands)\b/);
    }
    // Stories 1.9's tasks are untouched: lib/jobs.ts and lib/job-tasks.ts do not know the new module or its schema.
    for (const file of ['lib/jobs.ts', 'lib/job-tasks.ts', 'app/api/jobs/route.ts']) expect(code(file), file).not.toMatch(/job-records|\bjobs\.(?:jobs|attempts|steps|operations|commands)\b|accept_job|read_job/);
    expect(read('supabase/config.toml')).not.toMatch(/^schemas\s*=.*\bjobs\b/m);
  });

  it('writes the story down: the contract, the gate, the staging row and the README', () => {
    const contract = read('docs/authority-contract.md');
    for (const needle of [
      'Jobs: durable identities for background work', 'jobs.charge_open', 'jobs.public_state', 'api.accept_job', 'api.begin_step', 'api.advance_operation', 'api.move_attempt', 'api.request_retry', 'api.read_job',
      'lib/job-records.ts', 'awaiting_reconciliation', 'potentially chargeable', 'FOR SHARE', 'nova3d:jobs-command', 'nova3d:job:', '20261023120000_job_records.sql',
    ]) expect(contract, needle).toContain(needle);
    const guide = read('docs/staging.md');
    for (const needle of ['20261023120000_job_records.sql', 'api.accept_job', 'jobs.charge_open', 'forty-seven']) expect(guide, needle).toContain(needle);
    const readme = read('README.md');
    for (const needle of ['Story 2.11', 'job_records', 'lib/job-records.ts']) expect(readme, needle).toContain(needle);
  });
});
