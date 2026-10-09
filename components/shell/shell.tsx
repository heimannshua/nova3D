'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useMemo, useState, type ReactNode} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {sampleAccount, sampleProjectById} from '@/lib/mock-data';
import {Icon, type IconName} from '../ui/icon';
import {Popover} from '../ui/popover';
import {mainContentId} from '../ui/skip-link';
import {Brand} from './brand';
import {CreateDialog} from './create-dialog';
import {isChromeless, isCurrent, parentRoute} from './routes';
import {ShellProvider} from './shell-context';

const links = [
  {href: '/', label: 'nav.home', icon: 'grid'},
  {href: '/projects', label: 'nav.projects', icon: 'folder'},
  {href: '/progress', label: 'nav.progress', icon: 'activity'},
] as const satisfies readonly {href: string; label: 'nav.home' | 'nav.projects' | 'nav.progress'; icon: IconName}[];

function SyntheticBanner() {
  const {t} = useI18n();
  return (
    <div className="synthetic-banner" role="note">
      <span className="synthetic-badge">{t('shell.syntheticBadge')}</span>
      <span>{t('shell.syntheticNote')}</span>
    </div>
  );
}

function NavLink({href, label, icon, pathname}: {href: string; label: string; icon: IconName; pathname: string}) {
  const current = isCurrent(pathname, href);
  return (
    <Link href={href} className={`nav-item${current ? ' active' : ''}`} aria-current={current ? 'page' : undefined}>
      <Icon name={icon}/>
      <span>{label}</span>
    </Link>
  );
}

function BackLink({pathname}: {pathname: string}) {
  const {t} = useI18n();
  const parent = parentRoute(pathname);
  if (!parent) return null;
  // The visible word is short so it fits a phone. The accessible name says where it goes when that is Home,
  // and is the plain word for any deeper page, so it never names a place it does not lead to.
  return (
    <Link href={parent} className="back-link" aria-label={parent === '/' ? t('nav.backToHome') : t('nav.back')}>
      <Icon name="back"/>
      <span>{t('nav.back')}</span>
    </Link>
  );
}

function NotificationsMenu({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
  const {t} = useI18n();
  const unread = 1;
  const project = sampleProjectById('outer-altar-ramp');
  return (
    <Popover
      icon="bell"
      label={t('notifications.button', {count: unread})}
      panelLabel={t('notifications.title')}
      open={open}
      onOpenChange={onOpenChange}
      badge={<span className="notification-dot" aria-hidden="true"/>}
    >
      <div className="popover-heading">
        <strong>{t('notifications.title')}</strong>
        <span className="unread-label">{t('notifications.unread', {count: unread})}</span>
      </div>
      <Link href="/projects" className="popover-item" onClick={() => onOpenChange(false)}>
        <span className="popover-icon"><Icon name="check" size={14}/></span>
        <span className="popover-item-text">
          <strong>{t('notifications.sampleTitle')}</strong>
          <small>{t('notifications.sampleBody', {project: t(project.title)})}</small>
        </span>
        <Icon name="arrow" size={15}/>
      </Link>
    </Popover>
  );
}

function AccountMenu({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
  const {t} = useI18n();
  return (
    <Popover
      icon="person"
      label={t('nav.account')}
      panelLabel={t('account.title')}
      open={open}
      onOpenChange={onOpenChange}
      triggerClassName="account-trigger"
    >
      <div className="account-card">
        <span className="avatar" aria-hidden="true">{sampleAccount.initial}</span>
        <div>
          <strong>{sampleAccount.name}</strong>
          <small>{t('account.sampleName')}</small>
        </div>
      </div>
      <p className="popover-note">{t('account.note')}</p>
    </Popover>
  );
}

/**
 * The global shell (G-01): Home, Notifications, Settings, Account and contextual Back, with My Projects,
 * Create and In Progress as the primary navigation. One nav element is a sidebar on a computer and a
 * bar along the bottom on a phone, so there is a single landmark and a single tab order.
 * The sign-in page renders without it.
 *
 * pathname and the initial* flags exist so tests can render any state without a browser.
 */
export function Shell({children, pathname: pathnameOverride, initialCreateOpen = false, initialNoticeOpen = false}: {
  children: ReactNode;
  pathname?: string;
  initialCreateOpen?: boolean;
  initialNoticeOpen?: boolean;
}) {
  const {t} = useI18n();
  const routePathname = usePathname();
  const pathname = pathnameOverride ?? routePathname ?? '/';
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [noticeOpen, setNoticeOpen] = useState(initialNoticeOpen);
  const [accountOpen, setAccountOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const actions = useMemo(() => ({openCreate: () => setCreateOpen(true)}), []);

  // Menus and the Create dialog belong to the page they were opened on, so any change of path closes them:
  // a link, Back or Forward, or the address bar.
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setCreateOpen(false);
    setNoticeOpen(false);
    setAccountOpen(false);
  }

  if (isChromeless(pathname)) return <>{children}</>;

  return (
    <ShellProvider value={actions}>
      <div className="app-shell">
        <aside className="sidebar" aria-label={t('nav.workspace')}>
          <Brand className="sidebar-brand"/>
          <p className="sidebar-label">{t('nav.workspace')}</p>
          <nav className="main-nav" aria-label={t('a11y.mainNavigation')}>
            <ul>
              <li><NavLink href={links[0].href} label={t(links[0].label)} icon={links[0].icon} pathname={pathname}/></li>
              <li><NavLink href={links[1].href} label={t(links[1].label)} icon={links[1].icon} pathname={pathname}/></li>
              <li>
                <button type="button" className="nav-item nav-create" onClick={actions.openCreate}>
                  <Icon name="plus"/>
                  <span>{t('nav.create')}</span>
                </button>
              </li>
              <li><NavLink href={links[2].href} label={t(links[2].label)} icon={links[2].icon} pathname={pathname}/></li>
            </ul>
          </nav>
          <div className="sidebar-bottom">
            <div className="mode-card">
              <span className="mode-icon"><Icon name="spark" size={15}/></span>
              <div>
                <strong>{t('shell.modeTitle')}</strong>
                <small>{t('shell.modeCopy')}</small>
              </div>
            </div>
            <Link href="/settings#guidance" className="help-link">
              <Icon name="help" size={16}/>
              <span>{t('nav.help')}</span>
            </Link>
            <p className="sidebar-meta">{t('nav.footer')}</p>
          </div>
        </aside>
        <div className="main-column">
          <header>
            <div className="topbar">
              <div className="topbar-start">
                <BackLink pathname={pathname}/>
                <Brand className="topbar-brand"/>
              </div>
              <div className="topbar-end">
                <NotificationsMenu open={noticeOpen} onOpenChange={setNoticeOpen}/>
                <Link href="/settings" className="icon-btn" aria-label={t('nav.settings')} aria-current={isCurrent(pathname, '/settings') ? 'page' : undefined}>
                  <Icon name="settings"/>
                </Link>
                <AccountMenu open={accountOpen} onOpenChange={setAccountOpen}/>
              </div>
            </div>
            <SyntheticBanner/>
          </header>
          <main id={mainContentId} tabIndex={-1}>{children}</main>
        </div>
        {createOpen ? <CreateDialog onClose={() => setCreateOpen(false)}/> : null}
      </div>
    </ShellProvider>
  );
}
