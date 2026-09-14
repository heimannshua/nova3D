import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import * as api from '@/api'
import { useSession, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { Btn, Field, KeyValue, Notice, PlateMark, StatedAbsence } from '@/components/ui/primitives'

/** Everything behind the gate goes through here. */
export function RequireAuth() {
  const { loading } = useWorkspace()
  const session = useSession()
  const location = useLocation()
  if (loading) return <div className="page">Loading your Workspace…</div>
  if (!session) return <Navigate to="/signin" state={{ from: location.pathname }} replace />
  return <Outlet />
}

/** Administrator actions that change who can reach the Workspace (D-2, NFR-2). */
export function RequireAdmin() {
  const session = useSession()
  if (!session?.account.isAdministrator) {
    return (
      <div className="page page-wide">
        <h1 className="page-title">You cannot open this</h1>
        <Notice>
          These are Administrator tools and this Account is not an Administrator. nova3D will not show
          you what is in a part of the Workspace you do not have access to — including whether it
          exists.
        </Notice>
        <Link to="/" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
          Go to Home
        </Link>
      </div>
    )
  }
  return <Outlet />
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="gate-sheet">
      <div className="gate-sheet-inner">
        <PlateMark size={30}>nova3D</PlateMark>
        {children}
      </div>
    </div>
  )
}

export function SignIn() {
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const session = useSession()
  const action = useAction()
  const [email, setEmail] = useState('josh@nova3d.local')
  const [password, setPassword] = useState('anything')

  if (session) return <Navigate to={location.state?.from ?? '/'} replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await action.run(() => api.auth.signIn(email, password))
    if (ok) navigate(location.state?.from ?? '/', { replace: true })
  }

  return (
    <Sheet>
      <h1 className="page-title">Sign in</h1>
      <form className="stack gap-3" onSubmit={submit}>
        <Field label="Email">
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="Any password signs you in here. Type “wrong” to see the failure state.">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>

        {action.error && (
          <Notice tone="warn" glyph="▲">
            <p style={{ margin: 0 }}>{action.error}</p>
            <p style={{ margin: 'var(--space-2) 0 0' }}>
              nova3D does not say which of the two was wrong, and it does not say whether that address
              has an Account here.
            </p>
          </Notice>
        )}

        <Btn variant="primary" className="btn-block" type="submit" disabled={action.pending}>
          {action.pending ? 'Signing in…' : 'Sign in'}
        </Btn>
      </form>

      <div className="row gap-3 wrap sm">
        <Link to="/reset">Forgot your password?</Link>
        <Link to="/register">I have an Invitation Code</Link>
      </div>

      <p className="caption muted" style={{ margin: 0 }}>
        There is no public registration. nova3D is entered with a single-use Invitation Code.
      </p>
    </Sheet>
  )
}

export function Register() {
  const navigate = useNavigate()
  const action = useAction()
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await action.run(() => api.auth.register(code, email))
    if (ok) navigate('/', { replace: true })
  }

  return (
    <Sheet>
      <h1 className="page-title">Enter your Invitation Code</h1>
      <p className="sm muted" style={{ margin: 0 }}>
        nova3D has no public registration. A code is issued once, works once, and can be revoked
        before it is used.
      </p>
      <form className="stack gap-3" onSubmit={submit}>
        <Field label="Invitation Code" hint="Type “revoked” or “used” to see those states.">
          <input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Choose a password">
          <input className="input" type="password" autoComplete="new-password" />
        </Field>

        {action.error && (
          <p className="blocker" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">▲</span>
            <span>{action.error}</span>
          </p>
        )}

        <Btn variant="primary" className="btn-block" type="submit" disabled={action.pending}>
          {action.pending ? 'Creating…' : 'Create the Account'}
        </Btn>
      </form>
      <Link to="/signin" className="sm">
        I already have an Account
      </Link>
    </Sheet>
  )
}

