#!/usr/bin/env node
// A fake Google for the LOCAL stack's browser tests (Story 1.4b). Test support, never part of the application.
//
// Why it exists: the step-up has to be tested with a real second sign-in (a new Auth session, a real
// `auth.mfa_amr_claims` row, the callback's code exchange), and the local stack cannot reach Google. Supabase
// Auth (GoTrue) ignores a configured provider URL for Google: it reads Google's OpenID discovery document from
// https://accounts.google.com, verifies a signed id_token, and takes the authorization endpoint from the
// document. So this process stands in for Google at three places, and a script (scripts/fake-google-stack.mjs)
// swaps the stack's Auth container so that its Google traffic goes here and nowhere else:
//
//   BROWSER  http://127.0.0.1:<port>          the account chooser (the authorization endpoint) and a small
//                                              control API for tests. Loopback only, and it answers a request only
//                                              if its Host is 127.0.0.1:<port> or localhost:<port> and it is not
//                                              marked Sec-Fetch-Site: cross-site, so a web page (or a DNS-rebound
//                                              name) cannot drive the control API from the person's browser.
//   TOKEN    http://0.0.0.0:<port+1>          the token endpoint and the signing keys, which Auth calls from its
//                                              container as http://host.docker.internal:<port+1>. Only these two.
//   TUNNEL   http://0.0.0.0:<port+2>          an HTTP CONNECT proxy that Auth's HTTPS_PROXY points at. It tunnels
//                                              accounts.google.com:443 to the TLS listener and refuses everything else.
//
// TOKEN and TUNNEL bind every interface, because the Auth container reaches the host over Docker's bridge and no
// single address is the same on every machine. What they offer there is a token endpoint that needs a one-time
// 128-bit code, a public key set, and a tunnel that goes to one name; the chooser and the control API are not on them.
//   TLS      https://127.0.0.1:<port+3>       the discovery document, with a certificate for accounts.google.com
//                                              that a throwaway CA signed.
//
// Dependency-free (Node built-ins and the openssl command). Nothing in the repository is a key or a certificate:
// the CA, the leaf key and the id_token signing key are generated here, at run time, in a private temporary
// directory (mode 0700) that is removed when the process ends; the CA's own key is deleted as soon as the leaf is
// signed. The fake answers one account chooser behaviour like Google's: `prompt=select_account` (or `login`)
// always shows the chooser, otherwise a browser that already chose an account is passed straight through.
//
//   node tests/support/fake-google.mjs --state-dir <dir> --client-id <id>
//
// It writes <dir>/ready.json when it is serving and <dir>/ca.pem for the Auth container to trust.
import {execFileSync} from 'node:child_process';
import {createHash, generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const defaultPort = 9099;

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

const b64u = (value) => Buffer.from(value).toString('base64url');
const isLoopback = (address) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
const json = (response, status, body) => {
  response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store'});
  response.end(JSON.stringify(body));
};
const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        request.destroy();
        reject(new Error('body too large'));
      } else chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

/** Makes a CA and a leaf certificate for accounts.google.com with the openssl command, in `directory`. Deletes the CA key. */
function makeCertificates(directory) {
  const run = (args) => execFileSync('openssl', args, {cwd: directory, stdio: ['ignore', 'ignore', 'pipe']});
  writeFileSync(join(directory, 'leaf.ext'), 'subjectAltName=DNS:accounts.google.com\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n');
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=nova3D fake Google test CA',
       '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=accounts.google.com']);
  run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.ext']);
  rmSync(join(directory, 'ca.key'));
  chmodSync(join(directory, 'ca.pem'), 0o644);
}

/**
 * Starts the fake. Returns the listening servers, what the other processes need to know, and `close()`.
 * `stateDir` is where the CA certificate is published; `containerHost` is how Auth's container names the host.
 */
