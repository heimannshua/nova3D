import {spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {authDeclarationProblems, otherProviders, readSections, rawValue, stringList, stringValue, web3Methods} from '../../scripts/config-toml.mjs';

// Story 1.9 (AC-1): `supabase config diff` compares only what supabase/config.toml declares. These tests hold the static check to what it
// promises: it fails when a declaration is missing, when a provider other than Google is enabled (whatever its name), and when the
// settings that must hold (sign-ups on, email/SMS/anonymous off) do not. The check itself runs in the baseline CI job
// (scripts/ci/check-repository.mjs), which this file also runs as a program.
const root = resolve(import.meta.dirname, '../..');
const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');

/** The config with one section's `enabled = false` flipped on. */
const enable = (text: string, section: string) => text.replace(new RegExp(`(\\[${section.replace(/\./g, '\\.')}\\]\\s*\\n\\s*enabled = )false`), '$1true');
/** The config without one section (its header and keys up to the next header). */
const without = (text: string, section: string) => text.replace(new RegExp(`\\[${section.replace(/\./g, '\\.')}\\]\\n(?:(?!\\[)[^\\n]*\\n)*`), '');

describe('the committed supabase/config.toml', () => {
  it('declares everything the static check asks for', () => {
    expect(authDeclarationProblems(config)).toEqual([]);
  });

  it('lets scripts/ci/check-repository.mjs pass, as the baseline CI job runs it', () => {
    const result = spawnSync(process.execPath, [resolve(root, 'scripts/ci/check-repository.mjs')], {encoding: 'utf8'});
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Repository checks passed/);
  });
});

