import {describe, expect, it} from 'vitest';
import {clampPercent} from '@/lib/progress';
import {fixtureRows} from '@/lib/project-fixtures';
import {filterProjects, isFiltering, noFilter, type ProjectFilter} from '@/lib/projects-filter';

const projects = fixtureRows();
const titles = (filter: Partial<ProjectFilter>, locale?: string) => filterProjects(projects, {...noFilter, ...filter}, locale).map((project) => project.title);
const all = projects.map((project) => project.title);

describe('My Projects filter', () => {
  it('keeps every project for an empty or blank search and no stage, in the order it was given', () => {
    expect(titles({})).toEqual(all);
    expect(titles({query: ''})).toEqual(all);
    expect(titles({query: '   '})).toEqual(all);
  });

  it('matches the title, without regard to case', () => {
    expect(titles({query: 'bench'})).toEqual(['Courtyard bench']);
    expect(titles({query: 'BENCH'})).toEqual(['Courtyard bench']);
    expect(titles({query: 'a'})).toEqual(all.filter((title) => title.toLowerCase().includes('a')));
  });

  it('matches Hebrew titles as they were written, in either interface language, because a title is the person\'s own text', () => {
    expect(titles({query: 'מזבח'}, 'he')).toEqual(['המזבח החיצון והכבש']);
    expect(titles({query: 'מזבח'}, 'en')).toEqual(['המזבח החיצון והכבש']);
    expect(titles({query: 'bench'}, 'he')).toEqual(['Courtyard bench']);
  });

  it('searches the title only: no other field of a project is matched', () => {
    // Stage labels, versions and times are not searched.
    expect(titles({query: 'researching'})).toEqual([]);
    expect(titles({query: 'validation'})).toEqual([]);
    expect(titles({query: '2026'})).toEqual([]);
  });

  it('trims whitespace around the search', () => {
    expect(titles({query: '  bench  '})).toEqual(['Courtyard bench']);
    expect(titles({query: '\tמזבח\n'}, 'he')).toEqual(['המזבח החיצון והכבש']);
  });

  it('filters by one stage, alone or with a search', () => {
    expect(titles({stage: 'export_ready'})).toEqual(['Reading lamp base']);
    expect(titles({stage: 'researching'})).toEqual(['Courtyard bench']);
    expect(titles({stage: 'export_ready', query: 'lamp'})).toEqual(['Reading lamp base']);
    expect(titles({stage: 'export_ready', query: 'bench'})).toEqual([]);
  });

  it('treats a search that is only a part of a word like a search (not a pattern)', () => {
    expect(titles({query: '.*'})).toEqual([]);
    expect(titles({query: '%'})).toEqual([]);
    expect(titles({query: '_'})).toEqual([]);
  });

  it('returns no projects when nothing matches', () => {
    expect(titles({query: 'zzz-no-such-project'})).toEqual([]);
    expect(titles({query: 'חיפוש שלא קיים'}, 'he')).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const before = projects.map((project) => project.id);
    filterProjects(projects, {query: 'bench', stage: 'all'});
    expect(projects.map((project) => project.id)).toEqual(before);
  });

  it('knows when something narrows the list: a search of only white space does not', () => {
    expect(isFiltering(noFilter)).toBe(false);
    expect(isFiltering({query: '   ', stage: 'all'})).toBe(false);
    expect(isFiltering({query: 'a', stage: 'all'})).toBe(true);
    expect(isFiltering({query: '', stage: 'generating'})).toBe(true);
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
