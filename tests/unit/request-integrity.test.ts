import {createHash} from 'node:crypto';
import {beforeEach, describe, expect, it} from 'vitest';
import {csrfFetch, readCsrfToken, withCsrfToken} from '@/lib/csrf-client';
import {
  csrfCookieName,
  csrfCookieOptions,
  csrfHeaderName,
  decideOrigin,
  expectedHost,
  hashCsrfToken,
  isCsrfToken,
  isDocumentNavigation,
  isSafeMethod,
  isSecureRequest,
  newCsrfToken,
  originInputOf,
  type OriginInput,
} from '@/lib/request-integrity';

// Story 1.4c, the pure half: the origin decision, the token and its hash, what a page request is, and the
// browser helper that echoes the token. No network, no Next.js.

const own = 'app.example';
const post = (extra: Partial<OriginInput> = {}): OriginInput => ({method: 'POST', origin: `https://${own}`, host: own, forwardedHost: null, fetchSite: 'same-origin', ...extra});

describe('the origin decision', () => {
  it('lets a request from this application\'s own origin through', () => {
    expect(decideOrigin(post())).toEqual({allowed: true});
    expect(decideOrigin(post({fetchSite: 'same-site'}))).toEqual({allowed: true});
    expect(decideOrigin(post({fetchSite: null}))).toEqual({allowed: true});
    expect(decideOrigin(post({fetchSite: 'none'}))).toEqual({allowed: true});
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete', 'PROPFIND', 'TRACE'])('checks %s', (method) => {
    expect(decideOrigin(post({method, origin: 'https://evil.example'}))).toEqual({allowed: false, reason: 'origin_mismatch'});
  });

  it.each(['GET', 'HEAD', 'OPTIONS', 'get', 'head', 'options'])('does not check the safe method %s, whatever it carries', (method) => {
    expect(isSafeMethod(method)).toBe(true);
    for (const origin of [null, 'null', 'https://evil.example', '']) {
      expect(decideOrigin(post({method, origin, fetchSite: 'cross-site'})), `${method} ${origin}`).toEqual({allowed: true});
    }
  });

  it.each([
    ['another host', 'https://evil.example', 'origin_mismatch'],
    ['a host that only starts with ours', `https://${own}.evil.example`, 'origin_mismatch'],
    ['a host that only ends with ours', `https://evil-${own}`, 'origin_mismatch'],
    ['a subdomain of ours', `https://www.${own}`, 'origin_mismatch'],
    ['our host on another port', `https://${own}:8443`, 'origin_mismatch'],
    ['credentials in front of another host', `https://${own}@evil.example`, 'origin_mismatch'],
    ['the literal null', 'null', 'origin_null'],
    ['the literal null in any case', 'NULL', 'origin_null'],
    ['a missing Origin', null, 'origin_missing'],
    ['an empty Origin', '', 'origin_missing'],
    ['a blank Origin', '   ', 'origin_missing'],
    ['something that is not a URL', 'not a url', 'origin_invalid'],
    ['a bare host', own, 'origin_invalid'],
  ] as [string, string | null, string][])('refuses %s', (_name, origin, reason) => {
    expect(decideOrigin(post({origin}))).toEqual({allowed: false, reason});
  });

  it('refuses a cross-site fetch even when the Origin matches', () => {
    for (const fetchSite of ['cross-site', 'Cross-Site', ' cross-site ']) {
      expect(decideOrigin(post({fetchSite})), fetchSite).toEqual({allowed: false, reason: 'cross_site'});
    }
  });

  it('compares the host as a browser spells it: case and the default port do not matter', () => {
    expect(decideOrigin(post({origin: 'https://APP.example'}))).toEqual({allowed: true});
    expect(decideOrigin(post({origin: `https://${own}:443`}))).toEqual({allowed: true});
    expect(decideOrigin(post({origin: 'http://127.0.0.1:4173', host: '127.0.0.1:4173'}))).toEqual({allowed: true});
    expect(decideOrigin(post({origin: 'http://127.0.0.1:4174', host: '127.0.0.1:4173'}))).toEqual({allowed: false, reason: 'origin_mismatch'});
  });

  describe('default ports', () => {
    it.each([
      ['https', `https://${own}`, `${own}:443`],
      ['https, the Origin spelling the port', `https://${own}:443`, own],
      ['https, both spelling it', `https://${own}:443`, `${own}:443`],
      ['http', `http://${own}`, `${own}:80`],
      ['http, the Origin spelling the port', `http://${own}:80`, own],
      ['an IPv4 address', 'https://127.0.0.1', '127.0.0.1:443'],
      ['an IPv6 address', 'http://[::1]', '[::1]:80'],
      ['capitals', 'https://APP.example', 'App.Example:443'],
    ])('is the same host: %s', (_name, origin, host) => {
      expect(decideOrigin(post({origin, host}))).toEqual({allowed: true});
      expect(decideOrigin(post({origin, host: 'ignored.example', forwardedHost: host}))).toEqual({allowed: true});
    });

    it.each([
      ['https against :80', `https://${own}`, `${own}:80`],
      ['http against :443', `http://${own}`, `${own}:443`],
      ['https on 8443 against the default', `https://${own}:8443`, own],
      ['https on 8443 against 443', `https://${own}:8443`, `${own}:443`],
      ['the default against 8443', `https://${own}`, `${own}:8443`],
      ['one port against another', `https://${own}:8443`, `${own}:8444`],
      ['another host on the default port', 'https://evil.example', `${own}:443`],
      ['the port 4430 against 443', `https://${own}:4430`, `${own}:443`],
    ])('is not the same host: %s', (_name, origin, host) => {
      expect(decideOrigin(post({origin, host}))).toEqual({allowed: false, reason: 'origin_mismatch'});
    });

    it('does not compare the scheme: that is HSTS\'s to defend, as Next does not for Server Actions either', () => {
      expect(decideOrigin(post({origin: `http://${own}`, host: own}))).toEqual({allowed: true});
      expect(decideOrigin(post({origin: `https://${own}`, host: own}))).toEqual({allowed: true});
    });

    it.each(['app.example/path', 'app.example?x=1', 'app.example#x', 'user@app.example', 'user:pw@app.example', 'app example', 'app.example:notaport', 'app.example\\evil.example', '//app.example'])('cannot compare with a host that is not a bare host: %j', (host) => {
      expect(decideOrigin(post({host})).allowed, host).toBe(false);
    });
  });

  it('compares with the first x-forwarded-host, else host, as Next compares for Server Actions', () => {
    // A platform in front: the public name is forwarded, the internal one is `host`.
    expect(decideOrigin(post({host: 'internal.local:3000', forwardedHost: own}))).toEqual({allowed: true});
    expect(decideOrigin(post({origin: 'https://internal.local:3000', host: 'internal.local:3000', forwardedHost: own}))).toEqual({allowed: false, reason: 'origin_mismatch'});
    // A list: the first entry is the client-facing one.
    expect(decideOrigin(post({forwardedHost: `${own}, proxy.internal`}))).toEqual({allowed: true});
    expect(decideOrigin(post({forwardedHost: `proxy.internal, ${own}`}))).toEqual({allowed: false, reason: 'origin_mismatch'});
    // An empty forwarded header does not hide `host`.
    expect(decideOrigin(post({forwardedHost: ''}))).toEqual({allowed: true});
    expect(decideOrigin(post({forwardedHost: '  '}))).toEqual({allowed: true});
  });

  it('refuses when it cannot tell what its own host is', () => {
    expect(decideOrigin(post({host: null, forwardedHost: null}))).toEqual({allowed: false, reason: 'host_missing'});
    expect(decideOrigin(post({host: '', forwardedHost: ''}))).toEqual({allowed: false, reason: 'host_missing'});
  });

  it('reads its inputs from headers', () => {
    const headers = new Headers({origin: `https://${own}`, host: own, 'x-forwarded-host': 'a.example, b.example', 'sec-fetch-site': 'same-origin'});
    expect(originInputOf('POST', headers)).toEqual({method: 'POST', origin: `https://${own}`, host: own, forwardedHost: 'a.example, b.example', fetchSite: 'same-origin'});
    expect(expectedHost({host: own, forwardedHost: 'A.example, b.example'})).toBe('a.example');
    expect(expectedHost({host: 'Host.EXAMPLE', forwardedHost: null})).toBe('host.example');
    expect(expectedHost({host: null, forwardedHost: null})).toBeNull();
  });
});

