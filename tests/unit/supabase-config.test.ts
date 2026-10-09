import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

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

  it('allows only the local app callbacks', () => {
    const urls = text.match(/additional_redirect_urls\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect([...urls.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([
      'http://127.0.0.1:3000/auth/callback',
      'http://localhost:3000/auth/callback',
    ]);
  });
});
