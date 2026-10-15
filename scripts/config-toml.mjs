// Story 1.9. A small, line-based reader for supabase/config.toml, and the one list of what that file must declare.
//
// There is no TOML library in this repository, and the file is flat enough not to need one: `[section]` headers and `key = value` lines,
// where a value is a string, a number, a boolean or an array of strings that may span lines. scripts/ci/check-repository.mjs (the static
// check of the Auth declarations) and scripts/staging-config.mjs (the scratch copy for staging) both read the file through this module, so
// "what counts as declared" is decided once. Plain ESM, no dependency, no file or network access: the callers read and write.

/** Every external OAuth provider the Supabase CLI (2.120.0, the version CI pins) knows besides Google. Each must be declared, and off. */
export const otherProviders = [
  'apple', 'azure', 'bitbucket', 'discord', 'facebook', 'figma', 'github', 'gitlab', 'kakao', 'keycloak', 'linkedin_oidc', 'notion',
  'slack', 'slack_oidc', 'spotify', 'twitch', 'twitter', 'workos', 'x', 'zoom',
];
/** The Web3 sign-in methods the CLI knows. Each must be declared, and off. */
export const web3Methods = ['solana', 'ethereum'];

/** Section prefixes under which nothing but Google may be enabled. */
const signInSectionPrefixes = ['auth.external.', 'auth.web3.', 'auth.third_party.', 'auth.sms.'];

/** Drops a trailing comment that is not inside a string. */
function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === '\\' && quote === '"') index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '#') return line.slice(0, index);
  }
  return line;
}

/**
 * What the reader does not understand, by fixed name. A line in one of these forms is NEVER skipped: it is a problem, because a provider could
 * be switched on in a form the reader cannot see, and a check that cannot see it would pass. Only the name and the line number are reported,
 * never the line.
 */
const unsupported = {
  header: 'a table header that is not a plain dotted name in brackets (spaces, quotes or a table array)',
  key: 'a key that is not a plain name (a dotted or quoted key)',
  inline: 'an inline table',
  multiline: 'a multi-line string',
  value: 'a value that is not a string, a number, a boolean or an array of those',
  array: 'an array that is never closed',
  line: 'a line that is not a table header, a key and a value, a comment or blank',
  duplicate: 'a table or a key written twice',
};

const headerPattern = /^\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]$/;
const keyPattern = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/;

/** Why a value is not one this reader understands, or null when it is a string, a number, a boolean or an array of strings and numbers. */
function valueProblem(value) {
  if (value === '') return 'value';
  if (value.startsWith('{')) return 'inline';
  if (value.startsWith('"""') || value.startsWith("'''")) return 'multiline';
  if (value.startsWith('[')) {
    const body = value.slice(1, value.lastIndexOf(']'));
    if (!value.endsWith(']')) return 'value';
    // Strings, numbers and booleans separated by commas; nothing nested.
    const rest = body.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
    return /^(?:\s*(?:""|-?[0-9][0-9_.]*|true|false)\s*(?:,|$))*\s*$/.test(rest) ? null : 'value';
  }
  if (/^"(?:[^"\\]|\\.)*"$/.test(value) || /^'[^']*'$/.test(value)) return null;
  if (/^(?:true|false|-?[0-9][0-9_]*(?:\.[0-9]+)?)$/.test(value)) return null;
  return 'value';
}

/**
 * Reads the file into sections. Returns `{sections, problems}`. `sections` maps a section name (`auth.external.google`; the keys before any
 * header are in the section named `''`) to a map of key to raw value text. `problems` lists every line the reader does not understand, as
 * `{line, kind}` (a 1-based line number and a fixed name from `unsupported`): the reader never skips a line it cannot read. A table or a key
 * written twice is a problem too (TOML forbids it, and which one wins is the reader's choice, not the file's).
 */
