import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {readSections, stringList, stringValue} from '../../scripts/config-toml.mjs';
import {stagingConfigText, stagingSiteOrigin, writeStagingConfig} from '../../scripts/staging-config.mjs';

// Story 1.9. The staging workflow diffs the live Auth settings against a scratch copy of supabase/config.toml whose site URL and
// callback come from STAGING_SITE_URL. The committed file stays loopback: it is also the local stack's configuration.
const root = resolve(import.meta.dirname, '../..');
const committedPath = resolve(root, 'supabase/config.toml');
const committed = readFileSync(committedPath, 'utf8');
const script = resolve(root, 'scripts/staging-config.mjs');
const temp = mkdtempSync(join(tmpdir(), 'nova3d-staging-config-'));
afterAll(() => rmSync(temp, {recursive: true, force: true}));

describe('stagingSiteOrigin', () => {
  it('accepts the https origin of a deployment, with or without a trailing slash, in any case', () => {
    expect(stagingSiteOrigin('https://nova3d-staging.vercel.app')).toBe('https://nova3d-staging.vercel.app');
    expect(stagingSiteOrigin('https://nova3d-staging.vercel.app/')).toBe('https://nova3d-staging.vercel.app');
    expect(stagingSiteOrigin('  HTTPS://Staging.Example.com ')).toBe('https://staging.example.com');
  });

  const refused: Array<[string, string, RegExp]> = [
    ['nothing', '', /is not set/],
    ['not a URL', 'not a url', /is not a URL/],
    ['plain http', 'http://nova3d-staging.vercel.app', /must be an https URL/],
    ['a loopback name', 'https://localhost', /loopback or local-network name/],
    ['a name under localhost', 'https://app.localhost', /loopback or local-network name/],
    ['a name with no dot', 'https://staging', /loopback or local-network name/],
    ['a .local name', 'https://nova3d.local', /loopback or local-network name/],
    ['a .lan name', 'https://nova3d.lan', /loopback or local-network name/],
    ['a .internal name', 'https://nova3d.internal', /loopback or local-network name/],
    ['loopback by address', 'https://127.0.0.1', /not an IP address/],
    ['loopback shorthand', 'https://127.1', /not an IP address/],
    ['loopback in hex', 'https://0x7f.0.0.1', /not an IP address/],
    ['loopback as an integer', 'https://2130706433', /not an IP address/],
    ['a LAN address', 'https://192.168.1.20', /not an IP address/],
    ['a private address', 'https://10.0.0.5', /not an IP address/],
    ['a link-local address', 'https://169.254.169.254', /not an IP address/],
    ['IPv6 loopback', 'https://[::1]', /not an IP address/],
    ['a port', 'https://nova3d-staging.vercel.app:8443', /must not name a port/],
    ['credentials', 'https://user:pass@nova3d-staging.vercel.app', /must not hold credentials/],
    ['a path', 'https://nova3d-staging.vercel.app/auth/callback', /no path, query or fragment/],
    ['a query', 'https://nova3d-staging.vercel.app/?x=1', /no path, query or fragment/],
    ['a fragment', 'https://nova3d-staging.vercel.app/#x', /no path, query or fragment/],
  ];
  it.each(refused)('refuses %s', (_label, value, message) => {
    expect(() => stagingSiteOrigin(value)).toThrow(message);
  });

  it('never repeats the value in its message', () => {
    for (const [, value] of refused) {
      if (!value.trim()) continue;
      let message = '';
      try {
        stagingSiteOrigin(value);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, value).not.toBe('');
      expect(message, value).not.toContain(value);
    }
    expect(() => stagingSiteOrigin(undefined as unknown as string)).toThrow(/is not set/);
  });
});

