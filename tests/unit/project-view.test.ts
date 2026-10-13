import {describe, expect, it, vi} from 'vitest';
import {catalogs, createTranslator, locales, translate} from '@/lib/i18n';
import {
  attemptRename,
  commandIdOf,
  formatUpdated,
  maxTitleLength,
  newCommandId,
  normalizeTitle,
  projectIdOf,
  projectPath,
  renameIdle,
  revisionOf,
  sourcesPath,
  titleErrorKeys,
  titleProblem,
  updatedIso,
  versionWords,
  type RenameState,
} from '@/lib/project-view';
import {hasUndecodableProjectId, undecodableProjectPath} from '@/lib/project-paths';
import {unexpectedResponseMessage} from '@/lib/session-actions';

const ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('IDs', () => {
  it('accepts an ID as the database spells one, in either case, and nothing around it', () => {
    expect(projectIdOf(ID)).toBe(ID);
    expect(projectIdOf(ID.toUpperCase())).toBe(ID);
    expect(commandIdOf(ID)).toBe(ID);
  });

  it.each([`  ${ID}\n`, ` ${ID}`, `${ID} `, `\t${ID}`, `${ID}\n`, `\u00a0${ID}\u00a0`, `\u200b${ID}`, `%20${ID}%20`, encodeURIComponent(` ${ID} `)])('does not trim: %j is no ID, so it is a malformed one and not the Project it would name', (input) => {
    expect(projectIdOf(input)).toBeNull();
    expect(commandIdOf(input)).toBeNull();
  });

  it.each(['', ' ', 'not-an-id', `${ID}x`, `x${ID}`, ID.replaceAll('-', ''), "x'; drop table projects.projects", `${ID}\u0000`, '../../etc/passwd', null, undefined, 7, {}, [ID], new Blob(['x'])])('answers null for %j', (input) => {
    expect(projectIdOf(input)).toBeNull();
  });

  it('builds the two paths from an ID', () => {
    expect(projectPath(ID)).toBe(`/projects/${ID}`);
    expect(sourcesPath(ID)).toBe(`/projects/${ID}/sources`);
  });

  it('makes a command ID that is a version 4 UUID, and a new one each time, even without crypto.randomUUID', () => {
    const made = Array.from({length: 50}, () => newCommandId());
    for (const id of made) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(made).size).toBe(50);
    const original = globalThis.crypto.randomUUID;
    try {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {value: undefined, configurable: true});
      expect(newCommandId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {value: original, configurable: true});
    }
  });
});

describe('Project links whose ID does not decode', () => {
  it('knows a percent sign that starts no escape, in the overview or Sources, and nothing else', () => {
    for (const path of ['/projects/%E0%A4%A', '/projects/%E0%A4%A/sources', '/projects/%zz', '/projects/%/', '/projects/%C3%28']) expect(hasUndecodableProjectId(path), path).toBe(true);
    for (const path of ['/projects', '/projects/', '/projects/%E0%A4%A4', '/projects/%41', `/projects/${ID}`, `/projects/${ID}/sources`, '/projects/x/y', '/projects/%zz/other', '/settings/%zz', '/', '/projectsx/%zz']) expect(hasUndecodableProjectId(path), path).toBe(false);
  });

  it('is sent to a segment that is no ID, so it is the one unavailable page', () => {
    expect(projectIdOf(undecodableProjectPath.split('/').pop())).toBeNull();
    expect(hasUndecodableProjectId(undecodableProjectPath)).toBe(false);
  });
});

describe('revisions', () => {
  it('reads a positive whole number from text, and nothing else', () => {
    expect(revisionOf('1')).toBe(1);
    expect(revisionOf(' 42 ')).toBe(42);
    for (const input of ['0', '-1', '1.5', '01', '1e3', '', ' ', 'abc', '9999999999999999', null, undefined, 3, {}]) expect(revisionOf(input), String(input)).toBeNull();
  });
});

