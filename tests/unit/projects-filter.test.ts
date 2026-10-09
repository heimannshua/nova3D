import {describe, expect, it} from 'vitest';
import {clampPercent} from '@/lib/progress';
import {createTranslator} from '@/lib/i18n';
import {filterProjects} from '@/lib/projects-filter';
import {mockProjects} from '@/lib/mock-data';

const ids = (query: string, locale: 'en' | 'he') => filterProjects(mockProjects, query, createTranslator(locale), locale).map((project) => project.id);

describe('My Projects filter', () => {
  it('keeps every project for an empty or blank search', () => {
    expect(ids('', 'en')).toEqual(mockProjects.map((project) => project.id));
    expect(ids('   ', 'en')).toEqual(mockProjects.map((project) => project.id));
  });

  it('matches the title in the current language, without regard to case', () => {
    expect(ids('altar', 'en')).toEqual(['outer-altar-ramp']);
    expect(ids('ALTAR', 'en')).toEqual(['outer-altar-ramp']);
    expect(ids('bench', 'en')).toEqual(['courtyard-bench']);
  });

  it('matches the subtitle too', () => {
    expect(ids('image-derived', 'en')).toEqual(['garden-arch']);
    expect(ids('middot', 'en')).toEqual(['outer-altar-ramp', 'courtyard-bench']);
  });

  it('matches Hebrew text for the Hebrew interface', () => {
    expect(ids('מזבח', 'he')).toEqual(['outer-altar-ramp']);
    expect(ids('ספסל', 'he')).toEqual(['courtyard-bench']);
    expect(ids('מידות', 'he')).toEqual(['outer-altar-ramp', 'courtyard-bench']);
  });

  it('reads the current language only: a Hebrew query finds nothing in English, and the reverse', () => {
    expect(ids('מזבח', 'en')).toEqual([]);
    expect(ids('altar', 'he')).toEqual([]);
  });

  it('trims whitespace around the search', () => {
    expect(ids('  altar  ', 'en')).toEqual(['outer-altar-ramp']);
    expect(ids('\tמזבח\n', 'he')).toEqual(['outer-altar-ramp']);
  });

  it('returns no projects when nothing matches', () => {
    expect(ids('zzz-no-such-project', 'en')).toEqual([]);
    expect(ids('חיפוש שלא קיים', 'he')).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const before = mockProjects.map((project) => project.id);
    filterProjects(mockProjects, 'altar', createTranslator('en'));
    expect(mockProjects.map((project) => project.id)).toEqual(before);
  });
});

describe('progress values', () => {
  it('holds a value to 0 to 100 and treats anything that is not a number as 0', () => {
    expect(clampPercent(34)).toBe(34);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(100)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(250)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampPercent(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
