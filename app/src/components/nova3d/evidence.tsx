import type { ReactNode } from 'react'
import type { Claim, Passage, ProjectSource, Source } from '@/api'
import { StatusToken, SourceRoleLabel } from './status'
import { Btn, Ltr, Value } from '../ui/primitives'

/**
 * A Model Feature or Claim with its status token, its Claim count, and the Plan
 * revision that governs it. The governing revision is not decoration: it is how a
 * reader tells which approval a row is bound to.
 */
export function EvidenceRow({
  title,
  status,
  claimCount,
  governingRevision,
  selected,
  onSelect,
  trailing,
}: {
  title: string
  status: Claim['status']
  claimCount?: number
  governingRevision: number
  selected?: boolean
  onSelect?: () => void
  trailing?: ReactNode
}) {
  return (
    <button type="button" className="evidence-row" aria-current={selected} onClick={onSelect}>
      <span className="stack gap-1 grow">
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600 }}>{title}</span>
        <span className="row gap-3 wrap">
          <StatusToken status={status} />
          {claimCount !== undefined && (
            <span className="caption muted">
              {claimCount} {claimCount === 1 ? 'Claim' : 'Claims'}
            </span>
          )}
          <span className="caption muted">
            governed by <Ltr>revision {governingRevision}</Ltr>
          </span>
        </span>
      </span>
      {trailing}
    </button>
  )
}

/**
 * Three semantically separate blocks — never one paragraph with mixed direction.
 *
 *   · original language, with lang and dir on the element, at 1.15× for equal
 *     apparent weight against Latin text
 *   · translation
 *   · explanation, in italic
 *   · the citation as its own LTR run
 *
 * Where content is not yet verified, the block reads "verified content pending"
 * rather than inventing a passage.
 */
export function SourceReader({ passage, source }: { passage: Passage; source?: Source }) {
  return (
    <div className="source-reader">
      <div>
        <div className="rail-label">Original</div>
        <div className="source-original" lang={passage.lang} dir={passage.dir}>
          <Value of={passage.original} kind="content" />
        </div>
      </div>
      <div>
        <div className="rail-label">Translation</div>
        <p className="source-translation" style={{ margin: 0 }}>
          <Value of={passage.translation} kind="content" />
        </p>
      </div>
      <div>
        <div className="rail-label">Explanation</div>
        <p className="source-explanation" style={{ margin: 0 }}>
          <Value of={passage.explanation} kind="content" />
        </p>
      </div>
      <div className="source-citation">
        <Ltr>
          <Value of={passage.citation} kind="content" />
        </Ltr>
        {source && (
          <>
            {' · retrieved '}
            <Ltr>{source.retrieved}</Ltr>
          </>
        )}
      </div>
    </div>
  )
}

/** An inferred Claim shows its reasoning in full — never a summary of it. */
export function Reasoning({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
        <span aria-hidden="true">○ </span>How this was inferred
      </strong>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  )
}

/**
 * A disputed reading. Both options at equal weight, each stating what choosing it
 * would change. Neither is preselected, and nova3D does not decide (FR-11).
 */
export function DefensibleOptions({
  claim,
  chosenId,
  onChoose,
  pending,
}: {
  claim: Claim
  /** Undefined until the user decides. nova3D never preselects one. */
  chosenId?: string
  onChoose?: (optionId: string) => void
  pending?: boolean
}) {
  if (!claim.options?.length) return null
  return (
    <div className="stack gap-3">
      <p className="sm muted" style={{ margin: 0 }}>
        Sources disagree here. Both readings are defensible. nova3D will not choose between them,
        because choosing would make the reconstruction say something the evidence does not.
      </p>
      <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {claim.options.map((o) => (
          <div key={o.id} className="card">
            <div className="card-title">{o.reading}</div>
            <div className="sm">
              <strong>If you choose this: </strong>
              {o.consequence}
            </div>
            <div className="card-meta">
              Supported by {o.supportedBy.length} {o.supportedBy.length === 1 ? 'Source' : 'Sources'}
            </div>
            <Btn
              variant={chosenId === o.id ? 'primary' : 'secondary'}
              disabled={pending}
              onClick={() => onChoose?.(o.id)}
            >
              {chosenId === o.id ? 'Chosen' : 'Choose this reading'}
            </Btn>
          </div>
        ))}
      </div>
      <p className="caption muted" style={{ margin: 0 }}>
        Deciding creates a new Plan revision and withdraws any approval that came before it. The panel
        will say what must be done again.
      </p>
    </div>
  )
}

/**
 * A Source in a list. The two exclusion controls are deliberately different
 * words on different surfaces and are never merged into one toggle:
 *
 *   "Do not use in this Project"  → FR-43, this Project only
 *   "Sources available to new Projects" (S-03) → FR-44, Account-wide
 */
export function SourceRow({
  source,
  projectEntry,
  disabledAccountWide,
  showRole,
  onReject,
  onRead,
}: {
  source: Source
  /** Per-Project standing (FR-43). Absent outside a Project. */
  projectEntry?: ProjectSource
  /** Account-wide availability (FR-44). A different decision entirely. */
  disabledAccountWide?: boolean
  showRole?: boolean
  onReject?: () => void
  onRead?: () => void
}) {
  const rejected = Boolean(projectEntry?.rejected)
  return (
    <div className="evidence-row" style={{ cursor: 'default' }}>
      <span className="stack gap-1 grow">
        <Value of={source.title} kind="content" className="" />
        <span className="row gap-3 wrap">
          <span className="caption muted">
            edition <Value of={source.edition} kind="content" as="span" />
          </span>
          <span className="caption muted">
            retrieved <Ltr>{source.retrieved}</Ltr>
          </span>
          {showRole && <SourceRoleLabel role={source.role} />}
        </span>
        {rejected && (
          <span className="caption" style={{ color: 'var(--color-accent-2-strong)' }}>
            <span aria-hidden="true">⊘ </span>
            Not used in this Project. {projectEntry?.rejectionReason}
          </span>
        )}
        {disabledAccountWide && (
          <span className="caption muted">
            <span aria-hidden="true">⊘ </span>
            Switched off for new Projects in Settings. Completed Projects that used it are unchanged.
          </span>
        )}
      </span>
      <span className="row gap-2">
        {onRead && (
          <Btn variant="ghost" onClick={onRead}>
            Read
          </Btn>
        )}
        {onReject && !rejected && (
          <Btn variant="secondary" onClick={onReject}>
            Do not use in this Project
          </Btn>
        )}
      </span>
    </div>
  )
}