describe('titles', () => {
  it('trims the white space around a title, and treats anything that is not text as an empty one', () => {
    expect(normalizeTitle('  Garden arch  ')).toBe('Garden arch');
    expect(normalizeTitle('\tGarden arch\n')).toBe('Garden arch');
    expect(normalizeTitle('\u00a0Garden arch\u00a0')).toBe('Garden arch');
    for (const input of [null, undefined, 7, {}, ['x']]) expect(normalizeTitle(input)).toBe('');
  });

  it('accepts a name of 1 to 120 characters in any script', () => {
    for (const title of ['x', 'Garden arch study', 'המזבח החיצון והכבש', 'a'.repeat(maxTitleLength), 'ש'.repeat(maxTitleLength), '😀'.repeat(maxTitleLength), 'mixed עברית and English', 'Version 2: "final" (draft) & more']) {
      expect(titleProblem(title), title.slice(0, 20)).toBeNull();
    }
  });

  it('refuses a blank title, including one of only characters that draw nothing', () => {
    for (const title of ['', '\u200b', '\u200b\u200f\u200e', '\u2800', '\u3164', '\u200b \u00a0']) expect(titleProblem(normalizeTitle(title)), JSON.stringify(title)).toBe('empty');
  });

  it('refuses a title over 120 characters, counted in code points as the database counts them', () => {
    expect(titleProblem('a'.repeat(121))).toBe('too_long');
    expect(titleProblem('😀'.repeat(121))).toBe('too_long');
    expect(titleProblem('😀'.repeat(120))).toBeNull();
  });

  it('refuses a control character inside the title, and says so rather than replacing it', () => {
    for (const title of ['two\tcolumns', 'two\nlines', 'bell\u0007', 'null\u0000', 'c1\u0085control', 'del\u007f', 'carriage\rreturn']) expect(titleProblem(normalizeTitle(title)), JSON.stringify(title)).toBe('control');
    // A control character at the edge was trimmed away: it is not in the name that is sent.
    expect(titleProblem(normalizeTitle('\ttrimmed\n'))).toBeNull();
  });

  it('has a message for each problem in both languages', () => {
    for (const locale of locales) for (const key of Object.values(titleErrorKeys)) expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
    expect(Object.keys(titleErrorKeys).sort()).toEqual(['control', 'empty', 'too_long']);
    // The longest title is said in the message by the same number the rule uses, never a copy of it.
    for (const locale of locales) expect(translate(locale, titleErrorKeys.too_long, {max: maxTitleLength})).toContain(String(maxTitleLength));
    expect(translate('en', titleErrorKeys.too_long, {max: 7})).toBe('Use 7 characters or fewer.');
  });
});

describe('words and times', () => {
  it('says the Version, or that there is none yet', () => {
    const t = createTranslator('en');
    expect(versionWords(t, 3)).toBe('Version 3');
    expect(versionWords(t, 0)).toBe('No version yet');
    expect(versionWords(createTranslator('he'), 2)).toBe('גרסה 2');
  });

  it('writes a time the same everywhere, and an unreadable one as nothing', () => {
    expect(formatUpdated('2026-10-12T00:24:11.123456+00:00')).toBe('2026-10-12 00:24 UTC');
    expect(updatedIso('2026-10-12T00:24:11.123456+00:00')).toBe('2026-10-12T00:24:11.123Z');
    expect(formatUpdated('not a time')).toBe('');
    expect(updatedIso('not a time')).toBeUndefined();
  });
});

describe('attemptRename', () => {
  it('returns what the action answers', async () => {
    const answer: RenameState = {outcome: 'renamed', title: 'After', revision: 2, replayed: false};
    expect(await attemptRename(async () => answer, renameIdle, form({}))).toEqual(answer);
  });

  it('reads a call that did not answer as unavailable, and says the rename may have been made', async () => {
    const answer = await attemptRename(async () => { throw new TypeError('Failed to fetch'); }, renameIdle, form({}));
    expect(answer).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('reloads the page, once, when the answer was not an action response at all (a redirect by the proxy), and keeps the previous state', async () => {
    const navigate = vi.fn();
    const previous: RenameState = {outcome: 'stale', title: 'Now', revision: 3};
    const answer = await attemptRename(async () => { throw new Error(unexpectedResponseMessage); }, previous, form({}), navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(answer).toBe(previous);
  });
});
