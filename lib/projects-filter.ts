import type {ProjectStage} from './project-stage';

/** What My Projects narrows its list by: text in the title, and/or one stage. `all` is every stage. */
export type ProjectFilter = {query: string; stage: ProjectStage | 'all'};

export const noFilter: ProjectFilter = {query: '', stage: 'all'};

/** Whether anything narrows the list. A search of nothing but white space does not. */
export function isFiltering(filter: ProjectFilter): boolean {
  return filter.query.trim() !== '' || filter.stage !== 'all';
}

/**
 * The Projects whose title contains the search text and (when a stage is chosen) that are in that stage, in the order they were
 * given. The text is trimmed and compared without regard to case; an empty search keeps every Project. Only the title is searched,
 * and it is searched on the page, in the browser, over the list the server already read: the words typed are never sent anywhere,
 * so they reach no URL and no log.
 */
export function filterProjects<T extends {title: string; stage: ProjectStage}>(projects: readonly T[], filter: ProjectFilter, locale?: string): T[] {
  const needle = filter.query.trim().toLocaleLowerCase(locale);
  return projects.filter(
    (project) => (filter.stage === 'all' || project.stage === filter.stage) && (!needle || project.title.toLocaleLowerCase(locale).includes(needle)),
  );
}
