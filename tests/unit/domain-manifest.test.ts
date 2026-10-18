import {describe, expect, it} from 'vitest';
import {createDomainRegistry, defaultDomainRegistry} from '@/lib/domain-registry';
import {normalizeText} from '@/lib/request-intake';
import {comparable, maxAliases, maxSubjects, validateManifest, type DomainManifest} from '../../packages/contracts/domain-manifest';
import {middotManifest} from '../../packages/domains/middot/manifest';
import {fixtureIncenseManifest, fixtureRegistry} from '../support/fixture-domains';

// Story 2.1: the domain-package manifest contract, the registry port and the Middot manifest (AC-1, AC-2).
const good = (): DomainManifest => ({packageId: 'middot', version: 1, subjects: [{id: 'middot-altar-ramp', displayName: 'The outer altar and ramp (Middot 3)', aliases: ['altar', 'ramp']}]});
const problemsOf = (value: unknown) => {
  const result = validateManifest(value);
  return result.ok ? [] : result.problems;
};
const withSubject = (patch: Record<string, unknown>) => ({...good(), subjects: [{...good().subjects[0], ...patch}]});

describe('validateManifest', () => {
  it('accepts a manifest that follows every rule, and the Middot and fixture manifests', () => {
    expect(validateManifest(good())).toEqual({ok: true, manifest: good()});
    expect(validateManifest(middotManifest).ok).toBe(true);
    expect(validateManifest(fixtureIncenseManifest).ok).toBe(true);
  });

  it('never throws, whatever it is given, and names a problem for anything that is not a manifest', () => {
    for (const value of [undefined, null, 3, 'text', [], true, () => 1, Symbol('x'), {}, {subjects: 5}, {packageId: {}, version: [], subjects: [null]}]) {
      expect(() => validateManifest(value), String(value)).not.toThrow();
      expect(validateManifest(value).ok, String(value)).toBe(false);
    }
  });

  it('names every problem it finds, not just the first', () => {
    const problems = problemsOf({packageId: 'Bad ID', version: 0, subjects: [{id: 'X', displayName: ' ', aliases: []}]});
    expect(problems.length).toBeGreaterThanOrEqual(5);
    expect(problems.join('\n')).toMatch(/packageId/);
    expect(problems.join('\n')).toMatch(/version/);
    expect(problems.join('\n')).toMatch(/subjects\[0\]\.id/);
    expect(problems.join('\n')).toMatch(/subjects\[0\]\.displayName/);
    expect(problems.join('\n')).toMatch(/subjects\[0\]\.aliases/);
  });

  it.each([
    ['an empty package ID', {packageId: ''}],
    ['a package ID that starts with a digit', {packageId: '1middot'}],
    ['an upper-case package ID', {packageId: 'Middot'}],
    ['a package ID with an underscore', {packageId: 'mid_dot'}],
    ['a package ID of 64 characters', {packageId: `a${'b'.repeat(63)}`}],
    ['a version of 0', {version: 0}],
    ['a negative version', {version: -1}],
    ['a fractional version', {version: 1.5}],
    ['a version that is text', {version: '1'}],
    ['a version beyond the safe integers', {version: 2 ** 60}],
    ['no subjects', {subjects: []}],
    ['subjects that are not a list', {subjects: {}}],
  ])('refuses %s', (_name, patch) => {
    expect(problemsOf({...good(), ...patch}).length).toBeGreaterThan(0);
  });

  it('accepts a package ID of 63 characters and refuses 33 subjects', () => {
    expect(validateManifest({...good(), packageId: `a${'b'.repeat(62)}`}).ok).toBe(true);
    const many = (count: number) => Array.from({length: count}, (_value, index) => ({id: `s${index}`, displayName: `Subject ${index}`, aliases: [`a${index}`]}));
    expect(validateManifest({...good(), subjects: many(maxSubjects)}).ok).toBe(true);
    expect(problemsOf({...good(), subjects: many(maxSubjects + 1)}).join()).toMatch(/1 to 32 subjects/);
  });

  it.each([
    ['a subject ID in capitals', {id: 'Altar'}],
    ['a subject ID that starts with a dash', {id: '-altar'}],
    ['a missing subject ID', {id: undefined}],
    ['an empty display name', {displayName: ''}],
    ['a display name with a space around it', {displayName: ' The altar'}],
    ['a display name with a trailing newline', {displayName: 'The altar\n'}],
    ['a display name of 121 characters', {displayName: 'x'.repeat(121)}],
    ['a display name with a control character', {displayName: 'The\u0007 altar'}],
    ['a display name with a C1 control character', {displayName: 'The\u0085altar'}],
    ['a display name that is not text', {displayName: 7}],
    ['no aliases', {aliases: []}],
    ['aliases that are not a list', {aliases: 'altar'}],
    ['17 aliases', {aliases: Array.from({length: maxAliases + 1}, (_value, index) => `alias${index}`)}],
    ['an empty alias', {aliases: ['altar', '']}],
    ['an alias with a space around it', {aliases: [' altar']}],
    ['an alias of 61 characters', {aliases: ['x'.repeat(61)]}],
    ['an alias with a tab inside', {aliases: ['al\ttar']}],
    ['an alias that is not text', {aliases: ['altar', 3]}],
  ])('refuses %s', (_name, patch) => {
    expect(problemsOf(withSubject(patch)).length).toBeGreaterThan(0);
  });

  it('accepts 16 aliases, an alias of 60 characters, a display name of 120 characters, and Hebrew', () => {
    expect(validateManifest(withSubject({aliases: Array.from({length: maxAliases}, (_value, index) => `alias${index}`)})).ok).toBe(true);
    expect(validateManifest(withSubject({aliases: ['x'.repeat(60)]})).ok).toBe(true);
    expect(validateManifest(withSubject({displayName: 'x'.repeat(120)})).ok).toBe(true);
    expect(validateManifest(withSubject({displayName: 'ש'.repeat(120), aliases: ['מזבח', 'כבש']})).ok).toBe(true);
    // 120 characters, counted as characters and not as UTF-16 units.
    expect(validateManifest(withSubject({displayName: '😀'.repeat(120)})).ok).toBe(true);
  });

  it('refuses two aliases of one subject that are equal after normalization, and names both', () => {
    for (const aliases of [['altar', 'ALTAR'], ['altar', 'Altar'], ['Mizbeach', 'mizbeach'], ['ａｌｔａｒ', 'altar'], ['al  tar', 'al tar'], ['מִזְבֵּחַ', 'מזבח'], ['מזבח', 'מזבח־'], ['א־ב', 'א ב']]) {
      expect(problemsOf(withSubject({aliases})).join(), JSON.stringify(aliases)).toMatch(/aliases\[1\] repeats aliases\[0\] after normalization/);
    }
    // The same alias on two different subjects is allowed.
    expect(validateManifest({...good(), subjects: [good().subjects[0], {id: 'other', displayName: 'Other', aliases: ['altar']}]}).ok).toBe(true);
  });

  it('refuses an alias that is nothing after normalization', () => {
    expect(problemsOf(withSubject({aliases: ['altar', 'ְֱ']})).join()).toMatch(/empty after normalization/);
  });

  it('compares aliases exactly as the matching normalizes them (the contract repeats the steps because it may import nothing)', () => {
    const corpus = ['Altar', 'ＡＬＴＡＲ', 'al  tar', 'מִזְבֵּחַ', 'א־ב', 'א׀ב', 'א׃ב', 'א׆ב', 'שָׁלוֹם', 'ǅ', 'İstanbul', 'ΑΣ', 'ŉ'];
    for (const alias of corpus) {
      for (const other of corpus) {
        const duplicate = problemsOf(withSubject({aliases: [alias, other]})).some((problem) => /repeats/.test(problem));
        expect(duplicate, `${alias} / ${other}`).toBe(normalizeText(alias) === normalizeText(other) && normalizeText(alias) !== '');
      }
    }
  });
});

