'use client';

import Link from 'next/link';
import {useMemo, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {clampPercent} from '@/lib/progress';
import {filterProjects} from '@/lib/projects-filter';
import {mockProjects, sampleAccount, type MockProject, type ProjectMode, type ProjectStatus} from '@/lib/mock-data';
import {Button, IconButton} from './ui/button';
import {useAnnounce} from './ui/announcer';
import {GuidanceCard} from './ui/guidance-card';
import {Icon, type IconName} from './ui/icon';
import {EmptyState, Notice} from './ui/states';
import {StatusBadge, type StatusTone} from './ui/status-badge';
import {LtrToken} from './ui/text-span';
import {useShell} from './shell/shell-context';

export type DashboardView = 'home' | 'projects' | 'progress';

const statusDisplay: Record<ProjectStatus, {label: MessageKey; tone: StatusTone; icon: IconName}> = {
  'ready-for-review': {label: 'status.ready', tone: 'success', icon: 'check-circle'},
  researching: {label: 'status.researching', tone: 'running', icon: 'activity'},
  'sample-draft': {label: 'status.sampleDraft', tone: 'neutral', icon: 'clock'},
};

const modeLabel: Record<ProjectMode, MessageKey> = {
  'evidence-backed': 'mode.evidence',
  'image-derived': 'mode.image',
};

export function Progress({value, label}: {value: number; label: string}) {
  const percent = clampPercent(value);
  return (
    <div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span className="progress-fill" style={{width: `${percent}%`}}/>
    </div>
  );
}

export function ProjectCard({project, href, headingLevel = 3}: {project: MockProject; href?: string; headingLevel?: 2 | 3}) {
  const {t} = useI18n();
  const title = t(project.title);
  const status = statusDisplay[project.status];
  const headingId = `project-${project.id}-title`;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="project-card" aria-labelledby={headingId}>
      <div className={`project-visual visual-${project.tone}`}>
        <div className="visual-art" aria-hidden="true"><div className="visual-grid"/><div className="shape shape-back"/><div className="shape shape-front"/></div>
        <span className="visual-label">{t('sample.label')}</span>
      </div>
      <div className="project-body">
        <div className="project-card-heading">
          <div>
            <p className="eyebrow">{t(modeLabel[project.mode])}</p>
            <Heading id={headingId}>{href ? <Link className="card-link" href={href}>{title}</Link> : title}</Heading>
          </div>
          {/* Sample-only control: disabled so nothing is offered that does nothing. */}
          <IconButton icon="dots" label={t('projects.cardMore', {title})} disabled className="card-more"/>
        </div>
        <p className="project-subtitle">{t(project.subtitle)}</p>
        {project.progress !== undefined ? (
          <div className="progress-wrap">
            <div className="progress-label"><span>{t('projects.researchPlan')}</span><strong><LtrToken>{clampPercent(project.progress)}%</LtrToken></strong></div>
            <Progress value={project.progress} label={t('projects.researchPlan')}/>
          </div>
        ) : null}
        <div className="project-footer">
          <StatusBadge tone={status.tone} icon={status.icon}>{t(status.label)}</StatusBadge>
          <span className="updated">{t(project.updated)}</span>
        </div>
      </div>
    </article>
  );
}

function ActionCard({icon, title, copy, detail, tone, href, onClick}: {icon: IconName; title: string; copy: string; detail: string; tone: 'violet' | 'blue' | 'amber'; href?: string; onClick?: () => void}) {
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

function ActivityRow({icon, tone, title, detail, time}: {icon: IconName; tone: 'success' | 'running' | 'neutral'; title: string; detail: string; time: string}) {
  return (
    <li className="activity-row">
      <span className={`activity-icon tone-${tone}`}><Icon name={icon} size={15}/></span>
      <span className="activity-copy"><strong>{title}</strong><small>{detail}</small></span>
      <span className="activity-time">{time}</span>
    </li>
  );
}

function Home() {
  const {t} = useI18n();
  const {openCreate} = useShell();
  const [outerAltar, gardenArch, courtyardBench] = mockProjects;
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">{t('sample.date')}</p>
          <h1>{t('home.greeting', {name: sampleAccount.name})}<span className="wave" aria-hidden="true"><Icon name="spark" size={20}/></span></h1>
          <p className="lede">{t('home.lede')}</p>
        </div>
        <Button variant="primary" icon="plus" className="desktop-create" onClick={openCreate}>{t('home.newProject')}</Button>
      </div>
      <Notice tone="info"><strong>{t('home.noticeLead')}</strong> {t('home.noticeBody')}</Notice>
      <GuidanceCard/>
      <section className="hero-grid" aria-label={t('a11y.primaryActions')}>
        <ActionCard icon="folder" tone="violet" title={t('nav.projects')} copy={t('home.projectsCopy')} detail={t('home.projectsDetail', {count: mockProjects.length})} href="/projects"/>
        <ActionCard icon="plus" tone="blue" title={t('nav.create')} copy={t('home.createCopy')} detail={t('home.createDetail')} onClick={openCreate}/>
        <ActionCard icon="activity" tone="amber" title={t('nav.progress')} copy={t('home.progressCopy')} detail={t('home.progressDetail', {count: 1})} href="/progress"/>
      </section>
      <section className="section">
        <div className="section-heading">
          <div><p className="eyebrow">{t('home.recentEyebrow')}</p><h2>{t('home.recentTitle')}</h2></div>
          <Link href="/projects" className="text-link">{t('home.viewAll')}<Icon name="arrow" size={15}/></Link>
        </div>
        <ul className="card-grid">
          {[outerAltar, gardenArch].map((project) => <li key={project.id}><ProjectCard project={project} href="/projects"/></li>)}
        </ul>
      </section>
      <section className="section activity-card">
        <div className="section-heading compact">
          <div><p className="eyebrow">{t('home.activityEyebrow')}</p><h2>{t('home.activityTitle')}</h2></div>
          <span className="activity-count">{t('home.activityCount', {count: 3})}</span>
        </div>
        <ul className="activity-list">
          <ActivityRow icon="check-circle" tone="success" title={t('home.activityPlanReady')} detail={t(outerAltar.title)} time={t('time.minutesAgo', {count: 12})}/>
          <ActivityRow icon="activity" tone="running" title={t('home.activityRunning')} detail={t(courtyardBench.title)} time={t('time.active')}/>
          <ActivityRow icon="clock" tone="neutral" title={t('home.activityDraft')} detail={t(gardenArch.title)} time={t('time.yesterday')}/>
        </ul>
      </section>
    </>
  );
}