describe('authDeclarationProblems', () => {
  it('fails when a provider is not declared, naming it', () => {
    for (const provider of otherProviders) {
      const problems = authDeclarationProblems(without(config, `auth.external.${provider}`));
      expect(problems, provider).toEqual([`supabase/config.toml: [auth.external.${provider}] enabled is not declared`]);
    }
  });

  it('fails when a Web3 method is not declared', () => {
    for (const method of web3Methods) expect(authDeclarationProblems(without(config, `auth.web3.${method}`)), method).toEqual([`supabase/config.toml: [auth.web3.${method}] enabled is not declared`]);
  });

  it('fails when a second provider is enabled, whichever it is', () => {
    for (const provider of otherProviders) {
      const problems = authDeclarationProblems(enable(config, `auth.external.${provider}`));
      expect(problems.join('\n'), provider).toContain(`[auth.external.${provider}] enabled must be false`);
      expect(problems.join('\n'), provider).toContain(`[auth.external.${provider}] is enabled; Google is the only sign-in provider`);
    }
  });

  it('fails for a provider the list does not know, when it is enabled', () => {
    const problems = authDeclarationProblems(`${config}\n[auth.external.some_new_provider]\nenabled = true\nclient_id = "x"\n`);
    expect(problems).toEqual(['supabase/config.toml: [auth.external.some_new_provider] is enabled; Google is the only sign-in provider']);
    // ... and so for a third-party auth provider, an SMS provider and a Web3 method.
    for (const section of ['auth.third_party.firebase', 'auth.sms.twilio', 'auth.web3.solana']) {
      expect(authDeclarationProblems(`${config}\n[${section}]\nenabled = true\n`).join('\n'), section).toContain(`[${section}] is enabled`);
    }
  });

  it('fails when Google is not on, or sign-ups are off, or email, SMS or anonymous sign-in is on', () => {
    expect(authDeclarationProblems(config.replace(/(\[auth\.external\.google\]\nenabled = )true/, '$1false'))).toEqual(['supabase/config.toml: [auth.external.google] enabled must be true']);
    expect(authDeclarationProblems(config.replace('enable_signup = true', 'enable_signup = false'))).toEqual(['supabase/config.toml: [auth] enable_signup must be true']);
    expect(authDeclarationProblems(config.replace('enable_anonymous_sign_ins = false', 'enable_anonymous_sign_ins = true'))).toEqual(['supabase/config.toml: [auth] enable_anonymous_sign_ins must be false']);
    expect(authDeclarationProblems(config.replace(/(\[auth\.email\]\n)enable_signup = false/, '$1enable_signup = true'))).toEqual(['supabase/config.toml: [auth.email] enable_signup must be false']);
    expect(authDeclarationProblems(config.replace(/(\[auth\.sms\]\n)enable_signup = false/, '$1enable_signup = true'))).toEqual(['supabase/config.toml: [auth.sms] enable_signup must be false']);
  });

  it('fails when the sign-up setting, the site URL, the redirect URLs or the one-time-code expiry is not declared', () => {
    expect(authDeclarationProblems(config.replace(/^enable_signup = true\n/m, ''))).toEqual(['supabase/config.toml: [auth] enable_signup is not declared']);
    expect(authDeclarationProblems(config.replace(/^site_url = .*\n/m, ''))).toEqual(['supabase/config.toml: [auth] site_url is not declared']);
    expect(authDeclarationProblems(config.replace(/additional_redirect_urls = \[[^\]]*\]\n/, ''))).toEqual(['supabase/config.toml: [auth] additional_redirect_urls is not declared']);
    expect(authDeclarationProblems(config.replace(/additional_redirect_urls = \[[^\]]*\]/, 'additional_redirect_urls = []'))).toEqual(['supabase/config.toml: [auth] additional_redirect_urls must list the callback']);
    expect(authDeclarationProblems(config.replace(/^otp_expiry = 900\n/m, ''))).toEqual(['supabase/config.toml: [auth.email] otp_expiry is not declared']);
  });

  it('is not fooled by a setting that is only in a comment, or written under another section', () => {
    const commented = config.replace(/^enable_signup = true\n/m, '# enable_signup = true\n');
    expect(authDeclarationProblems(commented)).toEqual(['supabase/config.toml: [auth] enable_signup is not declared']);
    // `enabled = true` for a provider written under a different header does not count for the provider.
    const moved = config.replace(/\[auth\.external\.github\]\nenabled = false\n/, '').replace('[auth.external.gitlab]\nenabled = false', '[auth.external.gitlab]\nenabled = false\n\n[auth.external.github]\n# enabled = false');
    expect(authDeclarationProblems(moved)).toEqual(['supabase/config.toml: [auth.external.github] enabled is not declared']);
  });

  it('reports an empty file as missing everything, and never passes it', () => {
    expect(authDeclarationProblems('').length).toBeGreaterThan(otherProviders.length);
    expect(authDeclarationProblems('# nothing here\n')).not.toEqual([]);
  });
});

// A line the reader does not understand is a failure, never a line it skips: a provider enabled in a form the reader cannot see must not pass.
// Each case below ENABLES github in one such form, appended to the committed file, and the check must fail naming the line number and the kind of
// form (never the line itself).
const lineCount = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
const tripleDouble = '"'.repeat(3);
const tripleSingle = "'".repeat(3);
const unreadable: Array<[string, string, string]> = [
  ['a header with spaces inside the brackets', '[ auth.external.github ]\nenabled = true\n', 'a table header that is not a plain dotted name'],
  ['a header with a quoted part', '[auth."external".github]\nenabled = true\n', 'a table header that is not a plain dotted name'],
  ['a quoted header', '["auth.external.github"]\nenabled = true\n', 'a table header that is not a plain dotted name'],
  ['a table array', '[[auth.external.github]]\nenabled = true\n', 'a table header that is not a plain dotted name'],
  ['a header with trailing text', '[auth.external.github] extra\nenabled = true\n', 'a table header that is not a plain dotted name'],
  ['a dotted key under a table', '[auth.external]\ngithub.enabled = true\n', 'a key that is not a plain name'],
  ['a dotted key at the top', 'auth.external.github.enabled = true\n', 'a key that is not a plain name'],
  ['a quoted key', '[auth.external.github]\n"enabled" = true\n', 'a key that is not a plain name'],
  ['a literal-quoted key', "[auth.external.github]\n'enabled' = true\n", 'a key that is not a plain name'],
  ['an inline table', '[auth.external]\ngithub = { enabled = true }\n', 'an inline table'],
  ['a nested inline table', '[auth]\nexternal = { github = { enabled = true } }\n', 'an inline table'],
  ['a multi-line string', `[auth.external.github]\ndescription = ${tripleDouble}\nenabled = true\n${tripleDouble}\n`, 'a multi-line string'],
  ['a multi-line literal string', `[auth.external.github]\ndescription = ${tripleSingle}\nenabled = true\n${tripleSingle}\n`, 'a multi-line string'],
  ['an array that is never closed', '[auth.external.github]\nlist = [\n"a",\nenabled = true\n', 'an array that is never closed'],
  ['a value that is nothing', '[auth.external.github]\nenabled =\n', 'a value that is not a string'],
  ['a value that is a bare word', '[auth.external.github]\nenabled = yes\n', 'a value that is not a string'],
  ['a value that is an array of arrays', '[auth.external.github]\nlist = [[1], [2]]\n', 'a value that is not a string'],
  ['a line that is only words', '[auth.external.github]\nenabled true\n', 'a line that is not a table header'],
  ['a table written twice (the later one is enabled)', '[auth.external.github]\nenabled = true\n', 'a table or a key written twice'],
  ['a key written twice in one table', '[auth.external.google]\nenabled = false\n', 'a table or a key written twice'],
];