describe('validateManifest, the review patches', () => {
  it('refuses a hole in the list of subjects or of aliases, which forEach would have skipped', () => {
    const subjects = [good().subjects[0], , good().subjects[0]] as unknown as DomainManifest['subjects'];
    expect(problemsOf({...good(), subjects}).join()).toMatch(/subjects\[1\] must be an object/);
    const aliases = ['altar', , 'ramp'] as unknown as string[];
    expect(problemsOf(withSubject({aliases})).join()).toMatch(/subjects\[0\]\.aliases\[1\] must be text/);
    // A list that is nothing but holes is a list of problems, never an accepted one.
    expect(validateManifest({...good(), subjects: new Array(3)}).ok).toBe(false);
    expect(validateManifest(withSubject({aliases: new Array(2)})).ok).toBe(false);
    expect(validateManifest({...good(), subjects: [undefined]}).ok).toBe(false);
    expect(validateManifest(withSubject({aliases: [undefined]})).ok).toBe(false);
  });

  it('does a bounded amount of work for a list that claims a huge length, and still names the problem', () => {
    const started = Date.now();
    const result = validateManifest({...good(), subjects: new Array(2 ** 31)});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join()).toMatch(/1 to 32 subjects/);
    const aliases = validateManifest(withSubject({aliases: new Array(2 ** 31)}));
    expect(!aliases.ok && aliases.problems.join()).toMatch(/1 to 16 aliases/);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('still accepts a plain list', () => {
    expect(validateManifest({...good(), subjects: [good().subjects[0]]}).ok).toBe(true);
  });
});

describe('the contract and the matching normalize every Hebrew point alike (the review patches)', () => {
  it('holds comparable (the contract\'s copy) equal to normalizeText over every code point from U+0590 to U+05C8, and the duplicate check exactly when they say the aliases are equal', () => {
    for (let code = 0x0590; code <= 0x05c8; code += 1) {
      const character = String.fromCharCode(code);
      const word = `א${character}ב`;
      expect(comparable(word), `U+${code.toString(16)}`).toBe(normalizeText(word));
      // The alias with the character, and the same alias without it: a duplicate exactly when normalization makes them equal.
      const duplicate = problemsOf(withSubject({aliases: [word, 'אב']})).some((problem) => /repeats aliases\[0\] after normalization/.test(problem));
      expect(duplicate, `U+${code.toString(16)}`).toBe(normalizeText(word) === normalizeText('אב'));
      // Against the alias that has a space there instead (what the four punctuation marks become).
      const spaced = problemsOf(withSubject({aliases: [word, 'א ב']})).some((problem) => /repeats aliases\[0\] after normalization/.test(problem));
      expect(spaced, `U+${code.toString(16)} / space`).toBe(normalizeText(word) === normalizeText('א ב'));
    }
  });

  it('holds them equal over a corpus of other text too', () => {
    for (const text of ['Altar', 'ＡＬＴＡＲ', 'al  tar', 'ǅ', 'İstanbul', 'ΑΣ', 'ŉ', 'ﬁne', '\u00a0x\u00a0', 'a\tb']) expect(comparable(text), text).toBe(normalizeText(text));
  });
});

describe('the Middot manifest (AC-1)', () => {
  it('is package middot, version 1, with its one subject and exactly the aliases the story names', () => {
    expect(middotManifest.packageId).toBe('middot');
    expect(middotManifest.version).toBe(1);
    expect(middotManifest.subjects).toHaveLength(1);
    expect(middotManifest.subjects[0]).toEqual({
      id: 'middot-altar-ramp',
      displayName: 'The outer altar and ramp (Middot 3)',
      aliases: ['altar', 'ramp', 'mizbeach', 'kevesh', 'מזבח', 'כבש'],
    });
  });
});

describe('the registry port', () => {
  it('registers Middot only by default, in registration order, with the package and its version', () => {
    expect(defaultDomainRegistry.subjects()).toEqual([{...middotManifest.subjects[0], packageId: 'middot', packageVersion: 1}]);
    expect(defaultDomainRegistry.subject('middot-altar-ramp')?.displayName).toBe('The outer altar and ramp (Middot 3)');
    expect(defaultDomainRegistry.subject('fixture-incense-altar')).toBeNull();
    expect(defaultDomainRegistry.subject('')).toBeNull();
  });

  it('never holds the fixture subject by default: it is registered in tests only', () => {
    expect(defaultDomainRegistry.subjects().map((subject) => subject.id)).not.toContain('fixture-incense-altar');
    expect(fixtureRegistry.subjects().map((subject) => subject.id)).toEqual(['middot-altar-ramp', 'fixture-incense-altar']);
    expect(fixtureRegistry.subject('fixture-incense-altar')).toMatchObject({displayName: 'The incense altar (fixture)', aliases: ['altar', 'incense'], packageId: 'fixture-incense', packageVersion: 1});
  });

  it('keeps manifests in the order given, and each manifest\'s subjects in its own order', () => {
    const two: DomainManifest = {packageId: 'second', version: 3, subjects: [{id: 'b', displayName: 'B', aliases: ['b']}, {id: 'a', displayName: 'A', aliases: ['a']}]};
    expect(createDomainRegistry([two, middotManifest]).subjects().map((subject) => subject.id)).toEqual(['b', 'a', 'middot-altar-ramp']);
    expect(createDomainRegistry([]).subjects()).toEqual([]);
  });

  it('refuses an invalid manifest with a TypeError that names the problems', () => {
    expect(() => createDomainRegistry([{...good(), version: 0}])).toThrow(TypeError);
    expect(() => createDomainRegistry([{...good(), version: 0}])).toThrow(/version must be a positive integer/);
    expect(() => createDomainRegistry([good(), {packageId: 'X', version: 1, subjects: []}])).toThrow(/manifest 1: packageId.*manifest 1: subjects/);
    expect(() => createDomainRegistry([null as unknown as DomainManifest])).toThrow(TypeError);
  });

  it('refuses a subject ID that repeats, across manifests and inside one', () => {
    expect(() => createDomainRegistry([middotManifest, {packageId: 'other', version: 1, subjects: [middotManifest.subjects[0]]}])).toThrow(/subject middot-altar-ramp is already registered/);
    expect(() => createDomainRegistry([{...good(), subjects: [good().subjects[0], good().subjects[0]]}])).toThrow(TypeError);
  });

  it('refuses a package ID that two manifests share, and names the package', () => {
    expect(() => createDomainRegistry([middotManifest, middotManifest])).toThrow(/package middot is already registered/);
    expect(() => createDomainRegistry([good(), {...good(), subjects: [{id: 'other-subject', displayName: 'Another subject', aliases: ['other']}]}])).toThrow(/manifest 1 \(middot\): package middot is already registered/);
    // Two packages with their own IDs are fine.
    expect(() => createDomainRegistry([middotManifest, fixtureIncenseManifest])).not.toThrow();
  });

  it('refuses a display name that two subjects share, compared after normalization, across manifests and inside one', () => {
    const second = (displayName: string, packageId = 'second'): DomainManifest => ({packageId, version: 1, subjects: [{id: 'second-subject', displayName, aliases: ['second']}]});
    for (const name of [middotManifest.subjects[0].displayName, middotManifest.subjects[0].displayName.toUpperCase(), 'The  outer altar and ramp (Middot 3)', 'Ｔｈｅ outer altar and ramp (Middot 3)']) {
      expect(() => createDomainRegistry([middotManifest, second(name)]), name).toThrow(/subject second-subject has the same display name as subject middot-altar-ramp/);
    }
    const inside: DomainManifest = {packageId: 'inside', version: 1, subjects: [{id: 'one', displayName: 'Same', aliases: ['one']}, {id: 'two', displayName: 'SAME', aliases: ['two']}]};
    expect(() => createDomainRegistry([inside])).toThrow(/subject two has the same display name as subject one/);
    // Hebrew points do not tell two names apart.
    const hebrew: DomainManifest = {packageId: 'hebrew', version: 1, subjects: [{id: 'a', displayName: 'מזבח', aliases: ['a']}, {id: 'b', displayName: 'מִזְבֵּחַ', aliases: ['b']}]};
    expect(() => createDomainRegistry([hebrew])).toThrow(/same display name/);
    // Different names are fine.
    expect(() => createDomainRegistry([middotManifest, second('The incense altar')])).not.toThrow();
  });

  it('names every problem together', () => {
    const message = (() => {
      try {
        createDomainRegistry([middotManifest, middotManifest]);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    })();
    expect(message).toMatch(/package middot is already registered/);
    expect(message).toMatch(/subject middot-altar-ramp is already registered/);
  });

  it('lets two subjects share an alias', () => {
    const registry = createDomainRegistry([middotManifest, fixtureIncenseManifest]);
    const shared = registry.subjects().filter((subject) => subject.aliases.includes('altar'));
    expect(shared.map((subject) => subject.id)).toEqual(['middot-altar-ramp', 'fixture-incense-altar']);
  });

  it('is a snapshot: changing a manifest afterwards changes nothing', () => {
    const manifest = good();
    const registry = createDomainRegistry([manifest]);
    (manifest.subjects[0].aliases as string[]).push('later');
    expect(registry.subject('middot-altar-ramp')?.aliases).toEqual(['altar', 'ramp']);
    expect(Object.isFrozen(registry.subjects())).toBe(true);
  });
});
