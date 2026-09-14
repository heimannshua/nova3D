/**
 * The stage rail for a Project, shared by the Plan, Model, Export and Print
 * screens.
 *
 * A stage the Project has not reached is genuinely locked, with the reason
 * stated — not hidden, and not clickable into an empty screen. That mirrors the
 * gates themselves: the flow stops where the evidence says it stops.
 */

import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as api from '@/api'
import type { Project } from '@/api'
import type { Stage } from '@/components/layout/shells'

export function projectStages(p: Project): Stage[] {
  const hasPlan = Boolean(p.plan)
  const planApproved = p.planApproval.state === 'approved'
  const version = api.models.current(p)
  const modelApproved = version?.approval.state === 'approved'
  const pictureDirect = p.origin === 'picture-direct'

  return [
    {
      id: 'plan',
      label: 'Plan',
      glyph: '☰',
      to: `/projects/${p.id}/plan`,
      locked: !hasPlan,
      lockedReason: pictureDirect
        ? 'This Project was converted directly from pictures, so there is no Research Plan — nothing was researched.'
        : 'Research has not produced a Plan yet.',
    },
    {
      id: 'model',
      label: 'Model',
      glyph: '◈',
      to: `/projects/${p.id}/model`,
      locked: !version,
      lockedReason: planApproved
        ? 'Generation is still running.'
        : 'Nothing is built before Plan Approval.',
    },
    {
      id: 'export',
      label: 'Validate',
      glyph: '⎇',
      to: `/projects/${p.id}/export`,
      locked: !modelApproved,
      lockedReason: 'Model Approval gates validation and Export.',
    },
    {
      id: 'print',
      label: 'Print',
      glyph: '▤',
      to: `/projects/${p.id}/print`,
      locked: !modelApproved,
      lockedReason: 'Model Approval gates printing.',
    },
  ]
}

export function useStageNav() {
  const navigate = useNavigate()
  return (s: Stage) => {
    if (s.locked || !s.to) return
    navigate(s.to)
  }
}

export function useCurrentStageId(): string {
  const path = useLocation().pathname
  if (path.includes('/plan')) return 'plan'
  if (path.includes('/model')) return 'model'
  if (path.includes('/export')) return 'export'
  if (path.includes('/print')) return 'print'
  return ''
}

export function Breadcrumbs({ project, trail }: { project: Project; trail: { label: string; to?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/projects">My Projects</Link>
      <span aria-hidden="true">/</span>
      <Link to={`/projects/${project.id}`}>{project.name}</Link>
      {trail.map((t, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span aria-hidden="true">/</span>
          {t.to ? <Link to={t.to}>{t.label}</Link> : <span className="muted">{t.label}</span>}
        </span>
      ))}
    </nav>
  )
}

/** The permanent accuracy claim. It travels everywhere and never comes off. */
export function AccuracyClaim({ project }: { project: Project }) {
  return project.imageDerived ? (
    <span className="caption" style={{ color: 'var(--color-accent-2-strong)' }}>
      <span aria-hidden="true">▲ </span>image-derived — not historically verified
    </span>
  ) : (
    <span className="caption muted">
      <span aria-hidden="true">● </span>evidence-backed — every decision traceable to a Source
    </span>
  )
}
