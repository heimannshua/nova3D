import {X509Certificate, createPublicKey, createVerify} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import {pathToFileURL} from 'node:url';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {fakeGoogleActive} from '../support/fake-google.ts';

// The fake Google (tests/support/fake-google.mjs, Story 1.4b) is test support, but the step-up tests are only as
// good as it is: it has to behave like Google where the application can tell the difference (the chooser, a
// single-use code, a signed id_token), refuse to be more than it is (no open redirect, no tunnel to anywhere
// else, no control API for the container) and carry no key. This starts it in-process, on a free port.

const root = resolve(import.meta.dirname, '../..');
const CLIENT = 'unit-test-client.apps.googleusercontent.com';
const CALLBACK = 'http://127.0.0.1:54321/auth/v1/callback';

type Fake = {
  browserBase: string;
  ports: {browser: number; token: number; tunnel: number; tls: number};
  caPath: string;
  requests: unknown[];
  close(): Promise<void>;
};
type Start = (options: {stateDir: string; clientId: string; ports: Fake['ports']; tempRoot: string; containerHost: string}) => Promise<Fake>;
let fake: Fake;
// Everything this file makes, the fake's key material included, lives under one root of its own: a fake running
// elsewhere on the machine (the real one behind a swapped stack, another test file) changes nothing it counts.
let root_: string;
let stateDir: string;
let tempRoot: string;

const loadModule = async () =>
  (await import(pathToFileURL(resolve(root, 'tests/support/fake-google.mjs')).href)) as {startFakeGoogle: Start};

/** Four ports the operating system says are free right now (it hands out distinct ones while all four are held). */
async function freePorts(): Promise<Fake['ports']> {
  const servers = await Promise.all(
    Array.from({length: 4}, () => new Promise<net.Server>((resolveListen, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolveListen(server));
    })),
  );
  const [browser, token, tunnel, tlsPort] = servers.map((server) => (server.address() as net.AddressInfo).port);
  await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  return {browser, token, tunnel, tls: tlsPort};
}

const keyDirectories = () => readdirSync(tempRoot).filter((name) => name.startsWith('nova3d-fake-google-keys-'));

beforeAll(async () => {
  root_ = mkdtempSync(join(tmpdir(), 'nova3d-fake-google-test-'));
  stateDir = join(root_, 'state');
  tempRoot = join(root_, 'tmp');
  mkdirSync(tempRoot);
  const {startFakeGoogle} = await loadModule();
  fake = await startFakeGoogle({stateDir, clientId: CLIENT, ports: await freePorts(), tempRoot, containerHost: '127.0.0.1'});
});
afterAll(async () => {
  await fake.close();
  rmSync(root_, {recursive: true, force: true});
});

const control = (path: string, init?: RequestInit) => fetch(`${fake.browserBase}${path}`, init);
const addAccount = (email: string, extra: Record<string, unknown> = {}) => control('/__control/accounts', {method: 'POST', body: JSON.stringify({email, sub: `sub-${email}`, ...extra})});
const authorizeUrl = (params: Record<string, string> = {}) => {
  const url = new URL(`${fake.browserBase}/o/oauth2/v2/auth`);
  const all = {client_id: CLIENT, response_type: 'code', redirect_uri: CALLBACK, scope: 'email profile', state: `state-${Math.random()}`, ...params};
  for (const [name, value] of Object.entries(all)) url.searchParams.set(name, value);
  return url;
};
const get = (url: URL | string, headers: Record<string, string> = {}) => fetch(url, {redirect: 'manual', headers});
const form = (body: Record<string, string>) => ({method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)});
const tokenUrl = () => `http://127.0.0.1:${fake.ports.token}/token`;
const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

/** Signs in `email` and returns the code Google would send Auth. */
async function codeFor(email: string, params: Record<string, string> = {}) {
  await addAccount(email);
  const url = authorizeUrl({prompt: 'select_account', ...params});
  url.searchParams.set('__pick', email);
  const response = await get(url);
  expect(response.status).toBe(302);
  const back = new URL(response.headers.get('location')!);
  return {code: back.searchParams.get('code')!, state: back.searchParams.get('state'), redirect: back};
}

