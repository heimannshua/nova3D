/**
 * The two content shells from DESIGN.md. Both render inside `AppShell`.
 *
 * Step shell     — everything that asks one question and takes one action:
 *                  Create, research review, both gates, validation, Export.
 *                  One column at 62–64ch, an optional aside, action bar pinned.
 *
 * Workspace shell — where a viewport or a long structured document must stay on
 *                  screen: the Model workspace and Research Plan review.
 *                  Stage rail · panel · viewport · inspector · status strip.
 *
 * Phone keeps the same order, stacked, by media query rather than by a device
 * switch — this is one responsive application, not two builds (NFR-16).
 */

import type { ReactNode } from 'react'
import { StepBar, type Step } from '@/components/nova3d/flow'

export function PageHeader({
  kicker,
  title,
  meta,
  actions,
}: {
  kicker?: ReactNode
  title: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="stack gap-1 grow">
        {kicker && <div className="rail-label">{kicker}</div>}
        <h1 className="page-title">{title}</h1>
        {meta && <div className="row gap-3 wrap sm muted">{meta}</div>}
      </div>
      {actions && <div className="row gap-2 wrap">{actions}</div>}
    </header>
  )
}

export function StepShell({
  steps,
  question,
  intro,
  children,
  aside,
  actionBar,
}: {
  steps?: Step[]
  question: string
  intro?: ReactNode
  children?: ReactNode
  aside?: ReactNode
  actionBar?: ReactNode
}) {
  return (
    <div className="step-shell">
      {steps && (
        <div className="step-shell-steps">
          <StepBar steps={steps} />
        </div>
      )}
      <div className="step-shell-body">
        <div className="step-shell-column">
          {/* h3 for the question a step is asking: a 42px headline turns a task
              into an article (DESIGN.md, Typography). */}
          <h3 className="question">{question}</h3>
          {intro && <div className="sm">{intro}</div>}
          {children}
        </div>
        {aside && <aside className="step-shell-aside">{aside}</aside>}
      </div>
      {actionBar}
    </div>
  )
}

export interface Stage {
  id: string
  label: string
  glyph: string
  to?: string
  locked?: boolean
  lockedReason?: string
}

export function WorkspaceShell({
  stages,
  currentStage,
  onStage,
  panelTitle,
  panel,
  panelAction,
  viewport,
  inspectorTabs,
  activeTab,
  onTab,
  inspector,
  statusStrip,
}: {
  stages?: Stage[]
  currentStage?: string
  onStage?: (s: Stage) => void
  panelTitle?: ReactNode
  panel?: ReactNode
  panelAction?: ReactNode
  viewport: ReactNode
  inspectorTabs?: string[]
  activeTab?: string
  onTab?: (t: string) => void
  inspector?: ReactNode
  statusStrip?: ReactNode
}) {
  return (
    <div className="workspace-shell">
      <div className="workspace-body">
        {stages && (
          <nav className="stage-rail" aria-label="Project stages">
            {stages.map((s) => (
              <button
                key={s.id}
                type="button"
                className="stage-rail-item"
                aria-current={currentStage === s.id ? 'step' : undefined}
                disabled={s.locked}
                title={s.locked ? s.lockedReason : undefined}
                onClick={() => onStage?.(s)}
              >
                <span aria-hidden="true" className="stage-glyph">
                  {s.locked ? '⊘' : s.glyph}
                </span>
                <span className="caption stage-label">{s.label}</span>
              </button>
            ))}
          </nav>
        )}

        {panel && (
          <div className="workspace-panel">
            {panelTitle && <div className="workspace-panel-head rail-label">{panelTitle}</div>}
            <div className="workspace-panel-body">{panel}</div>
            {panelAction && <div className="workspace-panel-foot">{panelAction}</div>}
          </div>
        )}

        <div className="workspace-viewport">{viewport}</div>

        {inspector && (
          <div className="workspace-inspector">
            {inspectorTabs && (
              <div className="workspace-tabs" role="tablist">
                {inspectorTabs.map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={activeTab === t} onClick={() => onTab?.(t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            <div className="workspace-inspector-body">{inspector}</div>
          </div>
        )}
      </div>
      {statusStrip && <div className="workspace-status-strip">{statusStrip}</div>}
    </div>
  )
}
