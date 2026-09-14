/**
 * Administrator tools.
 *
 * Everything here changes who can reach the Workspace, what it may spend, or
 * what leaves it — never a Project, a Plan or a Version directly. The
 * sensitive half of it (issuing or revoking an Invitation Code, disabling an
 * Account, revoking every Administrator session, deleting the Workspace)
 * requires fresh authentication, gated the same way everywhere: check
 * `api.auth.hasFreshAuth()` before the call, and if it is not fresh, show
 * `ReauthPrompt` instead of performing the action (D-2, NFR-2).
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '@/api'
import type { Provider } from '@/api'
import { useSession, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { PageHeader } from '@/components/layout/shells'
import { StepBlocks } from '@/components/nova3d/status'
import { Btn, KeyValue, Ltr, Notice, StatedAbsence, Value } from '@/components/ui/primitives'
import { ReauthPrompt } from '@/features/auth'

function AdminBreadcrumb({ label }: { label: string }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/admin">Administrator</Link>
      <span aria-hidden="true">/</span>
      <span className="muted">{label}</span>
    </nav>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

const TOOLS = [
  { to: '/admin/providers', title: 'Providers', body: 'What each external provider is used for, what it is sent, and whether it may be enabled.' },
  { to: '/admin/printers', title: 'Printer Links', body: 'What each linked printer may do, and unlinking it.' },
  { to: '/admin/export', title: 'Data Export', body: 'Everything in the Workspace, as files something else can open.' },
  { to: '/admin/delete', title: 'Delete Workspace', body: 'Everything, for every Account. Immediate, and without recovery.' },
  { to: '/admin/codes', title: 'Invitation Codes', body: 'The only way into nova3D. Issue one, or revoke one that has not been used.' },
  { to: '/admin/security', title: 'Sensitive Actions', body: 'What requires fresh authentication, and the Administrator sessions.' },
  { to: '/admin/accounts', title: 'Accounts and Limits', body: 'Every Account, its state, and its Usage Limit.' },
]

export function AdminOverview() {
  const { auditEvents } = useWorkspace()

  return (
    <div className="page page-wide">
      <PageHeader title="Administrator" meta="Tools that change who can reach the Workspace, and what it may spend." />

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Tools</h2>
        <div className="list">
          {TOOLS.map((t) => (
            <Link key={t.to} to={t.to} className="list-row list-row-link">
              <span className="stack gap-1 grow">
                <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>{t.title}</strong>
                <span className="sm muted">{t.body}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Recorded actions</h2>
        {auditEvents.length === 0 ? (
          <p className="sm muted" style={{ margin: 0 }}>
            Nothing has been recorded yet.
          </p>
        ) : (
          <table className="table">
            <tbody>
              {auditEvents.map((e) => (
                <tr key={e.id}>
                  <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                    <Ltr>{e.at.slice(0, 10)}</Ltr>
                  </td>
                  <td>{e.action}</td>
                  <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                    {e.actor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="caption muted" style={{ margin: 0 }}>
          Time and action, in plain sentences — a record you can read is a record you will check.
        </p>
      </section>
    </div>
  )
}

// ── Providers ────────────────────────────────────────────────────────────────

function ProviderRow({ provider }: { provider: Provider }) {
  const action = useAction()
  const next = !provider.enabled
  const cannotEnable = !provider.enabled && Boolean(provider.blockedReason)

  return (
    <article className="card">
      <div className="row gap-3 wrap" style={{ alignItems: 'flex-start' }}>
        <div className="stack gap-2 grow">
          <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
            <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>
              <Value of={provider.name} kind="content" as="span" />
            </strong>
            {provider.enabled ? (
              <span className="tag tag-accent">enabled</span>
            ) : provider.blockedReason ? (
              <span className="tag tag-accent-2">cannot be enabled</span>
            ) : (
              <span className="tag tag-neutral">available</span>
            )}
          </div>
          <KeyValue
            rows={[
              { k: 'Used for', v: provider.purpose },
              { k: 'What leaves nova3D', v: provider.dataSent },
              { k: 'What never does', v: provider.dataNeverSent },
              { k: 'How long they keep it', v: <Value of={provider.retention} as="span" /> },
              { k: 'Maximum charge per Job', v: <Value of={provider.maxCharge} as="span" /> },
            ]}
          />
        </div>
        <Btn
          variant={provider.enabled ? 'secondary' : 'primary'}
          disabled={action.pending || cannotEnable}
          onClick={() => void action.run(() => api.admin.setProviderEnabled(provider.id, next))}
        >
          {provider.enabled ? 'Disable' : 'Enable'}
        </Btn>
      </div>

      {provider.blockedReason && (
        <Notice tone="warn" glyph="▲">
          {provider.blockedReason}
        </Notice>
      )}

      {action.error && (
        <p className="blocker" role="status" style={{ margin: 0 }}>
          <span aria-hidden="true">▲</span>
          <span>{action.error}</span>
        </p>
      )}
    </article>
  )
}

export function Providers() {
  const { providers } = useWorkspace()

  return (
    <div className="page page-wide">
      <AdminBreadcrumb label="Providers" />
      <PageHeader title="Providers" meta="External services nova3D can use, and exactly what each one may see." />

      {providers.length === 0 ? (
        <p className="sm muted">No provider is configured.</p>
      ) : (
        <div className="stack gap-4">
          {providers.map((p) => (
            <ProviderRow key={p.id} provider={p} />
          ))}
        </div>
      )}

      <Notice title="Enabling is not permitting">
        Enabling a provider makes it available to be permitted — it does not permit anything. Every Job
        still asks, shows the maximum charge, and takes a reservation first.
      </Notice>
    </div>
  )
}

// ── Printer Links ────────────────────────────────────────────────────────────

export function PrinterLinks() {
  const { printers, printJobs } = useWorkspace()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const action = useAction()

  return (
    <div className="page page-wide">
      <AdminBreadcrumb label="Printer Links" />
      <PageHeader title="Printer Links" meta="What each linked printer may do — and nothing it has not been told it may." />

      {printers.length === 0 ? (
        <p className="sm muted">No printer is linked.</p>
      ) : (
        <div className="stack gap-4">
          {printers.map((p) => {
            const active = printJobs.some((j) => j.printerId === p.id && (j.state === 'printing' || j.state === 'paused'))
            const unlinked = !p.linked
            return (
              <section key={p.id} className="card">
                <div className="row gap-3 wrap">
                  <div className="stack gap-1 grow">
                    <div className="card-title">{p.name}</div>
                    {unlinked && <span className="sm muted">Unlinked from this Workspace.</span>}
                  </div>
                  {!unlinked && confirmingId !== p.id && (
                    <Btn variant="danger" onClick={() => setConfirmingId(p.id)}>
                      Unlink {p.name}
                    </Btn>
                  )}
                </div>

                {!unlinked && active && (
                  <Notice tone="warn" glyph="▲" title="A print is running on this machine">
                    Unlinking does not stop the print — the machine carries on without nova3D. What stops
                    is nova3D&rsquo;s ability to pause it, stop it, or watch it. The Print Record stays
                    with the Version and records that the link was removed partway through.
                  </Notice>
                )}

                {confirmingId === p.id && (
                  <div className="row gap-2 wrap">
                    <Btn
                      variant="danger"
                      disabled={action.pending}
                      onClick={async () => {
                        if (!api.auth.hasFreshAuth()) {
                          setNeedsAuth(true)
                          return
                        }
                        const ok = await action.run(() => api.admin.unlinkPrinter(p.id))
                        if (ok) setConfirmingId(null)
                      }}
                    >
                      Confirm unlink
                    </Btn>
                    <Btn variant="ghost" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </Btn>
                  </div>
                )}

                {confirmingId === p.id && needsAuth && <ReauthPrompt onDone={() => setNeedsAuth(false)} />}

                {confirmingId === p.id && action.error && (
                  <p className="blocker" role="status" style={{ margin: 0 }}>
                    <span aria-hidden="true">▲</span>
                    <span>{action.error}</span>
                  </p>
                )}

                {!unlinked && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Permission</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Send print jobs</td>
                        <td>✓ may</td>
                      </tr>
                      <tr>
                        <td>Pause/resume/stop</td>
                        <td>{p.controlLevel === 'full' ? '✓ may' : '⊘ may not'}</td>
                      </tr>
                      <tr>
                        <td>Change temperatures and move the axes</td>
                        <td>{p.controlLevel === 'full' ? '✓ may' : '⊘ may not'}</td>
                      </tr>
                      <tr>
                        <td>See the camera</td>
                        <td>{p.hasCamera ? '✓ may' : '⊘ may not'}</td>
                      </tr>
                      <tr>
                        <td>Check camera frames for a failing print</td>
                        <td>{p.hasCamera ? '✓ may' : '⊘ may not'}</td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {!unlinked && !p.hasCamera && (
                  <StatedAbsence>
                    Seeing the camera and checking its frames for a failing print are not permissions
                    nova3D is withholding from this printer — they are things it cannot do at all. It has
                    no camera.
                  </StatedAbsence>
                )}
              </section>
            )
          })}
        </div>
      )}

      <Notice title="What each vendor permits is not settled yet">
        Which controls come through a vendor integration, rather than directly, depends on the vendor and
        is not settled yet (AD-8).
      </Notice>
    </div>
  )
}

// ── Data Export ──────────────────────────────────────────────────────────────

export function DataExport() {
  const [running, setRunning] = useState(false)

  return (
    <div className="page page-wide">
      <AdminBreadcrumb label="Data Export" />
      <PageHeader title="Data Export" meta="Everything in the Workspace, as files something else can open." />

      {running ? (
        <Notice tone="accent" title="Export running">
          <div className="stack gap-2">
            <StepBlocks done={2} total={5} />
            <p style={{ margin: 0 }}>You can leave. Nothing else is blocked while this runs.</p>
          </div>
        </Notice>
      ) : (
        <>
          <section className="stack gap-2">
            <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>What you get</h2>
            <ul className="sm" style={{ margin: 0, paddingInlineStart: '1.2em' }}>
              <li>Every Project, Plan, Claim, Source reference, decision and approval — as structured data.</li>
              <li>Every Model Version — as 3MF.</li>
              <li>Every Source Record — as PDF.</li>
              <li>Every Print Record, attached to the Version it belongs to.</li>
              <li>Settings and audit history.</li>
            </ul>
          </section>
          <Btn variant="primary" onClick={() => setRunning(true)} style={{ alignSelf: 'flex-start' }}>
            Start the export
          </Btn>
        </>
      )}

      <Notice title="Why this exists">
        A record that only one piece of software can read is not a record. Everything here opens in
        something else, and the identifiers stay stable so the links between them survive.
      </Notice>
    </div>
  )
}

// ── Delete Workspace ─────────────────────────────────────────────────────────

const DELETE_PHRASE = 'delete the workspace'

export function DeleteWorkspace() {
  const { printJobs } = useWorkspace()
  const navigate = useNavigate()
  const action = useAction()
  const [typed, setTyped] = useState('')
  const [needsAuth, setNeedsAuth] = useState(false)
  const [deleted, setDeleted] = useState(false)

  const activePrint = printJobs.some((j) => j.state === 'printing' || j.state === 'paused')
  const canConfirm = typed === DELETE_PHRASE && !activePrint

  return (
    <div className="page page-wide">
      <AdminBreadcrumb label="Delete Workspace" />
      <PageHeader title="Delete Workspace" meta="Everything, for every Account." />

      {deleted ? (
        <Notice tone="accent" glyph="✓" title="Deleted">
          Everything in this Workspace is gone. There is nothing here that can bring it back.
        </Notice>
      ) : (
        <>
          <Notice tone="warn" glyph="▲" title="There is no recovery">
            <p style={{ margin: '0 0 var(--space-2)' }}>
              There is no recovery and no backup on nova3D&rsquo;s side. Deletion is immediate and
              durable.
            </p>
            <p style={{ margin: 0 }}>
              A backup restore will not bring it back either — the deletion is enforced after a restore
              as well.
            </p>
          </Notice>

          <Link to="/admin/export" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
            Export everything first
          </Link>

          {activePrint && (
            <p className="blocker" role="status">
              <span aria-hidden="true">▲</span>
              <span>
                A print is running. Deleting the Workspace would leave a machine running a job with
                nothing behind it.
              </span>
            </p>
          )}

          <label className="stack gap-1" style={{ maxWidth: 420 }}>
            <span className="rail-label">Type &ldquo;{DELETE_PHRASE}&rdquo; to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={DELETE_PHRASE} />
          </label>

          {needsAuth && <ReauthPrompt onDone={() => setNeedsAuth(false)} />}

          {action.error && (
            <p className="blocker" role="status" style={{ margin: 0 }}>
              <span aria-hidden="true">▲</span>
              <span>{action.error}</span>
            </p>
          )}

          <Btn
            variant="danger"
            disabled={!canConfirm || action.pending}
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              if (!api.auth.hasFreshAuth()) {
                setNeedsAuth(true)
                return
              }
              const ok = await action.run(() => api.admin.deleteWorkspace())
              if (ok) {
                setDeleted(true)
                // The session went with it. There is nowhere signed-in left to be.
                navigate('/signed-out', { replace: true })
              }
            }}
          >
            {action.pending ? 'Deleting…' : 'Delete the Workspace'}
          </Btn>
        </>
      )}
    </div>
  )
}

// ── Invitation Codes ─────────────────────────────────────────────────────────

export function InvitationCodes() {
  const { invitationCodes } = useWorkspace()
  const action = useAction()
  const [needsAuth, setNeedsAuth] = useState(false)

  const guarded = (fn: () => Promise<unknown>) => {
    if (!api.auth.hasFreshAuth()) {
      setNeedsAuth(true)
      return
    }
    void action.run(fn)
  }

  return (
    <div className="page page-wide">
      <AdminBreadcrumb label="Invitation Codes" />
      <PageHeader
        title="Invitation Codes"
        meta="The only way into nova3D. Each code works once."
        actions={
          <Btn variant="primary" disabled={action.pending} onClick={() => guarded(() => api.admin.issueCode())}>
            Issue a new code
          </Btn>
        }
      />

      {needsAuth ? (
        <ReauthPrompt onDone={() => setNeedsAuth(false)} />
      ) : (
        <>
          {action.error && (
            <p className="blocker" role="status" style={{ margin: 0 }}>
              <span aria-hidden="true">▲</span>
              <span>{action.error}</span>
            </p>
          )}

          {invitationCodes.length === 0 ? (
            <p className="sm muted">No Invitation Code has been issued yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Issued</th>
                  <th>State</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitationCodes.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">
                      <Value of={c.code} kind="content" as="span" />
                    </td>
                    <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                      <Ltr>{c.issued.slice(0, 10)}</Ltr>
                    </td>
                    <td className="sm">
                      {c.state === 'unused' && '○ unused'}
                      {c.state === 'used' && (c.usedBy ? `✓ used by ${c.usedBy}` : '✓ used')}
                      {c.state === 'revoked' && '⊘ revoked'}
                    </td>
                    <td>
                      {c.state === 'unused' && (
                        <Btn variant="ghost" disabled={action.pending} onClick={() => guarded(() => api.admin.revokeCode(c.id))}>
                          Revoke
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <Notice title="A code is never shown again">
        Once it is created, it never appears again — not in a Notification, not in a URL, not in a Job
        and not in an export. Revoking an unused code makes it fail immediately.
      </Notice>
    </div>
  )
}

// ── Sensitive Actions ────────────────────────────────────────────────────────

export function SensitiveActions() {
  const { auditEvents } = useWorkspace()
  const action = useAction()
  const [needsAuth, setNeedsAuth] = useState(false)
  const [succeeded, setSucceeded] = useState(false)

  const revoke = () => {
    if (!api.auth.hasFreshAuth()) {
      setNeedsAuth(true)
      return
    }
    void action.run(() => api.admin.revokeAllSessions(), () => setSucceeded(true))
  }

  return (
    <div className="page page-wide">
      <AdminBreadcrumb label="Sensitive Actions" />
      <PageHeader title="Sensitive Actions" meta="What nova3D will not do without fresh authentication." />

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Actions that require fresh authentication</h2>
        <ul className="sm" style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          <li>Revoking Administrator sessions.</li>
          <li>Issuing or revoking an Invitation Code.</li>
          <li>Changing the verified Administrator address.</li>
          <li>Disabling an Account, or resetting someone else&rsquo;s Usage Limit.</li>
          <li>Deleting the Workspace.</li>
        </ul>
      </section>

      <section className="stack gap-3">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Administrator sessions</h2>

        {needsAuth ? (
          <ReauthPrompt onDone={() => setNeedsAuth(false)} />
        ) : succeeded ? (
          <Notice tone="accent" glyph="✓" title="Every session has ended">
            Every signed-in Administrator session on every device has ended, including this one after you
            leave this screen. An audit event has been written and cannot be edited or removed, by
            anyone, including you.
          </Notice>
        ) : (
          <>
            <Btn variant="danger" disabled={action.pending} onClick={revoke} style={{ alignSelf: 'flex-start' }}>
              Revoke every Administrator session
            </Btn>
            {action.error && (
              <p className="blocker" role="status" style={{ margin: 0 }}>
                <span aria-hidden="true">▲</span>
                <span>{action.error} The failed attempt is recorded.</span>
              </p>
            )}
          </>
        )}
      </section>

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Recorded events</h2>
        {auditEvents.length === 0 ? (
          <p className="sm muted" style={{ margin: 0 }}>
            Nothing has been recorded yet.
          </p>
        ) : (
          <table className="table">
            <tbody>
              {auditEvents.map((e) => (
                <tr key={e.id}>
                  <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                    <Ltr>{e.at.slice(0, 10)}</Ltr>
                  </td>
                  <td>{e.action}</td>
                  <td className="sm muted" style={{ whiteSpace: 'nowrap' }}>
                    {e.actor}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="caption muted" style={{ margin: 0 }}>
          Audit events are immutable — nothing in nova3D can edit or delete one.
        </p>
      </section>
    </div>
  )
}

// ── Accounts and Limits ──────────────────────────────────────────────────────

export function AccountsAndLimits() {
  const { accounts, usage } = useWorkspace()
  const session = useSession()
  const action = useAction()
  const [needsAuth, setNeedsAuth] = useState(false)

  const toggle = (accountId: string, disabled: boolean) => {
    if (!api.auth.hasFreshAuth()) {
      setNeedsAuth(true)
      return
    }
    void action.run(() => api.admin.setAccountDisabled(accountId, disabled))
  }

  return (
    <div className="page page-wide">
      <AdminBreadcrumb label="Accounts and Limits" />
      <PageHeader title="Accounts and Limits" meta="Every Account in this Workspace, its state, and its Usage Limit." />

      {needsAuth && <ReauthPrompt onDone={() => setNeedsAuth(false)} />}

      {action.error && (
        <p className="blocker" role="status" style={{ margin: 0 }}>
          <span aria-hidden="true">▲</span>
          <span>{action.error}</span>
        </p>
      )}

      {usage.reached && (
        <Notice tone="warn" glyph="▲" title="A Usage Limit is reached">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            No paid Job can start — a reservation cannot be taken inside a limit that is already used up.
            Free research still works.
          </p>
          <p style={{ margin: 0 }}>
            Raising the limit lets work continue, and nothing that already ran is affected, refunded or
            re-charged.
          </p>
        </Notice>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>Account</th>
            <th>State</th>
            <th>Usage Limit</th>
            <th>Spent</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const isSelf = a.id === session?.account.id
            return (
              <tr key={a.id}>
                <td>
                  {a.displayName} {a.isAdministrator && <span className="tag tag-accent-2">Administrator</span>}
                </td>
                <td className="sm">{a.disabled ? '⊘ disabled' : '● active'}</td>
                <td className="sm">
                  <Value of={isSelf ? usage.limit : api.PENDING} as="span" />
                </td>
                <td className="sm">
                  <Value of={isSelf ? usage.spent : api.PENDING} as="span" />
                </td>
                <td>
                  {!isSelf && (
                    <Btn variant="ghost" disabled={action.pending} onClick={() => toggle(a.id, !a.disabled)}>
                      {a.disabled ? 'Re-enable' : 'Disable'}
                    </Btn>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <Notice title="What disabling an Account does">
        <p style={{ margin: '0 0 var(--space-2)' }}>
          It cannot sign in, and its running Jobs stop accepting new work. Nothing in its Workspace is
          deleted — every Project, Version, approval and Source Record stays exactly as it is.
        </p>
        <p style={{ margin: 0 }}>Re-enabling restores access with everything intact. Disabling is not deletion.</p>
      </Notice>

      <Notice title="Two different decisions, two different screens">
        Setting someone else&rsquo;s Usage Limit is an Administrator action requiring fresh
        authentication. Your own limit is in{' '}
        <Link to="/settings/usage">Settings → Usage Limit and spending</Link> — a different screen,
        because it is a different decision.
      </Notice>
    </div>
  )
}
