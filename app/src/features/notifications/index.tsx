import { Link } from 'react-router-dom'
import * as api from '@/api'
import type { AppNotification } from '@/api'
import { useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { PageHeader } from '@/components/layout/shells'
import { Btn, Ltr, Notice } from '@/components/ui/primitives'

export function NotificationsList() {
  const { notifications } = useWorkspace()
  const action = useAction()

  const waiting = notifications.filter((n) => n.needsDecision)
  const informational = notifications.filter((n) => !n.needsDecision)

  return (
    <div className="page page-wide">
      <PageHeader
        title="Notifications"
        meta="Grouped by whether something is waiting on you — not by when it arrived."
        actions={
          <Btn onClick={() => void action.run(() => api.notifications.markAllRead())}>Mark all as read</Btn>
        }
      />

      <section className="stack gap-2">
        <div className="rail-label">Waiting on a decision</div>
        {waiting.length === 0 ? (
          <p className="sm muted">Nothing is waiting on a decision.</p>
        ) : (
          <div className="list">
            {waiting.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
          </div>
        )}
      </section>

      <section className="stack gap-2">
        <div className="rail-label">For information</div>
        {informational.length === 0 ? (
          <p className="sm muted">Nothing is here for information only.</p>
        ) : (
          <div className="list">
            {informational.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
          </div>
        )}
      </section>

      <Notice>
        Which of these also reach your phone is controlled per category in{' '}
        <Link to="/settings/notifications">Settings</Link>. Turning phone alerts off never removes
        anything from this list — it only changes what also buzzes your phone.
      </Notice>

      <p className="caption muted">
        Selecting one opens the exact item it is about, and this history stays complete whether or
        not phone alerts are switched on.
      </p>
    </div>
  )
}

function NotificationRow({ notification: n }: { notification: AppNotification }) {
  return (
    <Link
      to={n.href}
      className="list-row list-row-link"
      onClick={() => void api.notifications.markRead(n.id)}
    >
      <div className="stack gap-1 grow">
        <div style={n.read ? undefined : { fontWeight: 600 }}>
          {!n.read && (
            <span aria-hidden="true" style={{ color: 'var(--color-accent-2)' }}>
              ●{' '}
            </span>
          )}
          {n.title}
        </div>
        <div className="caption muted">
          {n.category} · <Ltr>{n.at.slice(0, 10)}</Ltr>
        </div>
      </div>
    </Link>
  )
}
