import type {Translator} from './i18n';
import type {MockProject} from './mock-data';

/**
 * The projects whose title or subtitle contains the search text, as they read in the current language.
 * The text is trimmed and compared without regard to case; an empty search keeps every project.
 */
export function filterProjects(projects: readonly MockProject[], query: string, t: Translator, locale?: string): MockProject[] {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (!needle) return [...projects];
  return projects.filter((project) => `${t(project.title)} ${t(project.subtitle)}`.toLocaleLowerCase(locale).includes(needle));
}
