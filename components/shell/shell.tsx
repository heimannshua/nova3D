'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect, useMemo, useState, type ReactNode} from 'react';
import {signOut} from '@/app/account/actions';
import {useI18n} from '@/lib/i18n/react';
import {useSessionAction} from '../use-session-action';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {Icon, type IconName} from '../ui/icon';
import {Popover} from '../ui/popover';
import {PreferenceSaveNotice} from '../ui/preference-notice';
import {mainContentId} from '../ui/skip-link';
import {Notice} from '../ui/states';
import {LtrToken} from '../ui/text-span';
import {Brand} from './brand';
import {CreateDialog} from './create-dialog';
import {isChromeless, isCurrent, parentRoute} from './routes';
import {ShellProvider} from './shell-context';

const links = [
  {href: '/', label: 'nav.home', icon: 'grid'},
  {href: '/projects', label: 'nav.projects', icon: 'folder'},
  {href: '/progress', label: 'nav.progress', icon: 'activity'},
] as const satisfies readonly {href: string; label: 'nav.home' | 'nav.projects' | 'nav.progress'; icon: IconName}[];

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

/**
 * Notifications. Nothing produces one yet (the stories that finish work for a person do), so the menu says so honestly: an empty
 * state, no count, no dot. The button's name is just "Notifications" until there is something unread to count.
 */
function NotificationsMenu({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
  const {t} = useI18n();
  return (
    <Popover
      icon="bell"
      label={t('notifications.title')}
      panelLabel={t('notifications.title')}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="popover-heading">
        <strong>{t('notifications.title')}</strong>
      </div>
      <div className="popover-empty">
        <strong>{t('notifications.emptyTitle')}</strong>
        <small>{t('notifications.emptyBody')}</small>
      </div>
    </Popover>
  );
}

/**
 * The Account panel: the verified Google address the person signed in with (the layout read it from the verified access; nothing
 * here is a name or a sample), and sign-out. It is mounted only while the menu is open, so what a failed sign-out said is gone when
 * the menu closes and reopens. Signing out revokes the session's grant first; if that cannot be recorded the
 * session is kept and the person is told, so they can try again; a sign-out that worked leaves the page for
 * sign-in. The pending state and the failure are announced through the page's one live region.
 */
function AccountPanel({address}: {address: string | null}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const {state, formAction, pending, onSubmit} = useSessionAction(signOut);

  useEffect(() => {
    if (pending) announce(t('account.signingOut'), locale);
  }, [pending, announce, t, locale]);
  useEffect(() => {
    if (state.outcome === 'unavailable') announce(t('account.signOutFailed'), locale);
  }, [state, announce, t, locale]);

  return (
    <>
      <div className="account-card">
        <span className="avatar" aria-hidden="true">{address ? [...address][0]?.toUpperCase() : <Icon name="person" size={16}/>}</span>
        <div className="account-identity">
          <strong>{address ? <LtrToken>{address}</LtrToken> : t('account.signedIn')}</strong>
          <small>{t('account.signedInWith')}</small>
        </div>
      </div>
      <p className="popover-note">{t('account.note')}</p>
      {!pending && state.outcome === 'unavailable' ? <Notice tone="danger">{t('account.signOutFailed')}</Notice> : null}
      <form action={formAction} onSubmit={onSubmit} className="account-signout">
        <Button variant="secondary" type="submit" aria-disabled={pending ? true : undefined}>
          {pending ? t('account.signingOut') : t('account.signOut')}
        </Button>
      </form>
    </>
  );
}

function AccountMenu({open, onOpenChange, address}: {open: boolean; onOpenChange: (open: boolean) => void; address: string | null}) {
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
      <AccountPanel address={address}/>
    </Popover>
  );
}

/**
 * The global shell (G-01): Home, Notifications, Settings, Account and contextual Back, with My Projects,
 * Create and In Progress as the primary navigation. One nav element is a sidebar on a computer and a
 * bar along the bottom on a phone, so there is a single landmark and a single tab order.
 * The sign-in page renders without it.
 *
 * `accountAddress` is the verified Google address of the Account the request belongs to (the layout reads it from the verified
 * access), or null when there is none to show. pathname and the initial* flags exist so tests can render any state without a browser.
 */
export function Shell({children, accountAddress = null, pathname: pathnameOverride, initialCreateOpen = false, initialNoticeOpen = false, initialAccountOpen = false}: {
  children: ReactNode;
  accountAddress?: string | null;
  pathname?: string;
  initialCreateOpen?: boolean;
  initialNoticeOpen?: boolean;
  initialAccountOpen?: boolean;
}) {
  const {t} = useI18n();
  const routePathname = usePathname();
  const pathname = pathnameOverride ?? routePathname ?? '/';
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [noticeOpen, setNoticeOpen] = useState(initialNoticeOpen);
  const [accountOpen, setAccountOpen] = useState(initialAccountOpen);
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

  // The sign-in, registration and step-up screens have no shell, but a visitor who holds a session can still change
  // a language or a theme on the first of them, and a save that fails there must say so too.
  if (isChromeless(pathname)) {
    return (
      <>
        <PreferenceSaveNotice/>
        {children}
      </>
    );
  }

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
                <AccountMenu open={accountOpen} onOpenChange={setAccountOpen} address={accountAddress}/>
              </div>
            </div>
          </header>
          <main id={mainContentId} tabIndex={-1}>
            <PreferenceSaveNotice/>
            {children}
          </main>
        </div>
        {createOpen ? <CreateDialog onClose={() => setCreateOpen(false)}/> : null}
      </div>
    </ShellProvider>
  );
}
