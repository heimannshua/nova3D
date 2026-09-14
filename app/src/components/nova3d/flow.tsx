import type { ReactNode } from 'react'
import { Btn } from '../ui/primitives'

export type StepState = 'passed' | 'current' | 'ahead' | 'locked'

export interface Step {
  n: number
  label: string
  state: StepState
  /** A locked step must state WHY it is locked, not just that it is. */
  lockedReason?: string
}

/**
 * Numbered steps with connectors. Passed steps are reachable. The current step
 * carries aria-current="step". A locked step is dashed and states its reason.
 *
 * On a phone this stays the same component: the segments compress and the spoken
 * "Step 4 of 6" comes from the aria-label, so a screen reader gets the position
 * whether or not the labels fit.
 */
export function StepBar({ steps }: { steps: Step[] }) {
  const current = steps.find((s) => s.state === 'current')
  const locked = steps.find((s) => s.state === 'locked' && s.lockedReason)
  return (
    <div className="stack">
      <nav
        className="step-bar"
        aria-label={current ? `Step ${current.n} of ${steps.length}: ${current.label}` : 'Steps'}
      >
        {steps.map((s, i) => (
          <span key={s.n} style={{ display: 'contents' }}>
            {i > 0 && <span className="connector" aria-hidden="true" />}
            <span
              className="step"
              data-state={s.state}
              aria-current={s.state === 'current' ? 'step' : undefined}
            >
              <span aria-hidden="true">{s.state === 'passed' ? '✓' : s.n}</span>
              <span>{s.label}</span>
            </span>
          </span>
        ))}
      </nav>
      {locked && (
        <p className="caption muted" style={{ margin: 0 }}>
          Step {locked.n} is locked: {locked.lockedReason}
        </p>
      )}
    </div>
  )
}

/**
 * Exactly one primary action. Back on the left, the consequence between them.
 *
 * A disabled primary MUST state its blocking reason immediately above it — a
 * greyed-out button with no reason is the thing this component exists to prevent.
 */
export function ActionBar({
  back,
  onBack,
  consequence,
  primary,
  onPrimary,
  blockedReason,
  gate = false,
  extra,
}: {
  back?: string
  onBack?: () => void
  consequence: ReactNode
  primary: string
  onPrimary?: () => void
  blockedReason?: string
  gate?: boolean
  extra?: ReactNode
}) {
  return (
    <div className="action-bar">
      {blockedReason && (
        <p className="blocker" role="status">
          <span aria-hidden="true">▲</span>
          <span>{blockedReason}</span>
        </p>
      )}
      {back && (
        <Btn variant="secondary" onClick={onBack}>
          {back}
        </Btn>
      )}
      <p className="consequence" style={{ margin: 0 }}>
        {consequence}
      </p>
      {extra}
      <Btn variant="primary" gate={gate} disabled={Boolean(blockedReason)} onClick={onPrimary}>
        {primary}
      </Btn>
    </div>
  )
}

/**
 * Plan Approval and Model Approval share this one component and NEVER share a
 * screen. Required parts, all present or the gate is not doing its job:
 *
 *   · the version stamp in the header
 *   · what is being approved, in one sentence
 *   · the review checklist with counts
 *   · a "what approval does not mean" block
 *   · reject-with-reason at equal visual weight to approve
 *   · the invalidation rule, stated in place
 *
 * When a change invalidates approval, the panel shows the withdrawn state and
 * what must be redone — never a silently carried-forward approval.
 */
export function GatePanel({
  kind,
  stamp,
  whatIsApproved,
  checklist,
  doesNotMean,
  invalidationRule,
  withdrawn,
  blockedReason,
  pending,
  onApprove,
  onReject,
}: {
  kind: 'plan' | 'model'
  stamp: ReactNode
  whatIsApproved: string
  checklist: { label: string; count: number; tone?: 'normal' | 'warn' }[]
  doesNotMean: string[]
  invalidationRule: string
  withdrawn?: { because: string; mustRedo: string[] }
  blockedReason?: string
  pending?: boolean
  onApprove?: () => void
  onReject?: () => void
}) {
  const title = kind === 'plan' ? 'Plan Approval' : 'Model Approval'
  return (
    <section className="gate-panel" data-blocked={Boolean(blockedReason)} aria-labelledby={`gate-${kind}`}>
      <header className="stack gap-2">
        <div className="version-stamp">
          <h3 id={`gate-${kind}`} style={{ margin: 0 }}>
            {title}
          </h3>
          {stamp}
        </div>
        <p style={{ margin: 0 }}>{whatIsApproved}</p>
      </header>

      {withdrawn && (
        <div className="gate-withdrawn">
          <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
            <span aria-hidden="true">▲ </span>This approval was withdrawn
          </strong>
          <p style={{ margin: '0 0 var(--space-2)' }}>{withdrawn.because}</p>
          <div>What must be done again:</div>
          <ul style={{ margin: 'var(--space-1) 0 0', paddingInlineStart: '1.2em' }}>
            {withdrawn.mustRedo.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="stack gap-2">
        <h4 style={{ margin: 0 }}>What you are approving</h4>
        <table className="table">
          <tbody>
            {checklist.map((c, i) => (
              <tr key={i}>
                <td>{c.label}</td>
                <td
                  style={{
                    textAlign: 'end',
                    fontWeight: 600,
                    color: c.tone === 'warn' ? 'var(--color-accent-2-strong)' : undefined,
                  }}
                >
                  {c.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="gate-not-mean">
        <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
          What approving does not mean
        </strong>
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          {doesNotMean.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </div>

      <p className="sm muted" style={{ margin: 0 }}>
        {invalidationRule}
      </p>

      {blockedReason && (
        <p className="sm" style={{ margin: 0, color: 'var(--color-accent-2-strong)' }}>
          <span aria-hidden="true">▲ </span>
          {blockedReason}
        </p>
      )}

      {/* Reject sits at equal visual weight to approve — same size, same row. */}
      <div className="gate-actions">
        <Btn variant="primary" gate disabled={Boolean(blockedReason) || pending} onClick={onApprove}>
          {pending ? 'Recording your approval…' : kind === 'plan' ? 'Approve this Plan' : 'Approve this Version'}
        </Btn>
        <Btn variant="secondary" gate onClick={onReject}>
          Reject, with a reason
        </Btn>
      </div>
    </section>
  )
}
