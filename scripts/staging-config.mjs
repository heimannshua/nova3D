#!/usr/bin/env node
// Story 1.9. Writes the scratch copy of supabase/config.toml that staging's Auth settings are diffed against (and, by hand, pushed from).
//
//   node scripts/staging-config.mjs <workdir>
//
// writes <workdir>/supabase/config.toml, to be passed as `supabase config diff --workdir <workdir> --project-ref <ref> --exit-code`.
// The committed file is never changed: its root `[auth]` block stays loopback (site_url 127.0.0.1, callbacks on 127.0.0.1 and localhost),
// because it is also the local stack's configuration, and a hosted project must never hold a loopback callback (docs/auth-setup.md). The
// copy differs from it in exactly two settings, both in `[auth]`:
//
//   site_url                   = the origin in STAGING_SITE_URL
//   additional_redirect_urls   = ["<that origin>/auth/callback"] and nothing else
//
// STAGING_SITE_URL must be the https origin of the staging deployment: no path, no query, no credentials, no port, not a loopback, private
// or link-local address, not an IP address at all, and not a local-network name. Anything else stops with a message that does not repeat the
// value. The Google client is still named by `env(...)` in the copy, never written into it, so the copy holds no secret.
//
// Plain ESM, no dependency. The functions are exported for tests/unit/staging-config.test.ts; the command-line entry runs only when this
// file is the program.
import {mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(import.meta.dirname, '..');
const committedConfig = resolve(root, 'supabase/config.toml');

/** Names that only resolve inside a local network or on the machine itself. */
const localSuffixes = ['.localhost', '.local', '.lan', '.home', '.home.arpa', '.internal', '.intranet', '.corp', '.private', '.localdomain'];

/**
 * The origin of a staging site URL, or throws an Error whose message never contains the value. The origin is what the URL's scheme, host
 * (and port, which is refused) make: `https://nova3d-staging.vercel.app`.
 */
export function stagingSiteOrigin(value) {
  const fail = (reason) => {
    throw new Error(`STAGING_SITE_URL ${reason}`);
  };
  if (typeof value !== 'string' || value.trim() === '') fail('is not set');
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return fail('is not a URL');
  }
  if (url.protocol !== 'https:') fail('must be an https URL');
  if (url.username || url.password) fail('must not hold credentials');
  if (url.port) fail('must not name a port');
  if (url.pathname !== '/' || url.search || url.hash) fail('must be an origin: no path, query or fragment');
  const host = url.hostname.toLowerCase();
  // An IP address (any form the URL parser accepts, including the numeric shorthands) is never a deployment's address.
  if (host.startsWith('[') || /^[0-9.]+$/.test(host) || /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+))*$/i.test(host)) fail('must name a host, not an IP address');
  if (!host.includes('.') || host === 'localhost' || localSuffixes.some((suffix) => host.endsWith(suffix))) fail('must not be a loopback or local-network name');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) fail('must be a public host name');
  return url.origin;
}

/**
 * The text of the committed config with `[auth]`'s `site_url` and `additional_redirect_urls` replaced. Throws when either is not there
 * exactly once in `[auth]` (a copy that kept a loopback address would be worse than none).
 */
export function stagingConfigText(configText, origin) {
  // Each line keeps the line ending it had (LF or CRLF, or none on the last line), so a checkout with CRLF endings does not end with a mix: the
  // lines this replaces take the ending of the line they replace.
  const parts = String(configText).split(/(\r\n|\n)/);
  const lines = [];
  const endings = [];
  for (let index = 0; index < parts.length; index += 2) {
    lines.push(parts[index]);
    endings.push(parts[index + 1] ?? '');
  }
  const start = lines.findIndex((line) => line.trim() === '[auth]');
  if (start < 0) throw new Error('supabase/config.toml has no [auth] section');
  let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
  if (end < 0) end = lines.length;

  const out = [`${lines[start]}${endings[start]}`];
  const before = lines.slice(0, start).map((line, index) => `${line}${endings[index]}`);
  let siteUrl = 0;
  let redirects = 0;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (/^\s*site_url\s*=/.test(line)) {
      siteUrl += 1;
      out.push(`site_url = "${origin}"${endings[index]}`);
    } else if (/^\s*additional_redirect_urls\s*=/.test(line)) {
      redirects += 1;
      // The array may run over several lines; the replacement ends the way the array's last line did.
      let last = index;
      while (!lines[last].includes(']') && last + 1 < end) last += 1;
      index = last;
      out.push(`additional_redirect_urls = ["${origin}/auth/callback"]${endings[last]}`);
    } else {
      out.push(`${line}${endings[index]}`);
    }
  }
  if (siteUrl !== 1 || redirects !== 1) throw new Error('supabase/config.toml must declare site_url and additional_redirect_urls once each in [auth]');
  const after = lines.slice(end).map((line, offset) => `${line}${endings[end + offset]}`);
  return [...before, ...out, ...after].join('');
}

/** Writes <workdir>/supabase/config.toml for the given site URL and returns its path. Never writes the committed file. */
export function writeStagingConfig({workdir, siteUrl, configPath = committedConfig}) {
  if (typeof workdir !== 'string' || workdir.trim() === '') throw new Error('a scratch work directory is required');
  const origin = stagingSiteOrigin(siteUrl);
  const target = resolve(workdir, 'supabase/config.toml');
  if (target === resolve(configPath)) throw new Error('the scratch work directory must not be the repository: the committed config.toml stays loopback');
  const text = stagingConfigText(readFileSync(configPath, 'utf8'), origin);
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, text);
  return {path: target, origin};
}

/** Whether this file is the program being run, by REAL path on both sides: through a symlink the path as typed is not the module's own URL. */
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const workdir = process.argv[2];
  if (!workdir || process.argv.length > 3) {
    console.error('usage: node scripts/staging-config.mjs <workdir>   (STAGING_SITE_URL names the staging site)');
    process.exit(2);
  }
  try {
    const {path, origin} = writeStagingConfig({workdir, siteUrl: process.env.STAGING_SITE_URL});
    console.log(`Wrote ${path} for ${origin} (site_url and the one callback; everything else as supabase/config.toml).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'could not write the staging config');
    process.exit(1);
  }
}
