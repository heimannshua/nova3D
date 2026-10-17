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
    'app/api/jobs/route.ts': 'the scheduled-job route (Story 1.9) is the one machine path (lib/public-paths.ts): a scheduler calls it with no session and no browser Origin, and the signature over the raw body, checked in lib/jobs.ts, is its only authentication',
  };
  // The public routes that take a POST, and why it changes nothing a caller could use: a lookup reads, and the database counts it (a
  // rate-limit counter is all it writes). The proxy still refuses it from another site, and the database rate limits it.
  const publicPosts: Record<string, string> = {
    'app/api/status/route.ts': 'a lookup of a status handle: it changes nothing but its own rate-limit counter',
    'app/api/jobs/route.ts': 'a signed call of a registered task: nothing runs and nothing is written until the signature, the body and the instance are right, and then only that task and its own receipt',
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
    expect(routes).toEqual(expect.arrayContaining(['app/api/health/route.ts', 'app/api/jobs/route.ts', 'app/api/kit/mutation/route.ts', 'app/api/status/route.ts', 'app/auth/callback/route.ts']));
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
    expect(users).toEqual(['lib/accounts.ts', 'lib/lifecycle.ts', 'lib/projects.ts']);
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
    // The path is the machine path and the only one, written once in the one list the proxy reads.
    const publicPaths = withoutComments(read('lib/public-paths.ts'));
    expect(publicPaths).toMatch(/export const machinePaths = \['\/api\/jobs'\];/);
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

  it('registers exactly three tasks, each run by one function, and no cleanup beyond them (the third is Story 1.12\'s staging cleanup)', () => {
    const registry = withoutComments(read('lib/schedules.ts'));
    expect([...registry.matchAll(/task: '([a-z-]+)'/g)].map((match) => match[1])).toEqual(['dormant-identity-purge', 'ledger-relay', 'staging-cleanup']);
    expect(registry).not.toMatch(/^import\s|\bfrom\s+['"]/m);
    const tasks = withoutComments(read('lib/job-tasks.ts'));
    expect([...tasks.matchAll(/^  '([a-z-]+)': \w+,$/gm)].map((match) => match[1])).toEqual(['ledger-relay', 'dormant-identity-purge', 'staging-cleanup']);
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
    // Nothing reads a receipt yet: the alarm of Story 1.13 will.
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
    expect(gateway.map((file) => file.replace('workers/files/src/', '')).sort()).toEqual(['config.ts', 'database.ts', 'main.ts', 'resolvers.ts', 'server.ts', 'storage.ts', 'transfer.ts']);
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
    expect(readers).toEqual(['lib/environment.ts', 'lib/gateway-client.ts', 'lib/service-signing.ts']);
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
    expect(callers('configuredGatewayClient')).toEqual(['lib/gateway-client.ts', 'lib/job-tasks.ts']);
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

  it('builds into an image that can run: every package the gateway imports is a production dependency, and every file it imports from outside workers/files is copied by the Dockerfile and let through by .dockerignore', () => {
    // The image installs `npm ci --omit=dev` and copies four things; a module the gateway (or a file it shares) starts to import that is in neither place is a
    // build that passes every test here and fails at start-up on the platform, which is the one place nobody looks.
    const manifest = JSON.parse(read('package.json')) as {dependencies: Record<string, string>};
    const dockerfile = read('workers/files/Dockerfile');
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
    const queue = ['workers/files/src/main.ts'];
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
          if (!target.startsWith('workers/files/')) outside.add(target);
          queue.push(target);
        } else if (!type) {
          bare.set(from.startsWith('@') ? from.split('/').slice(0, 2).join('/') : from.split('/')[0], file);
        }
      }
    }
    for (const [name, importer] of bare) expect(manifest.dependencies, `${name} (imported by ${importer}) is not a production dependency`).toHaveProperty(name);
    for (const path of [...outside, 'package.json', 'package-lock.json', ...gateway]) {
      expect(covered(path), `${path} is not copied by workers/files/Dockerfile`).toBe(true);
      expect(sent(path), `${path} is excluded by .dockerignore`).toBe(true);
    }
    // The walk found something to check (what the gateway may import at all is pinned by the test below).
    expect([...seen].filter((file) => file.startsWith('workers/files/')).length).toBe(gateway.length);
    expect([...outside]).toEqual(expect.arrayContaining(['lib/canonical-json.ts', 'lib/service-signing.ts']));
    expect([...bare.keys()]).toEqual(expect.arrayContaining(['@aws-sdk/client-s3', '@aws-sdk/lib-storage', 'pg']));
    // The matcher is not trivially true: what the image does not copy is excluded.
    for (const path of ['lib/environment.ts', 'app/page.tsx', 'tests/unit/gate-structure.test.ts', '.env.local']) expect(sent(path), path).toBe(false);
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