export function readSections(text) {
  const sections = new Map([['', new Map()]]);
  const problems = [];
  const flag = (line, kind) => problems.push({line, kind, description: unsupported[kind]});
  let current = sections.get('');
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripComment(lines[index]).trim();
    if (!line) continue;
    const number = index + 1;
    if (line.startsWith('[')) {
      const header = headerPattern.exec(line);
      if (!header) {
        // A value on a line of its own that starts with a bracket is also a header-shaped line; either way it is not understood.
        flag(number, 'header');
        continue;
      }
      if (sections.has(header[1])) flag(number, 'duplicate');
      else sections.set(header[1], new Map());
      current = sections.get(header[1]);
      continue;
    }
    const pair = keyPattern.exec(line);
    if (!pair) {
      flag(number, /^(?:[A-Za-z0-9_-]+\.)+[A-Za-z0-9_-]+\s*=/.test(line) || /^["']/.test(line) ? 'key' : 'line');
      continue;
    }
    let value = pair[2].trim();
    // An array may continue on the following lines until its brackets balance.
    if (value.startsWith('[') && !value.includes(']')) {
      const first = number;
      let closed = false;
      while (index + 1 < lines.length) {
        index += 1;
        value += ` ${stripComment(lines[index]).trim()}`;
        if (value.includes(']')) {
          closed = true;
          break;
        }
      }
      if (!closed) {
        flag(first, 'array');
        continue;
      }
    }
    const problem = valueProblem(value);
    if (problem) {
      flag(number, problem);
      continue;
    }
    if (current.has(pair[1])) flag(number, 'duplicate');
    current.set(pair[1], value);
  }
  return {sections, problems};
}

/** The value of a key as text, or undefined when the section or key is not declared. */
export function rawValue(parsed, section, key) {
  return parsed.sections.get(section)?.get(key);
}

/** `true` or `false` when the value is exactly that, otherwise undefined. */
export function booleanValue(parsed, section, key) {
  const value = rawValue(parsed, section, key);
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

/** The strings of an array value, or undefined when it is not an array of strings. */
export function stringList(parsed, section, key) {
  const value = rawValue(parsed, section, key);
  if (value === undefined || !/^\[[\s\S]*\]$/.test(value)) return undefined;
  const items = [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
  const rest = value.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/[[\],\s]/g, '');
  return rest === '' ? items : undefined;
}

/** The string value (quotes removed), or undefined when the value is not a basic string. */
export function stringValue(parsed, section, key) {
  const value = rawValue(parsed, section, key);
  const match = value === undefined ? null : /^"((?:[^"\\]|\\.)*)"$/.exec(value);
  return match ? match[1] : undefined;
}

/**
 * What supabase/config.toml must declare, as a list of problems (empty when it is all there). `supabase config diff` compares only what the
 * file declares, so a setting that is not written here is a setting that can drift without anything noticing:
 *
 *   [auth]              site_url, additional_redirect_urls, enable_signup = true (Supabase's sign-up setting stays on: turning it off blocks
 *                       every first-time Google sign-in; the live-Account check is the gate), enable_anonymous_sign_ins = false
 *   [auth.email]        enable_signup = false, otp_expiry (a number)
 *   [auth.sms]          enable_signup = false
 *   [auth.external.*]   google enabled; every other provider the CLI knows declared, with enabled = false
 *   [auth.web3.*]       solana and ethereum declared, with enabled = false
 *
 * And nothing but Google is enabled anywhere under auth.external, auth.web3, auth.third_party or auth.sms. A line the reader does not understand
 * (see `readSections`) is itself a problem, so the check fails closed.
 */
export function authDeclarationProblems(text) {
  const parsed = readSections(text);
  // A line the reader cannot read is a failure, not a line that is skipped: the line number and the kind of form, never its content.
  const problems = parsed.problems.map((entry) => `supabase/config.toml: line ${entry.line} is ${entry.description}, which the check cannot read; write it in the plain form the file uses`);
  const missing = (section, key) => problems.push(`supabase/config.toml: [${section}] ${key} is not declared`);
  const mustBe = (section, key, expected) => {
    const actual = booleanValue(parsed, section, key);
    if (actual === undefined) missing(section, key);
    else if (actual !== expected) problems.push(`supabase/config.toml: [${section}] ${key} must be ${expected}`);
  };

  if (stringValue(parsed, 'auth', 'site_url') === undefined) missing('auth', 'site_url');
  const redirects = stringList(parsed, 'auth', 'additional_redirect_urls');
  if (redirects === undefined) missing('auth', 'additional_redirect_urls');
  else if (redirects.length === 0) problems.push('supabase/config.toml: [auth] additional_redirect_urls must list the callback');
  mustBe('auth', 'enable_signup', true);
  mustBe('auth', 'enable_anonymous_sign_ins', false);
  mustBe('auth.email', 'enable_signup', false);
  if (!/^[1-9][0-9]*$/.test(rawValue(parsed, 'auth.email', 'otp_expiry') ?? '')) missing('auth.email', 'otp_expiry');
  mustBe('auth.sms', 'enable_signup', false);
  mustBe('auth.external.google', 'enabled', true);
  for (const provider of otherProviders) mustBe(`auth.external.${provider}`, 'enabled', false);
  for (const method of web3Methods) mustBe(`auth.web3.${method}`, 'enabled', false);

  // A provider not on the list above is still not allowed to be on: any section that signs people in, enabled, other than Google.
  for (const [name, keys] of parsed.sections) {
    if (name === 'auth.external.google') continue;
    if (!signInSectionPrefixes.some((prefix) => name.startsWith(prefix))) continue;
    if (keys.get('enabled') === 'true') problems.push(`supabase/config.toml: [${name}] is enabled; Google is the only sign-in provider`);
  }
  return [...new Set(problems)];
}
