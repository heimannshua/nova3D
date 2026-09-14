/**
 * The application frame. Every signed-in route renders inside it.
 *
 * Holds the three things that must be reachable from anywhere: where you are
 * (the nav), what is running (the Jobs indicator), and what is waiting on you
 * (the unread marker). Both are live — a Job that finishes while you are reading
 * a Source updates here without a reload.
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import * as api from '@/api'
import { useActiveJobs, useLivePrints, useSession, useUnreadCount, useWorkspace } from '@/store/workspace'
import { PlateMark, useT } from '@/components/ui/primitives'

function NavItem({ to, label, badge, end }: { to: string; label: string; badge?: number; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className="app-nav-item">
      <span className="grow">{label}</span>
      {badge ? <span className="app-nav-badge">{badge}</span> : null}
    </NavLink>
  )
}

export function AppShell() {
  const t = useT()
  const navigate = useNavigate()
  const session = useSession()
  const unread = useUnreadCount()
  const running = useActiveJobs().length
  const livePrints = useLivePrints().length
  const { offline, setOffline } = useWorkspace()
  const [navOpen, setNavOpen] = useState(false)

  const signOut = async () => {
    await api.auth.signOut()
    navigate('/signin', { replace: true })
  }

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to the main content
      </a>

      <header className="app-topbar">
        <button
          type="button"
          className="btn btn-ghost app-nav-toggle"
          aria-expanded={navOpen}
          aria-controls="app-nav"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>

        <NavLink to="/" className="app-brand" aria-label="nova3D — Home">
          <PlateMark size={22}>nova3D</PlateMark>
        </NavLink>

        <span className="grow" />

        <NavLink to="/search" className="btn btn-ghost">
          <span aria-hidden="true">⌕</span> {t('nav.search')}
        </NavLink>

        {/* Offline is a state of the world. It is in the chrome because half the
            offline requirements are about what nova3D says when it cannot act. */}
        <button
          type="button"
          className="btn btn-ghost"
          aria-pressed={offline}
          onClick={() => setOffline(!offline)}
          title="Simulate losing the connection"
        >
          <span aria-hidden="true">{offline ? '⊘' : '●'}</span>
          {offline ? t('state.offline') : t('state.online')}
        </button>

        <NavLink to="/notifications" className="btn btn-ghost">
          <span aria-hidden="true">{unread > 0 ? '●' : '○'}</span>
          <span className={unread > 0 ? 'unread-marker' : undefined}>
            {unread > 0 ? `${unread} unread` : 'Notifications'}
          </span>
        </NavLink>

        <div className="app-account">
          <span className="caption muted">{session?.account.displayName}</span>
          <button type="button" className="btn btn-ghost" onClick={signOut}>
            {t('action.signOut')}
          </button>
        </div>
      </header>

      <div className="app-body">
        <nav id="app-nav" className="app-nav" data-open={navOpen} aria-label="Main">
          <NavItem to="/" label={t('nav.home')} end />
          <NavItem to="/projects" label={t('nav.projects')} />
          <NavItem to="/create" label={t('nav.create')} />
          <NavItem to="/jobs" label={t('nav.jobs')} badge={running || undefined} />
          <NavItem to="/printers" label={t('nav.printers')} badge={livePrints || undefined} />

          <div className="app-nav-sep" />

          <NavItem to="/settings" label={t('nav.settings')} />
          {session?.account.isAdministrator && <NavItem to="/admin" label={t('nav.admin')} />}

          <div className="app-nav-sep" />

          <NavLink to="/help" className="app-nav-item">
            <span className="grow">How nova3D works</span>
          </NavLink>
        </nav>

        <main id="main" className="app-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
