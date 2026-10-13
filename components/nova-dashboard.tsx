'use client';

import Link from 'next/link';
import {useI18n} from '@/lib/i18n/react';
import {projectPath, projectsPath, type ProjectRow} from '@/lib/project-view';
import {Button, LinkButton} from './ui/button';
import {GuidanceCard} from './ui/guidance-card';
import {Icon, type IconName} from './ui/icon';
import {EmptyState} from './ui/states';
import {StatusBadge} from './ui/status-badge';
import {Unreadable} from './projects/unreadable';
import {ProjectCard} from './projects/project-card';
import {ProjectsList} from './projects/projects-list';
import {useShell} from './shell/shell-context';

export type DashboardView = 'home' | 'projects' | 'progress';

/**
 * What a page read of the Account's Projects: the Projects (newest update first) and how many there are in all, or that they could
 * not be read. An unreadable list is never shown as an empty one: "you have none" and "we could not look" are different things.
 */
export type ProjectsListing = {state: 'listed'; projects: ProjectRow[]; total: number} | {state: 'unreadable'};

function ActionCard({icon, title, copy, detail, tone, href, onClick}: {icon: IconName; title: string; copy: string; detail?: string; tone: 'violet' | 'blue' | 'amber'; href?: string; onClick?: () => void}) {
  const inner = (
    <>
      <span className="action-icon"><Icon name={icon} size={22}/></span>
      <span className="action-copy"><strong>{title}</strong><small>{copy}</small></span>
      <span className="action-detail">{detail}<Icon name="arrow" size={15}/></span>
    </>
  );
  const className = `action-card action-${tone}`;
  return href ? <Link href={href} className={className}>{inner}</Link> : <button type="button" className={className} onClick={onClick}>{inner}</button>;
}

/**
 * Home (H-01): the three primary actions with real counts (the number of Projects; no Jobs exist yet), the most recent Projects, and
 * an honest empty state for an Account that has none. Nothing here is sample data. The page does not name anyone: an Account has a
 * verified address and nothing else, and the Account panel shows it.
 */
function Home({listing}: {listing: ProjectsListing}) {
  const {t} = useI18n();
  const {openCreate} = useShell();
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">{t('nav.workspace')}</p>
          <h1>{t('home.title')}</h1>
          <p className="lede">{t('home.lede')}</p>
        </div>
        <Button variant="primary" icon="plus" className="desktop-create" onClick={openCreate}>{t('home.newProject')}</Button>
      </div>
      <GuidanceCard/>
      <section className="hero-grid" aria-label={t('a11y.primaryActions')}>
        <ActionCard
          icon="folder"
          tone="violet"
          title={t('nav.projects')}
          copy={t('home.projectsCopy')}
          detail={listing.state === 'listed' ? t('home.projectsDetail', {count: listing.total}) : undefined}
          href={projectsPath}
        />
        <ActionCard icon="plus" tone="blue" title={t('nav.create')} copy={t('home.createCopy')} detail={t('home.createDetail')} onClick={openCreate}/>
        <ActionCard icon="activity" tone="amber" title={t('nav.progress')} copy={t('home.progressCopy')} detail={t('home.progressNone')} href="/progress"/>
      </section>
      <section className="section">
        <div className="section-heading">
          <div><p className="eyebrow">{t('home.recentEyebrow')}</p><h2>{t('home.recentTitle')}</h2></div>
          {listing.state === 'listed' && listing.total > 0 ? <Link href={projectsPath} className="text-link">{t('home.viewAll')}<Icon name="arrow" size={15}/></Link> : null}
        </div>
        {listing.state === 'unreadable' ? (
          <Unreadable title="projects.error.title" body="projects.error.body" headingLevel={2}/>
        ) : listing.projects.length === 0 ? (
          <EmptyState icon="folder" title={t('projects.noneTitle')} action={<Button variant="primary" icon="plus" onClick={openCreate}>{t('projects.new')}</Button>}>
            {t('projects.noneBody')}
          </EmptyState>
        ) : (
          <ul className="card-grid">
            {listing.projects.map((project) => <li key={project.id}><ProjectCard project={project} href={projectPath(project.id)}/></li>)}
          </ul>
        )}
      </section>
    </>
  );
}

/** My Projects (H-02): the title row, then the searchable list, or why there is none to show. */
function Projects({listing}: {listing: ProjectsListing}) {
  const {t} = useI18n();
  const {openCreate} = useShell();
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">{t('nav.workspace')}</p>
          <h1>{t('nav.projects')}</h1>
          <p className="lede">{t('projects.lede')}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={openCreate}>{t('projects.new')}</Button>
      </div>
      {listing.state === 'unreadable' ? (
        <div className="section"><Unreadable title="projects.error.title" body="projects.error.body" headingLevel={2}/></div>
      ) : (
        <ProjectsList projects={listing.projects} total={listing.total}/>
      )}
    </>
  );
}

/**
 * In Progress (H-05): there are no Jobs yet, so it says so, and says what will appear here. "Prints in Progress" is a future
 * capability and is shown as one.
 */
function InProgress() {
  const {t} = useI18n();
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">{t('nav.workspace')}</p>
          <h1>{t('nav.progress')}</h1>
          <p className="lede">{t('progress.lede')}</p>
        </div>
      </div>
      <div className="section">
        <EmptyState
          icon="activity"
          title={t('progress.noneTitle')}
          action={<LinkButton variant="secondary" href={projectsPath} iconAfter="arrow">{t('progress.seeProjects')}</LinkButton>}
        >
          {t('progress.noneBody')}
        </EmptyState>
      </div>
      <ul className="job-list">
        <li className="coming-card">
          <span className="job-icon"><Icon name="spark"/></span>
          <div className="coming-main">
            <p className="eyebrow">{t('progress.futureKind')}</p>
            <h2>{t('progress.printsTitle')}</h2>
            <p>{t('progress.printsBody')}</p>
          </div>
          <StatusBadge tone="neutral">{t('progress.comingLater')}</StatusBadge>
        </li>
      </ul>
    </>
  );
}

/**
 * The content of Home, My Projects and In Progress. The shell around it (navigation, Create dialog) comes from the layout, so the
 * same chrome frames every page. The Projects come from the page, which read them from the database for the verified Account.
 */
export function NovaDashboard(props: {view: 'home' | 'projects'; listing: ProjectsListing} | {view: 'progress'; listing?: undefined}) {
  return (
    <div className="page">
      {props.view === 'home' ? <Home listing={props.listing}/> : null}
      {props.view === 'projects' ? <Projects listing={props.listing}/> : null}
      {props.view === 'progress' ? <InProgress/> : null}
    </div>
  );
}
