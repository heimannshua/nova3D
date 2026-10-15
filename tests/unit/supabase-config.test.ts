import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {authDeclarationProblems, otherProviders, web3Methods} from '../../scripts/config-toml.mjs';

const text = readFileSync(resolve(import.meta.dirname, '../../supabase/config.toml'), 'utf8');

/** The raw `key = value` text of one section (`[auth.sessions]`), comments stripped. */
function section(name: string) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start < 0) return {};
  const values: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    const match = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

describe('supabase/config.toml', () => {
  it('keeps the local ports', () => {
    expect(section('api').port).toBe('54321');
    expect(section('db').port).toBe('54322');
  });

  it('exposes the lifecycle schema to the server', () => {
    expect(section('api').schemas).toContain('"lifecycle"');
  });

  it('exposes the api schema, the only callable surface, and never the tables behind it', () => {
    const schemas = section('api').schemas;
    expect(schemas).toContain('"api"');
    expect(schemas).not.toContain('"identity"');
    expect(schemas).not.toContain('"projects"');
  });

  it('runs the Before User Created hook in the database and enables nothing else', () => {
    const hook = section('auth.hook.before_user_created');
    expect(hook.enabled).toBe('true');
    expect(hook.uri).toBe('"pg-functions://postgres/api/before_user_created"');
    expect([...text.matchAll(/^\[auth\.hook\.([a-z_]+)\]/gm)].map((match) => match[1])).toEqual(['before_user_created']);
  });

  it('allows files up to 100MiB', () => {
    expect(section('storage').file_size_limit).toBe('"100MiB"');
  });

  it('declares Google as the only credential, with sign-ups on', () => {
    const auth = section('auth');
    expect(auth.enable_signup).toBe('true');
    expect(auth.enable_anonymous_sign_ins).toBe('false');
    expect(section('auth.email').enable_signup).toBe('false');
    expect(section('auth.sms').enable_signup).toBe('false');
    expect(section('auth.external.google').enabled).toBe('true');
  });

  it('reads the Google client from the environment, never from the file', () => {
    const google = section('auth.external.google');
    expect(google.client_id).toBe('"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"');
    expect(google.secret).toBe('"env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"');
  });

  it('time-boxes sessions at 30 days with a 7-day inactivity timeout', () => {
    const sessions = section('auth.sessions');
    expect(sessions.timebox).toBe('"720h"');
    expect(sessions.inactivity_timeout).toBe('"168h"');
  });

  it('expires one-time codes in 15 minutes', () => {
    expect(section('auth.email').otp_expiry).toBe('900');
  });

  it('points Google at Google: no provider URL override, and nothing of the browser tests\' fake Google in the declared settings', () => {
    // The fake Google (Story 1.4b) is wired into the running stack's Auth container by a script; the file that is
    // pushed to and diffed against hosted projects never mentions it.
    expect(section('auth.external.google')).not.toHaveProperty('url');
    expect(section('auth.external.google').skip_nonce_check).toBe('false');
    expect(text).not.toMatch(/4173|4174|host\.docker\.internal|accounts\.google\.com|fake/i);
  });

  // Story 1.9: `supabase config diff` compares only what the file declares, so every sign-in method is declared, and only Google is on.
  it('declares every external provider the CLI knows, and enables only Google', () => {
    const declared = [...text.matchAll(/^\[auth\.external\.([a-z0-9_]+)\]/gm)].map((match) => match[1]);
    expect(declared.sort()).toEqual(['google', ...otherProviders].sort());
    expect(new Set(declared).size).toBe(declared.length);
    for (const provider of otherProviders) expect(section(`auth.external.${provider}`).enabled, provider).toBe('false');
    expect(section('auth.external.google').enabled).toBe('true');
    const enabled = [...text.matchAll(/^\[(auth\.[a-z0-9_.]+)\]\s*\n(?:[^\n[]*\n)*?enabled = true/gm)].map((match) => match[1]);
    expect(enabled.sort()).toEqual(['auth.external.google', 'auth.hook.before_user_created']);
  });

  it('declares the other sign-in methods off: email, SMS, anonymous, Web3', () => {
    expect(section('auth').enable_anonymous_sign_ins).toBe('false');
    expect(section('auth.email').enable_signup).toBe('false');
    expect(section('auth.sms').enable_signup).toBe('false');
    for (const method of web3Methods) expect(section(`auth.web3.${method}`).enabled, method).toBe('false');
    expect([...text.matchAll(/^\[auth\.web3\.([a-z]+)\]/gm)].map((match) => match[1]).sort()).toEqual([...web3Methods].sort());
  });

  it('declares the sign-up setting, the site URL, the redirect URLs and the one-time-code expiry, so a diff can see them', () => {
    expect(section('auth').enable_signup).toBe('true');
    expect(section('auth').site_url).toBe('"http://127.0.0.1:3000"');
    expect(text).toMatch(/additional_redirect_urls\s*=\s*\[/);
    expect(section('auth.email').otp_expiry).toBe('900');
    // ... and the static check agrees: nothing is missing.
    expect(authDeclarationProblems(text)).toEqual([]);
  });

  it('allows only the local app callbacks', () => {
    const urls = text.match(/additional_redirect_urls\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect([...urls.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([
      'http://127.0.0.1:3000/auth/callback',
      'http://localhost:3000/auth/callback',
    ]);
  });
});