describe('the account chooser (the authorization endpoint)', () => {
  it('shows the chooser, listing the accounts it knows, when asked for prompt=select_account', async () => {
    await addAccount('chooser-a@example.test', {name: 'Alice'});
    const response = await get(authorizeUrl({prompt: 'select_account'}));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<title>Fake Google: choose an account</title>');
    expect(html).toContain('data-account="chooser-a@example.test"');
    expect(html).toContain('<p data-prompt>select_account</p>');
    expect(html).toMatch(/<meta name="viewport"/);
  });

  it('passes a browser that already chose an account straight through, but still shows the chooser when asked for it', async () => {
    const { redirect } = await codeFor('remembered@example.test');
    expect(redirect.origin + redirect.pathname).toBe(CALLBACK);
    const cookie = 'fake_google_account=remembered%40example.test';
    const passed = await get(authorizeUrl(), {cookie});
    expect(passed.status).toBe(302);
    expect(new URL(passed.headers.get('location')!).searchParams.get('code')).toBeTruthy();
    const chooser = await get(authorizeUrl({prompt: 'select_account'}), {cookie});
    expect(chooser.status).toBe(200);
    // `login` also forces the chooser, like Google.
    expect((await get(authorizeUrl({prompt: 'login'}), {cookie})).status).toBe(200);
  });

  it('returns the state it was given, with a fresh single-use code, and remembers the choice in a cookie', async () => {
    await addAccount('state@example.test');
    const url = authorizeUrl({prompt: 'select_account', state: 'my-state'});
    url.searchParams.set('__pick', 'state@example.test');
    const response = await get(url);
    const back = new URL(response.headers.get('location')!);
    expect(back.searchParams.get('state')).toBe('my-state');
    expect(back.searchParams.get('code')).toMatch(/^[0-9a-f]{32}$/);
    expect(response.headers.get('set-cookie')).toContain('fake_google_account=state%40example.test');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('records what the application asked for, so a test can see prompt and login_hint at Google\'s end', async () => {
    const email = 'logged@example.test';
    await addAccount(email);
    const state = `logged-${Math.random()}`;
    await get(authorizeUrl({prompt: 'select_account', state}));
    const url = authorizeUrl({prompt: 'select_account', state});
    url.searchParams.set('__pick', email);
    await get(url);
    const log = (await (await control('/__control/requests')).json()) as {state: string; prompt: string | null; loginHint: string | null; picked: string | null; chooser: boolean}[];
    expect(log.filter((entry) => entry.state === state)).toEqual([{state, prompt: 'select_account', loginHint: null, picked: email, chooser: true}]);
  });

  it('refuses another client, another response type, an unknown account, and any return address that is not Auth\'s own callback on this machine', async () => {
    expect((await get(authorizeUrl({client_id: 'someone-else'}))).status).toBe(400);
    expect((await get(authorizeUrl({response_type: 'token'}))).status).toBe(400);
    const unknown = authorizeUrl({prompt: 'select_account'});
    unknown.searchParams.set('__pick', 'nobody@example.test');
    expect((await get(unknown)).status).toBe(400);
    for (const redirect of ['https://evil.example/auth/v1/callback', 'http://127.0.0.1:54321/somewhere/else', 'http://evil.example:54321/auth/v1/callback', '', 'javascript:alert(1)']) {
      const response = await get(authorizeUrl({redirect_uri: redirect}));
      expect(response.status, redirect).toBe(400);
      expect(response.headers.get('location'), redirect).toBeNull();
    }
  });

  it('escapes what it writes into the chooser', async () => {
    await addAccount('<script>x</script>@example.test', {name: '"><img src=x>'});
    const html = await (await get(authorizeUrl({prompt: 'select_account'}))).text();
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<img src=x>');
  });
});

describe('the browser-facing server answers only the browser at its own address', () => {
  /** A raw request, so that the Host header and the fetch metadata are exactly what the test says. */
  function raw(path: string, headers: Record<string, string>, method = 'GET', body?: string) {
    return new Promise<{status: number; body: string}>((resolveRequest, reject) => {
      const request = http.request({host: '127.0.0.1', port: fake.ports.browser, path, method, headers}, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolveRequest({status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8')}));
      });
      request.on('error', reject);
      request.end(body);
    });
  }
  const own = `127.0.0.1:${'PORT'}`;
  const host = (name: string) => name.replace('PORT', String(fake.ports.browser));

  it('answers a request for 127.0.0.1:<port> or localhost:<port>, whatever its case', async () => {
    for (const name of [own, 'localhost:PORT', 'LOCALHOST:PORT']) expect((await raw('/__control/health', {host: host(name)})).status, name).toBe(200);
  });

  it('refuses any other Host: a name that was rebound to this address, another port, no port, or another machine', async () => {
    for (const name of ['evil.example', 'evil.example:PORT', '127.0.0.1', 'localhost', '127.0.0.1:1', 'localhost:1', '[::1]:PORT', '10.0.0.5:PORT', '127.0.0.1.evil.example:PORT']) {
      const answer = await raw('/__control/health', {host: host(name)});
      expect(answer.status, name).toBe(403);
      expect(answer.body, name).not.toContain('"ok"');
    }
  });

  it('refuses the control API and the chooser to a request a web page on another site makes (Sec-Fetch-Site: cross-site)', async () => {
    const headers = {host: host(own), 'sec-fetch-site': 'cross-site'};
    expect((await raw('/__control/health', headers)).status).toBe(403);
    expect((await raw('/__control/accounts', headers, 'POST', JSON.stringify({email: 'rebound@example.test'}))).status).toBe(403);
    expect((await raw('/__control/requests', {...headers}, 'DELETE')).status).toBe(403);
    expect((await raw(`/o/oauth2/v2/auth?${new URLSearchParams({client_id: CLIENT, response_type: 'code', redirect_uri: CALLBACK})}`, headers)).status).toBe(403);
    // The account that request tried to add does not exist.
    const accounts = await raw(`/o/oauth2/v2/auth?${new URLSearchParams({client_id: CLIENT, response_type: 'code', redirect_uri: CALLBACK, prompt: 'select_account'})}`, {host: host(own)});
    expect(accounts.body).not.toContain('rebound@example.test');
  });

  it('answers the fetch metadata a browser sends on the way from Auth to the chooser (same-site), a typed address (none) and the tests\' own requests (none at all)', async () => {
    for (const site of ['same-site', 'same-origin', 'none']) expect((await raw('/__control/health', {host: host(own), 'sec-fetch-site': site})).status, site).toBe(200);
    expect((await raw('/__control/health', {host: host(own)})).status).toBe(200);
  });
});

describe('"the fake is active" means Auth really uses it (what the specs skip on)', () => {
  /** A stand-in for the stack's Auth: its authorize endpoint redirects wherever the test says. */
  async function stubAuth(redirectTo: () => string | null) {
    const server = http.createServer((request, response) => {
      const location = redirectTo();
      if (!request.url?.startsWith('/auth/v1/authorize') || !location) {
        response.writeHead(400);
        return response.end();
      }
      response.writeHead(302, {location});
      response.end();
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
    const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
    return {base, close: () => new Promise((resolveClose) => server.close(resolveClose))};
  }

  it('is true when the fake answers and Auth sends Google sign-in to the fake\'s chooser', async () => {
    const auth = await stubAuth(() => `${fake.browserBase}/o/oauth2/v2/auth?client_id=x`);
    try {
      expect(await fakeGoogleActive(auth.base, fake.browserBase)).toBe(true);
    } finally {
      await auth.close();
    }
  });

  it('is false when the fake still runs but Auth is a plain one that goes to the real Google (the stack was restarted)', async () => {
    const auth = await stubAuth(() => 'https://accounts.google.com/o/oauth2/v2/auth?client_id=real');
    try {
      expect(await fakeGoogleActive(auth.base, fake.browserBase)).toBe(false);
    } finally {
      await auth.close();
    }
  });

  it('is false when Auth cannot be reached, answers without a redirect, or the fake does not answer', async () => {
    expect(await fakeGoogleActive('http://127.0.0.1:1', fake.browserBase)).toBe(false);
    const noRedirect = await stubAuth(() => null);
    try {
      expect(await fakeGoogleActive(noRedirect.base, fake.browserBase)).toBe(false);
    } finally {
      await noRedirect.close();
    }
    const auth = await stubAuth(() => `${fake.browserBase}/o/oauth2/v2/auth?client_id=x`);
    try {
      expect(await fakeGoogleActive(auth.base, 'http://127.0.0.1:1')).toBe(false);
    } finally {
      await auth.close();
    }
  });

  it('is not fooled by a redirect that only starts like the fake\'s address', async () => {
    const auth = await stubAuth(() => `${fake.browserBase}.evil.example/o/oauth2/v2/auth`);
    try {
      expect(await fakeGoogleActive(auth.base, fake.browserBase)).toBe(false);
    } finally {
      await auth.close();
    }
  });
});

describe('the token endpoint and the keys', () => {
  it('exchanges a code once for an id_token that is signed with the published key and carries the account', async () => {
    const { code } = await codeFor('token@example.test', {nonce: 'n-123'});
    const response = await fetch(tokenUrl(), form({grant_type: 'authorization_code', code, redirect_uri: CALLBACK}));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {id_token: string; access_token: string; token_type: string};
    expect(body.token_type).toBe('Bearer');
    const claims = decode(body.id_token);
    expect(claims).toMatchObject({iss: 'https://accounts.google.com', aud: CLIENT, azp: CLIENT, sub: 'sub-token@example.test', email: 'token@example.test', email_verified: true, nonce: 'n-123'});
    expect(claims.exp - claims.iat).toBe(3600);
    expect(claims.at_hash).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const {keys} = (await (await fetch(`http://127.0.0.1:${fake.ports.token}/jwks`)).json()) as {keys: (Record<string, unknown> & {kid: string})[]};
    const header = JSON.parse(Buffer.from(body.id_token.split('.')[0], 'base64url').toString('utf8'));
    const jwk = keys.find((key) => key.kid === header.kid)!;
    expect(jwk).toBeDefined();
    const [head, payload, signature] = body.id_token.split('.');
    const verified = createVerify('sha256').update(`${head}.${payload}`).verify(createPublicKey({key: jwk as never, format: 'jwk'}), Buffer.from(signature, 'base64url'));
    expect(verified).toBe(true);
    expect(JSON.stringify(jwk)).not.toMatch(/"d"|"p"|"q"|"dp"|"dq"|"qi"/);

    // Single use, like Google.
    const again = await fetch(tokenUrl(), form({grant_type: 'authorization_code', code, redirect_uri: CALLBACK}));
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({error: 'invalid_grant'});
  });

  it('refuses an unknown code, another grant type, and a redirect address that is not the one the code was issued for', async () => {
    const { code } = await codeFor('refuse@example.test');
    expect((await fetch(tokenUrl(), form({grant_type: 'authorization_code', code: 'nope', redirect_uri: CALLBACK}))).status).toBe(400);
    expect((await fetch(tokenUrl(), form({grant_type: 'password', code, redirect_uri: CALLBACK}))).status).toBe(400);
    expect((await fetch(tokenUrl(), form({grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1:1/auth/v1/callback'}))).status).toBe(400);
  });

  it('reports an unverified address as unverified, so the application\'s own checks have something to refuse', async () => {
    await addAccount('unverified@example.test', {emailVerified: false});
    const url = authorizeUrl({prompt: 'select_account'});
    url.searchParams.set('__pick', 'unverified@example.test');
    const back = new URL((await get(url)).headers.get('location')!);
    const body = (await (await fetch(tokenUrl(), form({grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: CALLBACK}))).json()) as {id_token: string};
    expect(decode(body.id_token).email_verified).toBe(false);
  });

  it('serves nothing but the token endpoint and the keys to the container, and nothing of the control API', async () => {
    const container = (path: string) => fetch(`http://127.0.0.1:${fake.ports.token}${path}`);
    expect((await container('/__control/health')).status).toBe(404);
    expect((await container('/o/oauth2/v2/auth')).status).toBe(404);
    expect((await container('/__control/accounts')).status).toBe(404);
    expect((await control('/token')).status).toBe(404);
  });

  it('keeps the control API to valid input', async () => {
    expect((await control('/__control/accounts', {method: 'POST', body: 'not json'})).status).toBe(400);
    expect((await control('/__control/accounts', {method: 'POST', body: JSON.stringify({email: 'no-at-sign'})})).status).toBe(400);
    expect((await control('/__control/nothing')).status).toBe(404);
  });
});

describe('the discovery document, over TLS for accounts.google.com, through the tunnel', () => {
  const ca = () => readFileSync(fake.caPath);

  function discoveryDirect(options: {ca?: Buffer}) {
    return new Promise<{status: number; body: string}>((resolveRequest, reject) => {
      const request = https.request(
        {host: '127.0.0.1', port: fake.ports.tls, path: '/.well-known/openid-configuration', servername: 'accounts.google.com', headers: {host: 'accounts.google.com'}, ca: options.ca},
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolveRequest({status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8')}));
        },
      );
      request.on('error', reject);
      request.end();
    });
  }

  it('serves the discovery document to a client that trusts the throwaway CA', async () => {
    const { status, body } = await discoveryDirect({ca: ca()});
    expect(status).toBe(200);
    const document = JSON.parse(body);
    expect(document.issuer).toBe('https://accounts.google.com');
    expect(document.authorization_endpoint).toBe(`${fake.browserBase}/o/oauth2/v2/auth`);
    expect(document.token_endpoint).toBe(tokenUrl());
    expect(document.jwks_uri).toBe(`http://127.0.0.1:${fake.ports.token}/jwks`);
    expect(document.id_token_signing_alg_values_supported).toEqual(['RS256']);
  });

  it('is not trusted by anything else: a client without the CA refuses the certificate', async () => {
    await expect(discoveryDirect({})).rejects.toThrow(/certificate|self.signed|unable to verify/i);
  });

  it('is a certificate for accounts.google.com from a CA that expires in days', () => {
    const certificate = new X509Certificate(ca());
    expect(certificate.subject).toContain('nova3D fake Google test CA');
    expect(certificate.ca).toBe(true);
    expect(new Date(certificate.validTo).getTime() - Date.now()).toBeLessThan(3 * 86_400_000);
  });

  /** CONNECT through the tunnel, then a TLS handshake with the CA, the way Auth's HTTPS_PROXY does. */
  function connect(target: string) {
    return new Promise<{status: number; socket: import('node:net').Socket | null}>((resolveConnect, reject) => {
      const request = http.request({host: '127.0.0.1', port: fake.ports.tunnel, method: 'CONNECT', path: target});
      request.on('connect', (response, socket) => resolveConnect({status: response.statusCode ?? 0, socket}));
      request.on('response', (response) => resolveConnect({status: response.statusCode ?? 0, socket: null}));
      request.on('error', reject);
      request.end();
    });
  }

  it('tunnels accounts.google.com:443 to the TLS listener, and the handshake verifies against the CA', async () => {
    const {status, socket} = await connect('accounts.google.com:443');
    expect(status).toBe(200);
    const secure = tls.connect({socket: socket!, servername: 'accounts.google.com', ca: ca()});
    await new Promise<void>((resolveHandshake, reject) => {
      secure.once('secureConnect', () => resolveHandshake());
      secure.once('error', reject);
    });
    expect(secure.authorized).toBe(true);
    secure.destroy();
  });

  it('refuses a tunnel to any other host or port', async () => {
    for (const target of ['example.com:443', 'accounts.google.com:80', '127.0.0.1:5432', 'supabase_db:5432', 'accounts.google.com.evil.example:443']) {
      const {status} = await connect(target);
      expect(status, target).toBe(403);
    }
  });
});

describe('what it leaves behind', () => {
  it('publishes only the CA certificate and its own readiness; no key anywhere it writes', () => {
    expect(readdirSync(stateDir).sort()).toEqual(['ca.pem', 'ready.json']);
    expect(readFileSync(join(stateDir, 'ca.pem'), 'utf8')).toContain('BEGIN CERTIFICATE');
    for (const name of readdirSync(stateDir)) expect(readFileSync(join(stateDir, name), 'utf8'), name).not.toMatch(/PRIVATE KEY/);
    expect(statSync(join(stateDir, 'ready.json')).mode & 0o777).toBe(0o600);
  });

  it('is a program with no dependencies of its own: only Node built-ins and the openssl command', () => {
    const source = readFileSync(resolve(root, 'tests/support/fake-google.mjs'), 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(5);
    for (const specifier of imports) expect(specifier, specifier).toMatch(/^node:/);
    expect(source).not.toMatch(/require\(|import\(['"](?!node:)/);
  });

  it('puts no key or certificate in the repository: nothing the fake needs is a file, it is made at run time', () => {
    const scan = (directory: string): string[] =>
      readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        if (['node_modules', '.git', '.next', 'test-results', 'playwright-report', '.vercel', '_bmad', 'tools'].includes(entry.name)) return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return scan(path);
        if (/\.(pem|key|crt|cer|p12|pfx|jks)$/i.test(entry.name)) return [path];
        if (!/\.(ts|tsx|mjs|js|json|md|toml|yml|yaml|sql|sh|txt)$/.test(entry.name)) return [];
        // The provisioning scanner's own test carries the pattern it looks for, built piecewise.
        return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{40}/.test(readFileSync(path, 'utf8')) ? [path] : [];
      });
    expect(scan(root).map((path) => path.replace(`${root}/`, ''))).toEqual([]);
  });

  it('removes its private key material when it closes, and only its own', async () => {
    const second = mkdtempSync(join(root_, 'second-'));
    const { startFakeGoogle } = await loadModule();
    const running = await startFakeGoogle({stateDir: second, clientId: CLIENT, ports: await freePorts(), tempRoot, containerHost: '127.0.0.1'});
    const during = keyDirectories();
    expect(during).toHaveLength(2);
    await running.close();
    const after = keyDirectories();
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(during.find((name) => after.includes(name)));
    expect(existsSync(join(second, 'ca.pem'))).toBe(true);
  });

  it('removes its key material when it cannot start: no openssl, or a port that is taken', async () => {
    const { startFakeGoogle } = await loadModule();
    const before = keyDirectories().length;
    // No openssl command to find.
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(startFakeGoogle({stateDir: join(root_, 'no-openssl'), clientId: CLIENT, ports: await freePorts(), tempRoot, containerHost: '127.0.0.1'})).rejects.toThrow();
    } finally {
      process.env.PATH = path;
    }
    expect(keyDirectories()).toHaveLength(before);
    // A port that something else holds.
    const ports = await freePorts();
    const blocker = net.createServer();
    await new Promise<void>((resolveListen) => blocker.listen(ports.browser, '127.0.0.1', () => resolveListen()));
    try {
      await expect(startFakeGoogle({stateDir: join(root_, 'taken'), clientId: CLIENT, ports, tempRoot, containerHost: '127.0.0.1'})).rejects.toMatchObject({code: 'EADDRINUSE'});
    } finally {
      await new Promise((resolveClose) => blocker.close(resolveClose));
    }
    expect(keyDirectories()).toHaveLength(before);
  });
});

describe('run as a program (what `npm run fake-google:up` starts)', () => {
  it('stops on SIGTERM even while a client holds a tunnel open, and leaves no key material behind', async () => {
    const directory = mkdtempSync(join(root_, 'program-'));
    const programTemp = join(directory, 'tmp');
    mkdirSync(programTemp);
    const programKeys = () => readdirSync(programTemp).filter((name) => name.startsWith('nova3d-fake-google-keys-'));
    const ports = await freePorts();
    const child = spawn(
      process.execPath,
      [
        resolve(root, 'tests/support/fake-google.mjs'),
        '--state-dir', join(directory, 'state'),
        '--client-id', CLIENT,
        '--ports', [ports.browser, ports.token, ports.tunnel, ports.tls].join(','),
        '--temp-root', programTemp,
      ],
      {stdio: 'ignore'},
    );
    const ready = join(directory, 'state', 'ready.json');
    for (let waited = 0; waited < 10_000 && !existsSync(ready) && child.exitCode === null; waited += 50) await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(ready), 'the program started').toBe(true);
    expect(programKeys()).toHaveLength(1);

    // Auth keeps its tunnel open between requests; hold one.
    const held = await new Promise<net.Socket>((resolveConnect, reject) => {
      const request = http.request({host: '127.0.0.1', port: ports.tunnel, method: 'CONNECT', path: 'accounts.google.com:443'});
      request.on('connect', (_response, socket) => resolveConnect(socket));
      request.on('error', reject);
      request.end();
    });
    const exited = new Promise<number | null>((resolveExit) => child.once('exit', (code) => resolveExit(code)));
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    held.destroy();
    expect(programKeys()).toEqual([]);
  });
});