describe('the token', () => {
  it('is 256 random bits as 43 URL-safe characters', () => {
    const token = newCsrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isCsrfToken(token)).toBe(true);
    // 32 bytes of the source, nothing added.
    const bytes = Uint8Array.from({length: 32}, (_value, index) => index);
    expect(Buffer.from(newCsrfToken(() => bytes), 'base64url')).toEqual(Buffer.from(bytes));
  });

  it('is new every time', () => {
    const tokens = new Set(Array.from({length: 200}, () => newCsrfToken()));
    expect(tokens.size).toBe(200);
  });

  it('refuses a random source that returns the wrong number of bytes', () => {
    expect(() => newCsrfToken(() => new Uint8Array(16))).toThrow();
  });

  it.each([undefined, null, 42, '', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)} `, `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`])('does not take %j for a token', (value) => {
    expect(isCsrfToken(value)).toBe(false);
  });

  it('is stored as the hex SHA-256 of the token under its domain label, and the token is not recoverable from it', async () => {
    const token = newCsrfToken();
    const hash = await hashCsrfToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(`nova3d/csrf-token/v1\0${token}`).digest('hex'));
    expect(hash).not.toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token);
    expect(await hashCsrfToken(token)).toBe(hash);
    expect(await hashCsrfToken(newCsrfToken())).not.toBe(hash);
  });

  it('will not hash what is not a token', async () => {
    await expect(hashCsrfToken('nope')).rejects.toThrow(TypeError);
    await expect(hashCsrfToken('')).rejects.toThrow(TypeError);
  });

  it('is carried in the agreed cookie and header', () => {
    expect(csrfCookieName).toBe('nova3d-csrf');
    expect(csrfHeaderName).toBe('x-csrf-token');
  });
});

describe('the cookie', () => {
  it('can be read by page script, is Lax, covers the whole site, and is Secure only on https', () => {
    expect(csrfCookieOptions(false)).toEqual({httpOnly: false, secure: false, sameSite: 'lax', path: '/'});
    expect(csrfCookieOptions(true)).toEqual({httpOnly: false, secure: true, sameSite: 'lax', path: '/'});
  });

  it('reads https from the first forwarded protocol, else from the request itself', () => {
    expect(isSecureRequest('https', 'http:')).toBe(true);
    expect(isSecureRequest('https, http', 'http:')).toBe(true);
    expect(isSecureRequest('HTTPS', 'http:')).toBe(true);
    expect(isSecureRequest('http', 'https:')).toBe(false);
    expect(isSecureRequest('http, https', 'https:')).toBe(false);
    expect(isSecureRequest(null, 'https:')).toBe(true);
    expect(isSecureRequest(null, 'http:')).toBe(false);
    expect(isSecureRequest('', 'https:')).toBe(true);
  });
});

describe('a page request', () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it('is a browser navigating to a document', () => {
    expect(isDocumentNavigation('GET', headers({'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate'}))).toBe(true);
    expect(isDocumentNavigation('get', headers({'sec-fetch-dest': 'document'}))).toBe(true);
  });

  it('is read from Accept in a browser that sends no fetch metadata', () => {
    expect(isDocumentNavigation('GET', headers({accept: 'text/html,application/xhtml+xml,*/*;q=0.8'}))).toBe(true);
    expect(isDocumentNavigation('GET', headers({accept: '*/*'}))).toBe(false);
    expect(isDocumentNavigation('GET', headers({}))).toBe(false);
  });

  it.each([
    ['a fetch', {'sec-fetch-dest': 'empty', accept: 'text/html'}],
    ['a frame', {'sec-fetch-dest': 'iframe', accept: 'text/html'}],
    ['an image', {'sec-fetch-dest': 'image'}],
    ['a client-side navigation', {'sec-fetch-dest': 'document', rsc: '1'}],
    ['a prefetch', {'sec-fetch-dest': 'document', 'next-router-prefetch': '1'}],
    ['a client-side navigation without fetch metadata', {accept: 'text/html', rsc: '1'}],
  ])('is not %s', (_name, init) => {
    expect(isDocumentNavigation('GET', headers(init))).toBe(false);
  });

  it.each([
    ['a Chrome prefetch', {'sec-purpose': 'prefetch'}],
    ['a Chrome prerender', {'sec-purpose': 'prefetch;prerender'}],
    ['a prerender alone', {'sec-purpose': 'prerender'}],
    ['a prefetch in any case', {'sec-purpose': 'Prefetch'}],
    ['an older prefetch', {purpose: 'prefetch'}],
    ['an older prefetch in any case', {purpose: 'Prefetch'}],
    ['a prefetch that sends only Accept', {'sec-fetch-dest': '', purpose: 'prefetch', accept: 'text/html'}],
  ])('is not %s: a page nobody has opened', (_name, extra) => {
    expect(isDocumentNavigation('GET', headers({'sec-fetch-dest': 'document', accept: 'text/html', ...extra}))).toBe(false);
    expect(isDocumentNavigation('GET', headers({accept: 'text/html', ...extra}))).toBe(false);
  });

  it('is still a page when the purpose says nothing about prefetching', () => {
    expect(isDocumentNavigation('GET', headers({'sec-fetch-dest': 'document', purpose: 'preview'}))).toBe(true);
    expect(isDocumentNavigation('GET', headers({'sec-fetch-dest': 'document', 'sec-purpose': ''}))).toBe(true);
  });

  it('is only a GET', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(isDocumentNavigation(method, headers({'sec-fetch-dest': 'document', accept: 'text/html'})), method).toBe(false);
    }
  });
});

describe('the browser helper', () => {
  const token = newCsrfToken();
  const other = newCsrfToken();

  it('reads the token out of a cookie string', () => {
    expect(readCsrfToken(`${csrfCookieName}=${token}`)).toBe(token);
    expect(readCsrfToken(`a=1; ${csrfCookieName}=${token}; b=2`)).toBe(token);
    expect(readCsrfToken(`a=1;${csrfCookieName}=${encodeURIComponent(token)}`)).toBe(token);
  });

  it('finds nothing when there is no token, or only things that are not one', () => {
    for (const cookie of ['', 'a=1; b=2', `${csrfCookieName}=`, `${csrfCookieName}=short`, `x${csrfCookieName}=${token}`, `${csrfCookieName}x=${token}`, `${csrfCookieName}=%E0%A4%A`, `other=${token}`]) {
      expect(readCsrfToken(cookie), cookie).toBeNull();
    }
  });

  it('reads every cookie of the name and returns the first that is shaped like a token', () => {
    // A stale or planted cookie of the same name (another path sorts first in a cookie string) does not hide the real one.
    expect(readCsrfToken(`${csrfCookieName}=short; ${csrfCookieName}=${token}`)).toBe(token);
    expect(readCsrfToken(`${csrfCookieName}=; ${csrfCookieName}=%E0%A4%A; ${csrfCookieName}=${token}`)).toBe(token);
    expect(readCsrfToken(`${csrfCookieName}=${'a'.repeat(44)}; a=1; ${csrfCookieName}=${token}; ${csrfCookieName}=${other}`)).toBe(token);
    expect(readCsrfToken(`${csrfCookieName}=${token}; ${csrfCookieName}=${other}`)).toBe(token);
    expect(readCsrfToken(`${csrfCookieName}=short; ${csrfCookieName}=also-short`)).toBeNull();
  });

  it('reads nothing outside a browser', () => {
    expect(typeof document).toBe('undefined');
    expect(readCsrfToken()).toBeNull();
  });

  it('adds the token to the request options and keeps what was there', () => {
    const init = withCsrfToken({method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'}, `${csrfCookieName}=${token}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(new Headers(init.headers).get(csrfHeaderName)).toBe(token);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('adds nothing when the browser has no token, so the server refuses it', () => {
    expect(new Headers(withCsrfToken({method: 'POST'}, '').headers).has(csrfHeaderName)).toBe(false);
  });

  describe('csrfFetch', () => {
    const page = {href: 'https://app.example/settings?x=1', origin: 'https://app.example', cookie: `a=1; ${csrfCookieName}=${token}`};
    const sent: {input: unknown; init: RequestInit}[] = [];
    const recorder = async (input: unknown, init: RequestInit = {}) => {
      sent.push({input, init});
      return new Response(null, {status: 204});
    };
    const send = (input: RequestInfo | URL, init?: RequestInit, extra: Partial<typeof page> = {}) => csrfFetch(input, init, {...page, ...extra, fetch: recorder as typeof fetch});
    beforeEach(() => {
      sent.length = 0;
    });

    it('sends a same-origin request with the token header and same-origin credentials, however the address is written', async () => {
      for (const target of ['/api/kit/mutation', 'api/kit/mutation', '//app.example/api/kit/mutation', 'https://app.example/api/kit/mutation', 'https://APP.example:443/api/kit/mutation', new URL('https://app.example/api/kit/mutation')]) {
        sent.length = 0;
        await send(target, {method: 'POST'});
        expect(sent, String(target)).toHaveLength(1);
        expect(sent[0].init.method).toBe('POST');
        expect(sent[0].init.credentials).toBe('same-origin');
        expect(new Headers(sent[0].init.headers).get(csrfHeaderName), String(target)).toBe(token);
      }
    });

    it('sends NOTHING to another origin, and rejects with a TypeError: the token is readable by script and must go nowhere else', async () => {
      for (const target of [
        'https://evil.example/api/kit/mutation',
        'http://app.example/api/kit/mutation',
        'https://app.example:8443/api/kit/mutation',
        'https://app.example.evil.example/api',
        'https://evil.example@app.example.evil.example/',
        '//evil.example/api',
        'https://sub.app.example/api',
        new URL('https://evil.example/api'),
        new Request('https://evil.example/api', {method: 'POST'}),
      ]) {
        await expect(send(target, {method: 'POST'}), String(target instanceof Request ? target.url : target)).rejects.toBeInstanceOf(TypeError);
      }
      expect(sent).toEqual([]);
    });

    it('sends nothing for an address it cannot read', async () => {
      await expect(send('http://[', {method: 'POST'})).rejects.toBeInstanceOf(TypeError);
      expect(sent).toEqual([]);
    });

    it('resolves a relative address against the page it is on, not against the site root', async () => {
      await expect(send('../api', {method: 'POST'}, {href: 'https://app.example/a/b/c', origin: 'https://app.example'})).resolves.toBeInstanceOf(Response);
      // A page on another origin would send to that origin: the relative address follows the page, and the page's origin is the page's.
      await expect(send('/api', {method: 'POST'}, {href: 'https://other.example/x', origin: 'https://app.example'})).rejects.toBeInstanceOf(TypeError);
      expect(sent).toHaveLength(1);
    });

    it('keeps the headers of a Request it is given, and lets init.headers win over them', async () => {
      const request = new Request('https://app.example/api/kit/mutation', {method: 'POST', headers: {'content-type': 'application/json', 'x-keep': 'request', 'x-both': 'request'}});
      await send(request, {headers: {'x-both': 'init', 'x-new': 'init'}});
      const headers = new Headers(sent[0].init.headers);
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('x-keep')).toBe('request');
      expect(headers.get('x-both')).toBe('init');
      expect(headers.get('x-new')).toBe('init');
      expect(headers.get(csrfHeaderName)).toBe(token);
      // The Request itself is what is sent.
      expect(sent[0].input).toBe(request);
    });

    it('does not let a header of the caller replace the token, and does not invent one', async () => {
      await send('/api', {headers: {[csrfHeaderName]: 'forged'}});
      expect(new Headers(sent[0].init.headers).get(csrfHeaderName)).toBe(token);
      sent.length = 0;
      await send('/api', {}, {cookie: 'a=1'});
      expect(new Headers(sent[0].init.headers).has(csrfHeaderName)).toBe(false);
    });

    it('reads the token from every cookie of the name, as the plain reader does', async () => {
      await send('/api', {}, {cookie: `${csrfCookieName}=short; ${csrfCookieName}=${other}`});
      expect(new Headers(sent[0].init.headers).get(csrfHeaderName)).toBe(other);
    });

    it('needs a page: outside one it sends nothing', async () => {
      expect(typeof location).toBe('undefined');
      await expect(csrfFetch('/api')).rejects.toBeInstanceOf(TypeError);
    });

    it('uses the page\'s own location and cookie, and the global fetch, when it is given none', async () => {
      const original = globalThis.fetch;
      globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        sent.push({input, init: init ?? {}});
        return new Response(null, {status: 204});
      }) as typeof fetch;
      const location = Object.getOwnPropertyDescriptor(globalThis, 'location');
      const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
      Object.defineProperty(globalThis, 'location', {value: {href: 'https://app.example/settings', origin: 'https://app.example'}, configurable: true});
      Object.defineProperty(globalThis, 'document', {value: {cookie: `${csrfCookieName}=${token}`}, configurable: true});
      try {
        await csrfFetch('/api/kit/mutation', {method: 'POST'});
        await expect(csrfFetch('https://evil.example/api', {method: 'POST'})).rejects.toBeInstanceOf(TypeError);
      } finally {
        globalThis.fetch = original;
        for (const [name, descriptor] of [['location', location], ['document', document]] as const) {
          if (descriptor) Object.defineProperty(globalThis, name, descriptor);
          else delete (globalThis as Record<string, unknown>)[name];
        }
      }
      expect(sent).toHaveLength(1);
      expect(sent[0].init.credentials).toBe('same-origin');
      expect(new Headers(sent[0].init.headers).get(csrfHeaderName)).toBe(token);
    });
  });
});