function Projects() {
  const {t, locale} = useI18n();
  const {openCreate} = useShell();
  const announce = useAnnounce();
  const [query, setQuery] = useState('');
  const matching = useMemo(() => (text: string) => filterProjects(mockProjects, text, t, locale), [t, locale]);
  const visible = matching(query);

  function search(value: string) {
    setQuery(value);
    // Typing changes the list without moving focus, so say how many projects are left.
    announce(t('projects.resultCount', {count: matching(value).length}));
  }

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
      <div className="toolbar" role="search">
        <label className="search-box">
          <Icon name="search" size={17}/>
          <input type="search" value={query} onChange={(event) => search(event.target.value)} placeholder={t('projects.search')} aria-label={t('projects.search')}/>
        </label>
        {/* Sample-only control: filters arrive with My Projects (Story 1.7). */}
        <Button variant="secondary" iconAfter="chevron-down" disabled>{t('projects.filterAll')}</Button>
      </div>
      {visible.length > 0 ? (
        <ul className="card-grid card-grid-wide" aria-label={t('projects.listLabel')}>
          {visible.map((project) => <li key={project.id}><ProjectCard project={project} headingLevel={2}/></li>)}
        </ul>
      ) : (
        <EmptyState title={t('projects.emptyTitle')}>{t('projects.emptyBody')}</EmptyState>
      )}
    </>
  );
}

function InProgress() {
  const {t} = useI18n();
  const courtyardBench = mockProjects[2];
  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">{t('nav.workspace')}</p>
          <h1>{t('nav.progress')}</h1>
          <p className="lede">{t('progress.lede')}</p>
        </div>
        <StatusBadge tone="running">{t('progress.liveBadge', {count: 1})}</StatusBadge>
      </div>
      <ul className="job-list">
        <li className="job-card">
          <span className="job-icon"><Icon name="activity"/></span>
          <div className="job-main">
            <div className="job-heading">
              <div><p className="eyebrow">{t('progress.jobKind')}</p><h2>{t(courtyardBench.title)}</h2></div>
              <StatusBadge tone="running">{t('status.running')}</StatusBadge>
              {/* Sample-only control: job actions arrive with the job stories. */}
              <IconButton icon="dots" label={t('progress.jobMore')} disabled/>
            </div>
            <p className="job-body">{t('progress.jobBody')}</p>
            <div className="job-progress">
              <Progress value={34} label={t('progress.jobProgress')}/>
              <strong><LtrToken>34%</LtrToken></strong>
            </div>
            <p className="job-meta">
              <span><Icon name="clock" size={14}/>{t('progress.jobStarted', {count: 8})}</span>
              <span>{t('progress.jobEstimate')}</span>
            </p>
          </div>
        </li>
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
      <Notice tone="success" action={<Link href="/projects" className="text-link">{t('progress.seeProjects')}<Icon name="arrow" size={15}/></Link>}>
        <strong>{t('progress.noteLead')}</strong> {t('progress.noteBody')}
      </Notice>
    </>
  );
}

/**
 * The content of Home, My Projects and In Progress. The shell around it (navigation, banner, Create
 * dialog) comes from the layout, so the same chrome frames every page.
 */
export function NovaDashboard({view = 'home'}: {view?: DashboardView} = {}) {
  return (
    <div className="page">
      {view === 'home' ? <Home/> : null}
      {view === 'projects' ? <Projects/> : null}
      {view === 'progress' ? <InProgress/> : null}
    </div>
  );
}