export function PasswordReset() {
  const action = useAction()
  const [sent, setSent] = useState(false)
  return (
    <Sheet>
      <h1 className="page-title">Reset your password</h1>
      {sent ? (
        <Notice>
          If there is an Account for that address, a link is on its way. nova3D says the same thing
          either way — confirming which addresses exist would tell anyone who asked.
        </Notice>
      ) : (
        <form
          className="stack gap-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const ok = await action.run(() => api.auth.requestPasswordReset(''))
            if (ok) setSent(true)
          }}
        >
          <Field label="Email">
            <input className="input" type="email" />
          </Field>
          <Btn variant="primary" className="btn-block" type="submit" disabled={action.pending}>
            {action.pending ? 'Sending…' : 'Send a reset link'}
          </Btn>
        </form>
      )}
      <Link to="/signin" className="sm">
        Back to sign in
      </Link>
    </Sheet>
  )
}

export function AdminRecovery() {
  const action = useAction()
  const [sent, setSent] = useState(false)
  return (
    <Sheet>
      <h1 className="page-title">Administrator recovery</h1>
      {sent ? (
        <Notice tone="accent" glyph="✓" title="A link is on its way">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            It went to the verified Administrator address and nowhere else. It is short-lived and
            works once.
          </p>
          <p style={{ margin: 0 }}>
            Using it revokes every existing Administrator session and writes an audit event that
            cannot be edited or removed.
          </p>
        </Notice>
      ) : (
        <>
          <Notice title="Why this is separate from a password reset">
            The Administrator is the one Account with no one above it to appeal to. Recovery goes only
            to the verified Administrator address, the link is short-lived and single-use, and using
            it signs out every existing Administrator session.
          </Notice>
          <KeyValue
            rows={[
              { k: 'Sent to', v: 'The verified Administrator address only' },
              { k: 'Valid for', v: 'A short time, then it stops working' },
              { k: 'Uses', v: 'One' },
              { k: 'On success', v: 'All Administrator sessions revoked, and an audit event written' },
            ]}
          />
          <Btn
            variant="primary"
            className="btn-block"
            disabled={action.pending}
            onClick={async () => {
              const ok = await action.run(() => api.auth.requestAdminRecovery())
              if (ok) setSent(true)
            }}
          >
            {action.pending ? 'Sending…' : 'Send the recovery link'}
          </Btn>
        </>
      )}
      <Link to="/signin" className="sm">
        Back to sign in
      </Link>
    </Sheet>
  )
}

export function SessionEnded() {
  return (
    <Sheet>
      <h1 className="page-title">You are signed out</h1>
      <Notice tone="accent" title="What survived">
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          <li>Every Project, Plan, Version and approval. Nothing was lost.</li>
          <li>Research and generation Jobs kept running.</li>
          <li>Anything typed but not saved on the last screen did not survive.</li>
        </ul>
      </Notice>
      <StatedAbsence>
        <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
          Watching stopped when your session ended.
        </strong>
        A print that was running kept printing — the machine does not need nova3D. But nova3D was not
        checking the camera while you were signed out, and it will not go back and check the frames it
        missed.
      </StatedAbsence>
      <Link to="/signin" className="btn btn-primary btn-block">
        Sign in again
      </Link>
    </Sheet>
  )
}

/**
 * Fresh authentication for sensitive Administrator actions. Rendered inline
 * rather than as a route, because the action it protects has a place on screen.
 */
export function ReauthPrompt({ onDone }: { onDone: () => void }) {
  const action = useAction()
  const [password, setPassword] = useState('')
  return (
    <div className="notice">
      <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
        <span aria-hidden="true">▲ </span>Confirm it is you
      </strong>
      <p className="sm" style={{ margin: '0 0 var(--space-2)' }}>
        This changes who can reach the Workspace. Being signed in is not enough — a session someone
        else is holding is also a signed-in session.
      </p>
      <form
        className="row gap-2 wrap"
        onSubmit={async (e) => {
          e.preventDefault()
          const ok = await action.run(() => api.auth.reauthenticate(password))
          if (ok) onDone()
        }}
      >
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <Btn variant="primary" type="submit" disabled={action.pending}>
          Confirm
        </Btn>
      </form>
      {action.error && (
        <p className="sm" style={{ margin: 'var(--space-2) 0 0', color: 'var(--color-accent-2-strong)' }}>
          <span aria-hidden="true">▲ </span>
          {action.error} The failed attempt is recorded.
        </p>
      )}
    </div>
  )
}
