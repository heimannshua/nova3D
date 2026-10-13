'use client';

import {useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {isProjectStage, projectStages, stageDefinition} from '@/lib/project-stage';
import {projectPath, type ProjectRow} from '@/lib/project-view';
import {filterProjects, isFiltering, noFilter, type ProjectFilter} from '@/lib/projects-filter';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {Icon} from '../ui/icon';
import {EmptyState, Notice} from '../ui/states';
import {useShell} from '../shell/shell-context';
import {ProjectCard} from './project-card';

/**
 * The body of My Projects (H-02): search by title, filter by stage, and the cards, newest update first (the order the server gave).
 * Three things are told apart, because they need different words: the Account has no Projects at all ("No projects yet", with
 * Create), a search or filter that matches none ("No matching projects", with a way to clear it), and Projects that match (the
 * cards). The count that is left is announced politely whenever it changes, because typing does not move focus.
 *
 * The search runs here, over the list the server read, and the words typed go nowhere: no request, no address, no log.
 */
export function ProjectsList({projects, total}: {projects: ProjectRow[]; total: number}) {
  const {t, locale} = useI18n();
  const {openCreate} = useShell();
  const announce = useAnnounce();
  const [filter, setFilter] = useState<ProjectFilter>(noFilter);
  const search = useRef<HTMLInputElement>(null);
  const visible = filterProjects(projects, filter, locale);

  function change(next: ProjectFilter) {
    setFilter(next);
    announce(t('projects.resultCount', {count: filterProjects(projects, next, locale).length}), locale);
  }

  if (projects.length === 0) {
    return (
      <div className="section">
        <EmptyState icon="folder" title={t('projects.noneTitle')} action={<Button variant="primary" icon="plus" onClick={openCreate}>{t('projects.new')}</Button>}>
          {t('projects.noneBody')}
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar" role="search">
        <label className="search-box">
          <Icon name="search" size={17}/>
          <input
            ref={search}
            type="search"
            value={filter.query}
            onChange={(event) => change({...filter, query: event.target.value})}
            placeholder={t('projects.search')}
            aria-label={t('projects.search')}
          />
        </label>
        <label className="filter-box">
          <span className="visually-hidden">{t('projects.filterLabel')}</span>
          <select
            value={filter.stage}
            onChange={(event) => change({...filter, stage: isProjectStage(event.target.value) ? event.target.value : 'all'})}
          >
            <option value="all">{t('projects.filterAllStages')}</option>
            {projectStages.map((stage) => <option key={stage} value={stage}>{t(stageDefinition(stage).label)}</option>)}
          </select>
          <Icon name="chevron-down" size={15}/>
        </label>
      </div>
      <p className="result-count">{t('projects.resultCount', {count: visible.length})}</p>
      {total > projects.length ? <div className="invite-notice"><Notice tone="info">{t('projects.capped', {count: projects.length, total})}</Notice></div> : null}
      {visible.length > 0 ? (
        <ul className="card-grid card-grid-wide" aria-label={t('projects.listLabel')}>
          {visible.map((project) => <li key={project.id}><ProjectCard project={project} href={projectPath(project.id)} headingLevel={2}/></li>)}
        </ul>
      ) : (
        <div className="section">
          <EmptyState
            title={t('projects.emptyTitle')}
            action={isFiltering(filter) ? <Button variant="secondary" onClick={() => {
              change(noFilter);
              // The button is in the "no match" state, which goes away as the list comes back: focus goes to the search field, not the page.
              search.current?.focus();
            }}>{t('projects.clearFilters')}</Button> : undefined}
          >
            {t('projects.emptyBody')}
          </EmptyState>
        </div>
      )}
    </>
  );
}