export async function startFakeGoogle({stateDir, clientId, port = defaultPort, ports, tempRoot = tmpdir(), containerHost = 'host.docker.internal', log = () => undefined}) {
  if (!clientId) throw new Error('clientId is required');
  // `ports` names all four explicitly (tests ask the operating system for free ones); otherwise `port` and the next three.
  const browserPort = ports?.browser ?? port;
  const tokenPort = ports?.token ?? port + 1;
  const tunnelPort = ports?.tunnel ?? port + 2;
  const tlsPort = ports?.tls ?? port + 3;
  const browserBase = `http://127.0.0.1:${browserPort}`;

  // Private working directory for the key material; the CA certificate alone is copied to stateDir. If anything
  // here fails (openssl missing, the leaf step failing), the directory is removed before the error goes on.
  const secrets = mkdtempSync(join(tempRoot, 'nova3d-fake-google-keys-'));
  try {
    chmodSync(secrets, 0o700);
    makeCertificates(secrets);
    mkdirSync(stateDir, {recursive: true, mode: 0o700});
    copyFileSync(join(secrets, 'ca.pem'), join(stateDir, 'ca.pem'));
    chmodSync(join(stateDir, 'ca.pem'), 0o644);
  } catch (error) {
    rmSync(secrets, {recursive: true, force: true});
    throw error;
  }

  // The key the id_tokens are signed with, and published at /jwks.
  const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const kid = `fake-google-${randomBytes(4).toString('hex')}`;
  const jwk = {...publicKey.export({format: 'jwk'}), kid, alg: 'RS256', use: 'sig'};
  const signJwt = (claims) => {
    const unsigned = `${b64u(JSON.stringify({alg: 'RS256', typ: 'JWT', kid}))}.${b64u(JSON.stringify(claims))}`;
    return `${unsigned}.${b64u(sign('sha256', Buffer.from(unsigned), privateKey))}`;
  };

  const accounts = new Map(); // email -> {sub, email, email_verified, name}
  const codes = new Map(); // code -> {account, redirectUri, nonce, entry}
  const requests = []; // the authorization requests, for tests to read what the application asked Google for
  const counters = {discovery: 0, tokens: 0, keys: 0};

  const discovery = () => ({
    issuer: 'https://accounts.google.com',
    authorization_endpoint: `${browserBase}/o/oauth2/v2/auth`,
    token_endpoint: `http://${containerHost}:${tokenPort}/token`,
    jwks_uri: `http://${containerHost}:${tokenPort}/jwks`,
    userinfo_endpoint: `http://${containerHost}:${tokenPort}/userinfo`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'email', 'profile'],
  });

  function approve(response, query, account, entry) {
    const redirect = query.get('redirect_uri');
    const code = randomBytes(16).toString('hex');
    codes.set(code, {account, redirectUri: redirect, nonce: query.get('nonce'), entry});
    entry.picked = account.email;
    const back = new URL(redirect);
    back.searchParams.set('code', code);
    if (query.get('state')) back.searchParams.set('state', query.get('state'));
    response.writeHead(302, {location: back.toString(), 'set-cookie': `fake_google_account=${encodeURIComponent(account.email)}; Path=/; HttpOnly; SameSite=Lax`, 'cache-control': 'no-store'});
    response.end();
  }

  function authorize(request, response, url) {
    const query = url.searchParams;
    const redirect = query.get('redirect_uri') ?? '';
    // Only Auth's own callback on this machine is a place a code may be sent.
    if (query.get('client_id') !== clientId || query.get('response_type') !== 'code' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/auth\/v1\/callback$/.test(redirect)) {
      response.writeHead(400, {'content-type': 'text/plain'});
      return response.end('bad client_id, response_type or redirect_uri');
    }
    const prompts = (query.get('prompt') ?? '').split(/\s+/).filter(Boolean);
    const existing = requests.find((candidate) => candidate.state === query.get('state'));
    const entry = existing ?? {state: query.get('state'), prompt: query.get('prompt'), loginHint: query.get('login_hint'), picked: null, chooser: false};
    if (!existing) requests.push(entry);

    const pick = query.get('__pick');
    if (pick) {
      const account = accounts.get(pick);
      if (!account) {
        response.writeHead(400, {'content-type': 'text/plain'});
        return response.end('no such account');
      }
      return approve(response, query, account, entry);
    }
    const cookie = /(?:^|;\s*)fake_google_account=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
    let hinted = query.get('login_hint') ?? cookie ?? '';
    try {
      hinted = cookie && !query.get('login_hint') ? decodeURIComponent(cookie) : hinted;
    } catch {
      hinted = '';
    }
    const remembered = accounts.get(hinted);
    if (remembered && !prompts.includes('select_account') && !prompts.includes('login')) return approve(response, query, remembered, entry);

    entry.chooser = true;
    const items = [...accounts.values()]
      .map((account) => {
        const next = new URL(url);
        next.searchParams.set('__pick', account.email);
        return `<li><a data-account="${escapeHtml(account.email)}" href="${escapeHtml(next.pathname + next.search)}">${escapeHtml(account.name)} (${escapeHtml(account.email)})</a></li>`;
      })
      .join('');
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
    response.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>Fake Google: choose an account</title></head><body><main><h1>Choose an account</h1>` +
        `<p>to continue to nova3D (a stand-in for Google, for tests)</p><p data-prompt>${escapeHtml(query.get('prompt') ?? '')}</p><ul>${items}</ul></main></body></html>`,
    );
  }

  async function token(request, response) {
    let form;
    try {
      form = new URLSearchParams(await readBody(request));
    } catch {
      return json(response, 400, {error: 'invalid_request'});
    }
    counters.tokens += 1;
    const entry = codes.get(form.get('code') ?? '');
    if (!entry || form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== entry.redirectUri) {
      return json(response, 400, {error: 'invalid_grant'});
    }
    codes.delete(form.get('code')); // one use, like Google
    const {account} = entry;
    const accessToken = `ya29.fake-${randomBytes(12).toString('hex')}`;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: 'https://accounts.google.com',
      azp: clientId,
      aud: clientId,
      sub: account.sub,
      email: account.email,
      email_verified: account.email_verified,
      name: account.name,
      picture: 'https://example.test/picture.png',
      at_hash: b64u(createHash('sha256').update(accessToken).digest().subarray(0, 16)),
      iat: now,
      exp: now + 3600,
      ...(entry.nonce ? {nonce: entry.nonce} : {}),
    };
    json(response, 200, {access_token: accessToken, expires_in: 3599, token_type: 'Bearer', scope: 'openid email profile', id_token: signJwt(claims)});
  }

  async function control(request, response, url) {
    if (url.pathname === '/__control/health') return json(response, 200, {ok: true, discoveryFetches: counters.discovery, tokenExchanges: counters.tokens, keyFetches: counters.keys});
    if (url.pathname === '/__control/accounts' && request.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(request));
      } catch {
        return json(response, 400, {error: 'invalid_json'});
      }
      if (typeof body?.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(body.email)) return json(response, 400, {error: 'invalid_email'});
      const sub = typeof body.sub === 'string' && body.sub ? body.sub : String(BigInt(`0x${randomBytes(8).toString('hex')}`)).slice(0, 21).padEnd(21, '1');
      accounts.set(body.email, {sub, email: body.email, email_verified: body.emailVerified !== false, name: typeof body.name === 'string' && body.name ? body.name : body.email.split('@')[0]});
      return json(response, 201, {ok: true, sub});
    }
    if (url.pathname === '/__control/requests') {
      if (request.method === 'DELETE') {
        requests.length = 0;
        return json(response, 200, {ok: true});
      }
      return json(response, 200, requests);
    }
    return json(response, 404, {error: 'not_found'});
  }

  // BROWSER and control: loopback only.
  const allowedHosts = new Set([`127.0.0.1:${browserPort}`, `localhost:${browserPort}`]);
  const browserServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', browserBase);
      // Loopback peers only, naming this server by one of its own addresses (a rebound DNS name is neither), and
      // never a request a web page on another site makes (the browser says so in Sec-Fetch-Site).
      if (!isLoopback(request.socket.remoteAddress ?? '') || !allowedHosts.has(String(request.headers.host ?? '').toLowerCase()) || request.headers['sec-fetch-site'] === 'cross-site') {
        response.writeHead(403, {'content-type': 'text/plain'});
        return response.end('forbidden');
      }
      if (url.pathname === '/o/oauth2/v2/auth') return authorize(request, response, url);
      if (url.pathname.startsWith('/__control/')) return await control(request, response, url);
      json(response, 404, {error: 'not_found'});
    } catch (error) {
      log('browser listener error', error instanceof Error ? error.name : 'unknown');
      if (!response.headersSent) json(response, 500, {error: 'server_error'});
    }
  });

  // TOKEN and keys: reachable from Auth's container. Nothing else is served here.
  const tokenServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${containerHost}:${tokenPort}`);
      if (url.pathname === '/token' && request.method === 'POST') return await token(request, response);
      if (url.pathname === '/jwks') {
        counters.keys += 1;
        return json(response, 200, {keys: [jwk]});
      }
      json(response, 404, {error: 'not_found'});
    } catch (error) {
      log('token listener error', error instanceof Error ? error.name : 'unknown');
      if (!response.headersSent) json(response, 500, {error: 'server_error'});
    }
  });

  // TUNNEL: accounts.google.com:443 and nothing else.
  const tunnelServer = http.createServer((request, response) => {
    response.writeHead(405);
    response.end();
  });
  tunnelServer.on('connect', (request, socket, head) => {
    if (request.url !== 'accounts.google.com:443') {
      log('tunnel refused a CONNECT to somewhere else');
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = net.connect(tlsPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });

  // TLS: the discovery document, under a certificate for accounts.google.com.
  const tlsServer = https.createServer({key: readFileSync(join(secrets, 'leaf.key')), cert: readFileSync(join(secrets, 'leaf.pem'))}, (request, response) => {
    if (request.url === '/.well-known/openid-configuration') {
      counters.discovery += 1;
      return json(response, 200, discovery());
    }
    json(response, 404, {error: 'not_found'});
  });

  const listen = (server, listenPort, host) =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(listenPort, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  const servers = [browserServer, tokenServer, tunnelServer, tlsServer];
  // Every open connection, tunnelled ones included (a CONNECT leaves the HTTP server's own bookkeeping, and Auth
  // keeps its tunnel open), so that closing never waits for a client that has no reason to hang up.
  const sockets = new Set();
  for (const server of servers) {
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
  }
  const close = async () => {
    // The key material first, synchronously: whatever else goes wrong while closing, it does not outlive this call.
    rmSync(secrets, {recursive: true, force: true});
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map((server) => new Promise((resolve) => (server.listening ? server.close(() => resolve()) : resolve()))));
  };
  try {
    await listen(browserServer, browserPort, '127.0.0.1');
    await listen(tokenServer, tokenPort, '0.0.0.0');
    await listen(tunnelServer, tunnelPort, '0.0.0.0');
    await listen(tlsServer, tlsPort, '127.0.0.1');
  } catch (error) {
    await close();
    throw error;
  }

  const info = {browserBase, ports: {browser: browserPort, token: tokenPort, tunnel: tunnelPort, tls: tlsPort}, clientId, containerHost, caPath: join(stateDir, 'ca.pem')};
  writeFileSync(join(stateDir, 'ready.json'), JSON.stringify({...info, pid: process.pid}, null, 2), {mode: 0o600});
  return {...info, accounts, requests, close};
}

// Run as a program.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stateDir = argument('state-dir');
  const clientId = argument('client-id');
  const port = Number(argument('port') ?? defaultPort);
  // Tests give the four ports explicitly (`--ports browser,token,tunnel,tls`, found free) and a temporary root of their own.
  const explicit = argument('ports')?.split(',').map(Number);
  const ports = explicit?.length === 4 ? {browser: explicit[0], token: explicit[1], tunnel: explicit[2], tls: explicit[3]} : undefined;
  if (!stateDir || !clientId) {
    console.error('Usage: node tests/support/fake-google.mjs --state-dir <dir> --client-id <id> [--port <port>]');
    process.exit(2);
  }
  try {
    const fake = await startFakeGoogle({
      stateDir,
      clientId,
      port,
      ports,
      tempRoot: argument('temp-root') ?? undefined,
      containerHost: argument('container-host') ?? undefined,
      log: (...args) => console.log(new Date().toISOString(), ...args),
    });
    console.log(new Date().toISOString(), `fake Google serving: browser ${fake.browserBase}, token :${fake.ports.token}, tunnel :${fake.ports.tunnel}, tls :${fake.ports.tls}`);
    const stop = async () => {
      // Never hang on the way out: the key material is already gone when close() starts waiting.
      setTimeout(() => process.exit(0), 3000).unref();
      await fake.close();
      process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch (error) {
    console.error('The fake Google could not start:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