describe('stagingConfigText', () => {
  const origin = 'https://nova3d-staging.vercel.app';
  const text = stagingConfigText(committed, origin);
  const parsed = readSections(text);

  it('sets the site URL and the one callback, and nothing else of the redirect list', () => {
    expect(stringValue(parsed, 'auth', 'site_url')).toBe(origin);
    expect(stringList(parsed, 'auth', 'additional_redirect_urls')).toEqual([`${origin}/auth/callback`]);
  });

  it('holds no loopback or local address anywhere', () => {
    expect(text).not.toMatch(/127\.0\.0\.1|localhost/);
  });

  it('changes nothing else: every other line of the committed file is still there, in order', () => {
    const before = committed.split('\n').filter((line) => !/^\s*(?:site_url|additional_redirect_urls)\s*=|^\s*"http:\/\/(?:127\.0\.0\.1|localhost):3000\/auth\/callback",$|^\]$/.test(line));
    const after = text.split('\n').filter((line) => !/^\s*(?:site_url|additional_redirect_urls)\s*=/.test(line));
    expect(after).toEqual(before);
  });

  it('keeps the Google client named by variable, so the copy holds no secret', () => {
    expect(text).toContain('client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"');
    expect(text).toContain('secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"');
  });

  it('still declares everything the static check wants, so the diff sees the same providers', async () => {
    const {authDeclarationProblems} = await import('../../scripts/config-toml.mjs');
    expect(authDeclarationProblems(text)).toEqual([]);
  });

  it('refuses a config that does not declare the two settings once each in [auth]', () => {
    expect(() => stagingConfigText(committed.replace(/^site_url = .*\n/m, ''), origin)).toThrow(/site_url and additional_redirect_urls once each/);
    expect(() => stagingConfigText(committed.replace(/additional_redirect_urls = \[[^\]]*\]\n/, ''), origin)).toThrow(/once each/);
    expect(() => stagingConfigText(committed.replace('[auth]\n', '[auth]\nsite_url = "http://127.0.0.1:3000"\n'), origin)).toThrow(/once each/);
    expect(() => stagingConfigText('[api]\nport = 1\n', origin)).toThrow(/no \[auth\] section/);
  });

  it('leaves a site_url written in another section alone', () => {
    const other = committed.replace('[storage]', '[storage]\nsite_url = "http://example.test"');
    const changed = stagingConfigText(other, origin);
    expect(stringValue(readSections(changed), 'storage', 'site_url')).toBe('http://example.test');
    expect(stringValue(readSections(changed), 'auth', 'site_url')).toBe(origin);
  });
});

describe('writeStagingConfig', () => {
  it('writes <workdir>/supabase/config.toml and leaves the committed file as it was', () => {
    const workdir = join(temp, 'write');
    const result = writeStagingConfig({workdir, siteUrl: 'https://nova3d-staging.vercel.app'});
    expect(result.path).toBe(join(workdir, 'supabase/config.toml'));
    expect(result.origin).toBe('https://nova3d-staging.vercel.app');
    expect(readFileSync(result.path, 'utf8')).toBe(stagingConfigText(committed, result.origin));
    expect(readFileSync(committedPath, 'utf8')).toBe(committed);
    expect(stringValue(readSections(committed), 'auth', 'site_url')).toBe('http://127.0.0.1:3000');
  });

  it('writes nothing when the URL is refused', () => {
    const workdir = join(temp, 'refused');
    expect(() => writeStagingConfig({workdir, siteUrl: 'https://127.0.0.1'})).toThrow(/IP address/);
    expect(existsSync(workdir)).toBe(false);
  });

  it('refuses to write over the committed file', () => {
    expect(() => writeStagingConfig({workdir: root, siteUrl: 'https://nova3d-staging.vercel.app'})).toThrow(/must not be the repository/);
    expect(readFileSync(committedPath, 'utf8')).toBe(committed);
    expect(() => writeStagingConfig({workdir: '', siteUrl: 'https://nova3d-staging.vercel.app'})).toThrow(/work directory/);
  });
});