describe('the check fails closed on a form it cannot read', () => {
  it.each(unreadable)('reports %s, by line number and kind, and never the line', (_name, appended, kind) => {
    const text = `${config}${config.endsWith('\n') ? '' : '\n'}${appended}`;
    const problems = authDeclarationProblems(text);
    expect(problems.length).toBeGreaterThan(0);
    const reported = problems.filter((problem) => problem.includes(kind));
    expect(reported.length, problems.join('\n')).toBeGreaterThan(0);
    // The line number is a line of the appended text, and the message says nothing of its content.
    const first = lineCount(config) + 1;
    for (const problem of reported) {
      const number = Number(/line (\d+) is/.exec(problem)?.[1]);
      expect(number, problem).toBeGreaterThanOrEqual(first);
      expect(number, problem).toBeLessThanOrEqual(lineCount(text));
      expect(problem, problem).not.toMatch(/github|enabled = |"""|\{/);
    }
  });

  it('does not take the committed file for one of those forms: it reads without a single problem', () => {
    expect(readSections(config).problems).toEqual([]);
  });

  it('names the line of the first unreadable form exactly', () => {
    const text = '[auth]\nsite_url = "http://127.0.0.1:3000"\n[ auth.external.github ]\nenabled = true\n';
    expect(readSections(text).problems).toEqual([{line: 3, kind: 'header', description: expect.stringContaining('table header')}]);
  });

  it('still reads the plain forms: comments, blank lines, literal strings, numbers, booleans, multi-line arrays with comments and trailing commas, CRLF', () => {
    const parsed = readSections(['# a comment', '', '[a]', "s = 'literal # not a comment'", 'n = 900 # a comment', 'neg = -1', 'f = 1.5', 'b = true', 'list = [', '  "x", # one', "  'y',", '  3,', ']', 'one = ["a"]', '[a.b-c_d]', 'k-1_x = "v"'].join('\r\n'));
    expect(parsed.problems).toEqual([]);
    expect(rawValue(parsed, 'a', 'n')).toBe('900');
    expect(rawValue(parsed, 'a', 'neg')).toBe('-1');
    expect(stringList(parsed, 'a', 'one')).toEqual(['a']);
    expect(rawValue(parsed, 'a.b-c_d', 'k-1_x')).toBe('"v"');
  });
});

describe('the check as a program (scripts/ci/check-repository.mjs)', () => {
  const temp = mkdtempSync(join(tmpdir(), 'nova3d-check-'));
  afterAll(() => rmSync(temp, {recursive: true, force: true}));

  /** The script run in a copy of the repository's layout that holds the given config.toml (and none of the Markdown, which it also reports). */
  function runWith(text: string) {
    const dir = mkdtempSync(join(temp, 'repo-'));
    mkdirSync(join(dir, 'scripts/ci'), {recursive: true});
    mkdirSync(join(dir, 'supabase'), {recursive: true});
    copyFileSync(resolve(root, 'scripts/ci/check-repository.mjs'), join(dir, 'scripts/ci/check-repository.mjs'));
    copyFileSync(resolve(root, 'scripts/config-toml.mjs'), join(dir, 'scripts/config-toml.mjs'));
    writeFileSync(join(dir, 'supabase/config.toml'), text);
    const result = spawnSync(process.execPath, [join(dir, 'scripts/ci/check-repository.mjs')], {encoding: 'utf8'});
    return {status: result.status, lines: result.stderr.split('\n').filter((line) => line.includes('supabase/config.toml'))};
  }

  it('exits 1 and names a provider that is enabled', () => {
    const result = runWith(enable(config, 'auth.external.github'));
    expect(result.status).toBe(1);
    expect(result.lines).toContain('- supabase/config.toml: [auth.external.github] is enabled; Google is the only sign-in provider');
  });

  it('exits 1 and names a declaration that is missing', () => {
    const result = runWith(without(config, 'auth.external.discord'));
    expect(result.status).toBe(1);
    expect(result.lines).toContain('- supabase/config.toml: [auth.external.discord] enabled is not declared');
  });

  it('exits 1 for a provider enabled in a form the reader cannot read, naming the line and the kind of form and not the line', () => {
    for (const [name, appended, kind] of unreadable) {
      const text = `${config}${config.endsWith('\n') ? '' : '\n'}${appended}`;
      const result = runWith(text);
      expect(result.status, name).toBe(1);
      expect(result.lines.some((line) => /line \d+ is /.test(line) && line.includes(kind)), `${name}: ${result.lines.join(' | ')}`).toBe(true);
      // The messages about the unreadable lines say nothing of their content (the other lines name sections, which is the file's structure).
      expect(result.lines.filter((line) => /line \d+ is /.test(line)).join('\n'), name).not.toMatch(/github|enabled|"""/);
    }
  });

  it('reports no config problem for the committed file (the other failures are the Markdown this temporary layout lacks)', () => {
    const result = runWith(config);
    expect(result.lines).toEqual([]);
  });

  it('exits 1 when there is no config.toml at all', () => {
    const dir = mkdtempSync(join(temp, 'repo-'));
    mkdirSync(join(dir, 'scripts/ci'), {recursive: true});
    copyFileSync(resolve(root, 'scripts/ci/check-repository.mjs'), join(dir, 'scripts/ci/check-repository.mjs'));
    copyFileSync(resolve(root, 'scripts/config-toml.mjs'), join(dir, 'scripts/config-toml.mjs'));
    const result = spawnSync(process.execPath, [join(dir, 'scripts/ci/check-repository.mjs')], {encoding: 'utf8'});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required file: supabase/config.toml');
  });
});

describe('the section reader', () => {
  it('reads sections, comments, multi-line arrays and quoted values', () => {
    const parsed = readSections(['top = 1', '[a]', 'x = "q # not a comment" # a comment', 'urls = [', '  "one", # first', '  "two",', ']', '[a.b]', 'on = true'].join('\n'));
    expect(rawValue(parsed, '', 'top')).toBe('1');
    expect(stringValue(parsed, 'a', 'x')).toBe('q # not a comment');
    expect(stringList(parsed, 'a', 'urls')).toEqual(['one', 'two']);
    expect(rawValue(parsed, 'a.b', 'on')).toBe('true');
    expect(rawValue(parsed, 'a.c', 'on')).toBeUndefined();
  });

  it('does not take a number or a bare word for a string list', () => {
    const parsed = readSections('[a]\nurls = 3\nother = [1, 2]\n');
    expect(stringList(parsed, 'a', 'urls')).toBeUndefined();
    expect(stringList(parsed, 'a', 'other')).toBeUndefined();
  });
});
