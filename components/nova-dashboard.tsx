'use client';

import {useMemo, useState} from 'react';
import {mockProjects, type MockProject} from '@/lib/mock-data';

type View = 'home' | 'projects' | 'create' | 'progress';
type IconName = 'grid' | 'folder' | 'plus' | 'activity' | 'bell' | 'settings' | 'arrow' | 'search' | 'spark' | 'image' | 'text' | 'close' | 'check' | 'clock' | 'dots';

function Icon({name, size = 18}: {name: IconName; size?: number}) {
  const common = {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true};
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    folder: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M3 9h18"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    activity: <><path d="M4 14.5 8 10l3 3 5-7 4 3.5"/><path d="M4 19h16"/></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 22h4"/></>,
    settings: <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a2 2 0 1 1-4 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.8 1.8 0 0 0 2.3 12a1.8 1.8 0 0 0 1.3-3.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.8 1.8 0 0 0 9.5 4.8v-.2a2 2 0 1 1 4 0v.2a1.8 1.8 0 0 0 3.1 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.8 1.8 0 0 0 20.7 12a1.8 1.8 0 0 0-1.3 3.1Z"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></>,
    spark: <><path d="m12 3-1.3 5.7L5 10l5.7 1.3L12 17l1.3-5.7L19 10l-5.7-1.3z"/><path d="m19 16-.5 2.5L16 19l2.5.5L19 22l.5-2.5L22 19l-2.5-.5z"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-4.5-4.5L7 20"/></>,
    text: <><path d="M4 6h16M4 12h11M4 18h16"/><path d="M18 10v8M14 14h8"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></>,
    dots: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Brand() {
  return <div className="brand" aria-label="nova3D home"><span className="brand-mark"><i/><i/><i/></span><span>nova<span className="brand-accent">3D</span></span></div>;
}

function NavItem({active, icon, label, onClick}: {active: boolean; icon: IconName; label: string; onClick: () => void}) {
  return <button type="button" className={`nav-item ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}><Icon name={icon}/><span>{label}</span></button>;
}

function StatusPill({status}: {status: MockProject['status']}) {
  const config = {
    'Ready for review': {className: 'pill-ready', icon: 'check' as IconName},
    Researching: {className: 'pill-running', icon: 'activity' as IconName},
    'Saved locally': {className: 'pill-local', icon: 'clock' as IconName},
  }[status];
  return <span className={`status-pill ${config.className}`}><Icon name={config.icon} size={13}/>{status}</span>;
}

function ProjectCard({project, onOpen}: {project: MockProject; onOpen: () => void}) {
  return <article className="project-card" role="button" onClick={onOpen} tabIndex={0} onKeyDown={(event) => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); onOpen();}}}>
    <div className={`project-visual visual-${project.tone}`}><div className="visual-grid"/><div className="shape shape-back"/><div className="shape shape-front"/><span className="visual-label">{project.mode === 'Image-derived' ? 'LOCAL' : '3D'}</span></div>
    <div className="project-body">
      <div className="project-card-heading"><div><p className="eyebrow">{project.mode}</p><h3>{project.title}</h3></div><button type="button" className="icon-button" aria-label={`More actions for ${project.title}`} onClick={(event) => event.stopPropagation()}><Icon name="dots"/></button></div>
      <p className="project-subtitle">{project.subtitle}</p>
      {project.progress !== undefined && <div className="progress-wrap"><div className="progress-label"><span>Research plan</span><strong>{project.progress}%</strong></div><div className="progress-track"><span style={{width: `${project.progress}%`}}/></div></div>}
      <div className="project-footer"><StatusPill status={project.status}/><span className="updated">{project.updated}</span></div>
    </div>
  </article>;
}

function CreatePanel({onClose, onContinue}: {onClose: () => void; onContinue: () => void}) {
  const [choice, setChoice] = useState<'text' | 'image' | null>(null);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {if (event.target === event.currentTarget) onClose();}}><section className="create-panel" role="dialog" aria-modal="true" aria-labelledby="create-title">
    <div className="panel-heading"><div><p className="eyebrow">New project</p><h2 id="create-title">What would you like to make?</h2><p>Start with an idea or a few pictures. You stay in control at every approval step.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close create project"><Icon name="close"/></button></div>
    <div className="creation-options">
      <button type="button" className={`creation-option ${choice === 'text' ? 'selected' : ''}`} onClick={() => setChoice('text')}><span className="option-icon option-violet"><Icon name="text" size={22}/></span><span><strong>Enter text</strong><small>Describe a model in your own words</small></span><Icon name="arrow" size={17}/></button>
      <button type="button" className={`creation-option ${choice === 'image' ? 'selected' : ''}`} onClick={() => setChoice('image')}><span className="option-icon option-blue"><Icon name="image" size={22}/></span><span><strong>Upload picture</strong><small>Use one or several views of an object</small></span><Icon name="arrow" size={17}/></button>
    </div>
    {choice && <div className="choice-next"><div className="choice-check"><Icon name="check" size={16}/></div><p><strong>{choice === 'text' ? 'Text intake selected' : 'Picture intake selected'}</strong><br/><span>{choice === 'image' ? 'Picture quality and coverage will be checked before conversion.' : 'We will show our understanding before any research begins.'}</span></p><button type="button" className="button button-primary" onClick={onContinue}>Continue <Icon name="arrow" size={15}/></button></div>}
    <p className="panel-footnote"><span className="dot dot-green"/>Mock mode · no files or provider calls are made yet</p>
  </section></div>;
}

function Header({onCreate, onBell}: {onCreate: () => void; onBell: () => void}) {
  return <header className="topbar"><div className="mobile-brand"><Brand/></div><div className="header-spacer"/><button type="button" className="header-button notification-button" onClick={onBell} aria-label="Notifications, one unread"><Icon name="bell"/><span className="notification-dot"/></button><button type="button" className="header-button" aria-label="Settings"><Icon name="settings"/></button><div className="account-chip"><span className="avatar">J</span><span className="account-name">Josh</span><span className="account-chevron">⌄</span></div><button type="button" className="mobile-create" onClick={onCreate}><Icon name="plus" size={19}/><span>Create</span></button></header>;
}

function Sidebar({view, onNavigate, onCreate}: {view: View; onNavigate: (view: View) => void; onCreate: () => void}) {
  return <aside className="sidebar"><Brand/><div className="sidebar-label">Workspace</div><nav><NavItem active={view === 'home'} icon="grid" label="Home" onClick={() => onNavigate('home')}/><NavItem active={view === 'projects'} icon="folder" label="My Projects" onClick={() => onNavigate('projects')}/><NavItem active={view === 'progress'} icon="activity" label="In Progress" onClick={() => onNavigate('progress')}/></nav><button type="button" className="sidebar-create" onClick={onCreate}><span><Icon name="plus" size={17}/>Create</span><kbd>⌘ K</kbd></button><div className="sidebar-bottom"><div className="mode-card"><span className="mode-icon"><Icon name="spark" size={15}/></span><div><strong>Mock mode</strong><small>Provider calls are off</small></div><span className="mode-live"/></div><button type="button" className="help-link"><span className="help-mark">?</span>Help &amp; guidance</button><div className="sidebar-meta">nova3D <span>·</span> private workspace</div></div></aside>;
}

export function NovaDashboard() {
  const [view, setView] = useState<View>('home');
  const [createOpen, setCreateOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visibleProjects = useMemo(() => mockProjects.filter((project) => `${project.title} ${project.subtitle}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const navigate = (next: View) => {setView(next); setNoticeOpen(false);};
  return <div className="app-shell"><Sidebar view={view} onNavigate={navigate} onCreate={() => setCreateOpen(true)}/><div className="main-column"><Header onCreate={() => setCreateOpen(true)} onBell={() => setNoticeOpen((open) => !open)}/>{noticeOpen && <div className="notification-popover" role="status"><div className="popover-heading"><span>Notifications</span><span className="unread-label">1 unread</span></div><button type="button" onClick={() => navigate('projects')}><span className="popover-icon"><Icon name="check" size={14}/></span><span><strong>Review is ready</strong><small>Outer Altar and Ramp has a research plan waiting for you.</small></span><Icon name="arrow" size={15}/></button></div>}<main className="page-content">{view === 'home' && <Home onCreate={() => setCreateOpen(true)} onNavigate={navigate}/>} {view === 'projects' && <Projects projects={visibleProjects} query={query} onQuery={setQuery} onCreate={() => setCreateOpen(true)}/>} {view === 'progress' && <Progress onNavigate={navigate}/>}</main></div>{createOpen && <CreatePanel onClose={() => setCreateOpen(false)} onContinue={() => setCreateOpen(false)}/>}</div>;
}

function Home({onCreate, onNavigate}: {onCreate: () => void; onNavigate: (view: View) => void}) {
  return <><div className="welcome-row"><div><p className="eyebrow">Monday, September 14, 2026</p><h1>Good morning, Josh<span className="wave">✦</span></h1><p className="lede">Turn an idea into something you can understand, inspect, and make.</p></div><button type="button" className="button button-primary desktop-create" onClick={onCreate}><Icon name="plus" size={17}/> New project</button></div><div className="mock-notice"><span className="notice-icon"><Icon name="spark" size={16}/></span><p><strong>You’re exploring nova3D in mock mode.</strong> Your projects below use synthetic data while provider connections are being prepared.</p><button type="button" className="notice-link">Learn about setup <Icon name="arrow" size={14}/></button></div><section className="hero-grid" aria-label="Primary actions"><ActionCard icon="folder" title="My Projects" copy="Pick up where you left off." detail="3 projects" className="action-violet" onClick={() => onNavigate('projects')}/><ActionCard icon="plus" title="Create" copy="Start from words or pictures." detail="New project" className="action-blue" onClick={onCreate}/><ActionCard icon="activity" title="In Progress" copy="See work happening now." detail="1 active job" className="action-amber" onClick={() => onNavigate('progress')}/></section><section className="section-heading"><div><p className="eyebrow">Your workspace</p><h2>Recent projects</h2></div><button type="button" className="text-button" onClick={() => onNavigate('projects')}>View all <Icon name="arrow" size={15}/></button></section><div className="projects-grid">{mockProjects.slice(0, 2).map((project) => <ProjectCard key={project.id} project={project} onOpen={() => onNavigate('projects')}/>)}</div><div className="lower-grid"><section className="activity-card"><div className="section-heading compact"><div><p className="eyebrow">Latest activity</p><h2>Keep your momentum</h2></div><span className="activity-count">3 updates</span></div><div className="activity-list"><ActivityRow icon="check" tone="green" title="Research plan ready to review" detail="Outer Altar and Ramp" time="12 min ago"/><ActivityRow icon="activity" tone="amber" title="Research is running" detail="Courtyard bench" time="Active"/><ActivityRow icon="clock" tone="blue" title="Saved on this device" detail="Garden arch study" time="Yesterday"/></div></section><section className="guidance-card"><span className="guidance-spark"><Icon name="spark" size={18}/></span><p className="eyebrow">A helpful start</p><h2>Every step stays visible.</h2><p>nova3D keeps sources, decisions, versions, and validation together so you can review the path before exporting.</p><button type="button" className="text-button">Open guidance <Icon name="arrow" size={15}/></button></section></div></>;
}

function ActionCard({icon, title, copy, detail, className, onClick}: {icon: IconName; title: string; copy: string; detail: string; className: string; onClick: () => void}) {
  return <button type="button" className={`action-card ${className}`} onClick={onClick}><span className="action-icon"><Icon name={icon} size={22}/></span><span className="action-copy"><strong>{title}</strong><small>{copy}</small></span><span className="action-detail">{detail}<Icon name="arrow" size={15}/></span></button>;
}

function Projects({projects, query, onQuery, onCreate}: {projects: MockProject[]; query: string; onQuery: (value: string) => void; onCreate: () => void}) {
  return <><div className="page-title-row"><div><p className="eyebrow">Workspace</p><h1>My Projects</h1><p className="lede">Your private collection of models and versions.</p></div><button type="button" className="button button-primary" onClick={onCreate}><Icon name="plus" size={17}/> New project</button></div><div className="toolbar"><label className="search-box"><Icon name="search" size={17}/><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects"/></label><button type="button" className="filter-button">All projects <span>⌄</span></button></div><div className="projects-grid projects-grid-full">{projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => undefined}/>)}</div>{projects.length === 0 && <div className="empty-state"><span className="empty-icon"><Icon name="search"/></span><h2>No matching projects</h2><p>Try a different search term.</p></div>}</>;
}

function Progress({onNavigate}: {onNavigate: (view: View) => void}) {
  return <><div className="page-title-row"><div><p className="eyebrow">Workspace</p><h1>In Progress</h1><p className="lede">Background work stays visible while you keep moving.</p></div><span className="live-badge"><i/>1 active job</span></div><section className="job-list"><article className="job-card"><div className="job-icon job-icon-amber"><Icon name="activity"/></div><div className="job-main"><div className="job-heading"><div><p className="eyebrow">Research · evidence-backed</p><h2>Courtyard bench</h2></div><span className="job-state">Running</span></div><p>Looking for relevant sources. You can keep working in other projects while this runs.</p><div className="job-progress"><div className="progress-track"><span style={{width: '34%'}}/></div><strong>34%</strong></div><div className="job-meta"><span><Icon name="clock" size={14}/> Started 8 min ago</span><span>Estimated time shown when available</span></div></div><button type="button" className="icon-button" aria-label="More job actions"><Icon name="dots"/></button></article><article className="coming-card"><div className="coming-icon"><Icon name="spark"/></div><div><p className="eyebrow">Future capability</p><h2>Prints in Progress</h2><p>Printer control will arrive later. Your exported files remain yours to download and use.</p></div><span className="coming-pill">Coming later</span></article></section><div className="progress-note"><span className="notice-icon"><Icon name="check" size={16}/></span><p><strong>Nothing is hidden.</strong> Failed jobs preserve your last approved state and wait for your decision.</p><button type="button" className="text-button" onClick={() => onNavigate('projects')}>See projects <Icon name="arrow" size={15}/></button></div></>;
}

function ActivityRow({icon, tone, title, detail, time}: {icon: IconName; tone: string; title: string; detail: string; time: string}) {
  return <div className="activity-row"><span className={`activity-icon activity-${tone}`}><Icon name={icon} size={15}/></span><span className="activity-copy"><strong>{title}</strong><small>{detail}</small></span><time>{time}</time></div>;
}