describe('the command', () => {
  const run = (args: string[], env: Record<string, string | undefined>) =>
    spawnSync(process.execPath, [script, ...args], {encoding: 'utf8', env: {PATH: process.env.PATH, ...env} as unknown as NodeJS.ProcessEnv});

  it('writes the copy from STAGING_SITE_URL and prints where, never the committed file', () => {
    const workdir = join(temp, 'command');
    const result = run([workdir], {STAGING_SITE_URL: 'https://nova3d-staging.vercel.app'});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(join(workdir, 'supabase/config.toml'));
    expect(stringValue(readSections(readFileSync(join(workdir, 'supabase/config.toml'), 'utf8')), 'auth', 'site_url')).toBe('https://nova3d-staging.vercel.app');
    expect(readFileSync(committedPath, 'utf8')).toBe(committed);
  });

  it('runs through a symlink too: the entry check compares real paths, so a link does not turn the command into a silent no-op that writes no copy', () => {
    const link = join(temp, 'link-to-staging-config.mjs');
    symlinkSync(script, link);
    const workdir = join(temp, 'command-linked');
    const result = spawnSync(process.execPath, [link, workdir], {encoding: 'utf8', env: {PATH: process.env.PATH, STAGING_SITE_URL: 'https://nova3d-staging.vercel.app'} as unknown as NodeJS.ProcessEnv});
    expect(result.status).toBe(0);
    expect(existsSync(join(workdir, 'supabase/config.toml'))).toBe(true);
  });

  it('exits 1 with a message that does not repeat a refused value, and writes nothing', () => {
    const workdir = join(temp, 'command-refused');
    for (const value of ['http://staging.example.com', 'https://localhost', 'https://192.168.0.9', '', undefined]) {
      const result = run([workdir], {STAGING_SITE_URL: value});
      expect(result.status, String(value)).toBe(1);
      expect(result.stderr).toMatch(/^STAGING_SITE_URL /);
      if (value) expect(result.stderr).not.toContain(value);
    }
    expect(existsSync(workdir)).toBe(false);
  });

  it('exits 2 with the usage when the work directory is missing or there is more than one argument', () => {
    expect(run([], {STAGING_SITE_URL: 'https://nova3d-staging.vercel.app'}).status).toBe(2);
    expect(run(['a', 'b'], {STAGING_SITE_URL: 'https://nova3d-staging.vercel.app'}).status).toBe(2);
  });
});

describe('stagingConfigText keeps the line endings of the file it copies', () => {
  const origin = 'https://nova3d-staging.vercel.app';
  const lf = stagingConfigText(committed, origin);

  it('is the LF text for a LF file', () => {
    expect(lf).not.toContain('\r');
    expect(lf).toContain(`site_url = "${origin}"\n`);
    expect(lf).toContain(`additional_redirect_urls = ["${origin}/auth/callback"]\n`);
  });

  it('has CRLF at the end of every line, the replaced ones included, and no bare LF, for a CRLF checkout', () => {
    const crlf = committed.replace(/\n/g, '\r\n');
    const text = stagingConfigText(crlf, origin);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(text).toContain(`site_url = "${origin}"\r\n`);
    expect(text).toContain(`additional_redirect_urls = ["${origin}/auth/callback"]\r\n`);
    // The same text as the LF copy, with the endings the checkout had.
    expect(text).toBe(lf.replace(/\n/g, '\r\n'));
  });

  it('keeps each line\'s own ending in a file that mixes them, and a last line with none', () => {
    const mixed = ['[auth]\r\n', 'site_url = "http://127.0.0.1:3000"\n', 'additional_redirect_urls = [\r\n', '  "http://127.0.0.1:3000/auth/callback",\n', ']\r\n', 'enable_signup = true\n', '[other]\r\n', 'last = 1'].join('');
    expect(stagingConfigText(mixed, origin)).toBe(['[auth]\r\n', `site_url = "${origin}"\n`, `additional_redirect_urls = ["${origin}/auth/callback"]\r\n`, 'enable_signup = true\n', '[other]\r\n', 'last = 1'].join(''));
  });

  it('writes the copy of a CRLF file with CRLF endings throughout, and a copy the reader reads without a problem', () => {
    const source = join(temp, 'crlf-config.toml');
    writeFileSync(source, committed.replace(/\n/g, '\r\n'));
    const written = writeStagingConfig({workdir: join(temp, 'crlf-work'), siteUrl: origin, configPath: source});
    const text = readFileSync(written.path, 'utf8');
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(readSections(text).problems).toEqual([]);
  });
});
