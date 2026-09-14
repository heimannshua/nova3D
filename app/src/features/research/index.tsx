import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '@/api'
import type { Claim } from '@/api'
import { useClaim, useProject, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { StepShell, WorkspaceShell } from '@/components/layout/shells'
import { ActionBar, GatePanel } from '@/components/nova3d/flow'
import { DefensibleOptions, EvidenceRow, Reasoning, SourceReader, SourceRow } from '@/components/nova3d/evidence'
import { StatusToken } from '@/components/nova3d/status'
import { Btn, Ltr, Notice } from '@/components/ui/primitives'
import { Breadcrumbs, useCurrentStageId, projectStages, useStageNav } from '@/features/projects/ProjectNav'
import { NotFound } from '@/features/errors'

export function PlanWorkspace() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const { claims } = useWorkspace()
  const navigate = useNavigate()
  const onStage = useStageNav()
  const stage = useCurrentStageId()
  const [selected, setSelected] = useState<string | null>(null)

  if (!project) return <NotFound />
  if (!project.plan) {
    return (
      <div className="page page-wide">
        <Breadcrumbs project={project} trail={[{ label: 'Plan' }]} />
        <h1 className="page-title">There is no Research Plan</h1>
        <Notice>
          {project.origin === 'picture-direct'
            ? 'This Project was converted directly from pictures. Nothing was researched, so there is no Plan, no Sources and no Plan Approval — and the model is marked image-derived because of it.'
            : 'Research has not finished yet. It will appear here, area by area, when it does.'}
        </Notice>
        <Link to={`/projects/${project.id}`} className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
          Back to the Project
        </Link>
      </div>
    )
  }

  const plan = project.plan
  const area = plan.areas.find((a) => a.id === selected) ?? plan.areas[0]
  const blockers = api.plans.blockers(project)

  return (
    <div className="page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
        <Breadcrumbs project={project} trail={[{ label: 'Research Plan' }]} />
      </div>

      <WorkspaceShell
        stages={projectStages(project)}
        currentStage={stage}
        onStage={onStage}
        panelTitle={
          <>
            Completeness areas · <Ltr>revision {plan.revision}</Ltr>
          </>
        }
        panel={
          <div className="stack">
            {plan.areas.map((a) => (
              <button key={a.id} type="button" className="evidence-row" aria-current={area.id === a.id} onClick={() => setSelected(a.id)}>
                <span className="stack gap-1 grow">
                  <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600 }}>{a.name}</span>
                  <span className="caption muted">
                    {a.state === 'complete' && '✓ complete'}
                    {a.state === 'in-progress' && '◷ still being researched'}
                    {a.state === 'unknown-declared' && '? unknown, declared'}
                    {' · '}
                    {a.claimIds.length} {a.claimIds.length === 1 ? 'Claim' : 'Claims'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        }
        panelAction={
          <div className="stack gap-2">
            <Btn variant="primary" className="btn-block" onClick={() => navigate(`/projects/${project.id}/plan/approve`)}>
              Go to Plan Approval
            </Btn>
            <Link to={`/projects/${project.id}/plan/revisions`} className="btn btn-ghost btn-block">
              What changed between revisions
            </Link>
          </div>
        }
        viewport={
          <div style={{ padding: 'var(--space-4)' }}>
            <h2 style={{ fontSize: 'var(--text-h3)' }}>{area.name}</h2>

            {blockers.length > 0 && (
              <Notice tone="warn" glyph="▲" title="The Plan cannot be approved yet">
                <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
                  {blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </Notice>
            )}

            {area.state === 'unknown-declared' ? (
              <Notice glyph="?" title="Declared unknown">
                {area.declaredUnknowns.map((u, i) => (
                  <p key={i} style={{ margin: i ? 'var(--space-2) 0 0' : 0 }}>
                    {u}
                  </p>
                ))}
                <p style={{ margin: 'var(--space-2) 0 0' }}>
                  nova3D leaves this unknown rather than choosing a value. An unknown in the Plan becomes
                  an unknown in the model, visible on the Model Feature it affects.
                </p>
              </Notice>
            ) : area.claimIds.length === 0 ? (
              <Notice glyph="◷" title="Still being researched">
                No Claims have been accepted in this area yet. The Job is running and this area will fill
                in. The Plan cannot be approved while any area is still open.
              </Notice>
            ) : (
              <div className="stack">
                {area.claimIds.map((id) => {
                  const c = claims.find((x) => x.id === id)
                  if (!c) return null
                  return (
                    <EvidenceRow
                      key={c.id}
                      title={c.statement}
                      status={c.status}
                      claimCount={c.sourceIds.length}
                      governingRevision={c.governingRevision}
                      onSelect={() => navigate(`/projects/${project.id}/plan/claims/${c.id}`)}
                      trailing={
                        c.invalidated ? (
                          <span className="caption" style={{ color: 'var(--color-accent-2-strong)' }}>
                            <span aria-hidden="true">◷ </span>being rechecked
                          </span>
                        ) : c.status === 'disputed' && !c.chosenOptionId ? (
                          <span className="caption" style={{ color: 'var(--color-accent-2-strong)' }}>
                            needs your decision
                          </span>
                        ) : undefined
                      }
                    />
                  )
                })}
              </div>
            )}
          </div>
        }
        inspectorTabs={['Plan', 'Sources']}
        activeTab="Plan"
        inspector={
          <div className="stack gap-4">
            <div>
              <div className="rail-label">Consequential Details</div>
              <p className="sm" style={{ margin: 'var(--space-1) 0 0' }}>
                Every Consequential Detail must have linked evidence or an explicit Detail Status before
                this Plan can be approved.
              </p>
            </div>
            {plan.cachedRevision && (
              <div>
                <div className="rail-label">Cached research</div>
                <p className="sm" style={{ margin: 'var(--space-1) 0 0' }}>
                  Some Claims came from a Cached Research Revision recorded <Ltr>{plan.cachedRevision.recorded}</Ltr>.
                  Reused, not re-checked — that date travels with every Claim taken from it.
                </p>
              </div>
            )}
            <div>
              <div className="rail-label">Sources in this Project</div>
              <Link to={`/projects/${project.id}/sources`} className="sm">
                Accepted and rejected Sources
              </Link>
            </div>
          </div>
        }
        statusStrip={
          <>
            <span>
              Plan <Ltr>revision {plan.revision}</Ltr>
            </span>
            <span>
              {plan.areas.filter((a) => a.state === 'complete').length} of {plan.areas.length} areas complete
            </span>
            <span>{plan.gapReviewPassed ? '✓ independent gap review recorded' : '◷ gap review not yet run'}</span>
          </>
        }
      />
    </div>
  )
}

export function ClaimDetail() {
  const { projectId, claimId } = useParams()
  const project = useProject(projectId)
  const claim = useClaim(claimId)
  const navigate = useNavigate()
  const action = useAction()
  const { sources } = useWorkspace()

  if (!project || !claim) return <NotFound />

  const choose = async (optionId: string) => {
    const ok = await action.run(() => api.plans.chooseOption(project.id, claim.id, optionId))
    if (ok) navigate(`/projects/${project.id}/plan`)
  }

  return (
    <div className="page page-wide">
      <Breadcrumbs
        project={project}
        trail={[{ label: 'Research Plan', to: `/projects/${project.id}/plan` }, { label: 'Claim' }]}
      />
      <StepShell
        question={claim.statement}
        intro={
          <span className="row gap-3 wrap">
            <StatusToken status={claim.status} />
            <span className="muted">
              governed by <Ltr>revision {claim.governingRevision}</Ltr>
            </span>
            {claim.invalidated && (
              <span style={{ color: 'var(--color-accent-2-strong)' }}>
                <span aria-hidden="true">◷ </span>being rechecked after a Source was rejected
              </span>
            )}
          </span>
        }
        aside={
          <div className="stack gap-3">
            <div className="rail-label">Sources for this Claim</div>
            {claim.sourceIds.length === 0 && (
              <p className="sm muted" style={{ margin: 0 }}>
                None. {claim.status === 'unknown' ? 'No Source examined answers this.' : 'This is not a claim about the historical object.'}
              </p>
            )}
            {claim.sourceIds.map((id) => {
              const s = sources.find((x) => x.id === id)
              if (!s) return null
              return (
                <SourceRow
                  key={id}
                  source={s}
                  projectEntry={project.sources.find((ps) => ps.sourceId === id)}
                  onReject={() => void action.run(() => api.plans.rejectSource(project.id, id, 'Rejected while reading a Claim.'))}
                />
              )
            })}
          </div>
        }
        actionBar={
          <ActionBar
            back="Back to the Plan"
            onBack={() => navigate(`/projects/${project.id}/plan`)}
            consequence="Reading a Claim changes nothing. Rejecting a Source does."
            primary="Back to the Plan"
            onPrimary={() => navigate(`/projects/${project.id}/plan`)}
          />
        }
      >
        {claim.status === 'disputed' && (
          <DefensibleOptions claim={claim} chosenId={claim.chosenOptionId} onChoose={choose} pending={action.pending} />
        )}

        {claim.reasoning && <Reasoning>{claim.reasoning}</Reasoning>}

        {claim.passages.map((p, i) => (
          <section key={i} className="stack gap-2">
            <div className="rail-label">Passage {i + 1}</div>
            <SourceReader passage={p} source={sources.find((s) => s.id === claim.sourceIds[i])} />
          </section>
        ))}

        {claim.passages.length > 0 && (
          <Notice title="Why these are three blocks">
            Original language, translation and explanation are kept apart so you can see which is which.
            A translation is an interpretation; an explanation is nova3D&rsquo;s, not the
            Source&rsquo;s. Merging them into one paragraph would hide where each ends.
          </Notice>
        )}
      </StepShell>
    </div>
  )
}

export function PlanRevisions() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const { claims } = useWorkspace()
  const navigate = useNavigate()

  if (!project?.plan) return <NotFound />

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Research Plan', to: `/projects/${project.id}/plan` }, { label: 'Revisions' }]} />
      <StepShell
        question="What changed between revisions"
        intro={`This Plan is at revision ${project.plan.revision}.`}
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/plan`)}
            consequence="Comparing changes nothing."
            primary="Go to Plan Approval"
            onPrimary={() => navigate(`/projects/${project.id}/plan/approve`)}
          />
        }
      >
        {project.plan.history.length === 0 && (
          <p className="sm muted">This Plan has only one revision so far.</p>
        )}

        {project.plan.history.map((rev) => (
          <section key={rev.revision} className="stack gap-2">
            <h4 style={{ margin: 0 }}>
              <Ltr>Revision {rev.revision}</Ltr>
            </h4>
            <p className="sm muted" style={{ margin: 0 }}>
              {rev.cause} · <Ltr>{rev.createdAt.slice(0, 10)}</Ltr>
            </p>
            {rev.changes.length > 0 && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Was</th>
                    <th>Now</th>
                  </tr>
                </thead>
                <tbody>
                  {rev.changes.map((c, i) => (
                    <tr key={i}>
                      <td>{claims.find((x) => x.id === c.claimId)?.statement ?? c.claimId}</td>
                      <td className="sm muted">{c.was}</td>
                      <td className="sm">{c.now}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}

        {project.planApproval.state === 'withdrawn' && (
          <Notice tone="warn" glyph="▲" title="What a revision withdrew">
            <p style={{ margin: '0 0 var(--space-2)' }}>{project.planApproval.withdrawnBecause}</p>
            <p style={{ margin: 0 }}>
              Plan Approval bound to <Ltr>{project.planApproval.boundTo}</Ltr> was withdrawn. It was not
              carried forward.
            </p>
          </Notice>
        )}
      </StepShell>
    </div>
  )
}

// ── The first gate ──────────────────────────────────────────────────────────

export function PlanApproval() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const { claims } = useWorkspace()
  const navigate = useNavigate()
  const action = useAction()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  if (!project?.plan) return <NotFound />

  const plan = project.plan
  const planClaims: Claim[] = plan.areas
    .flatMap((a) => a.claimIds)
    .map((id) => claims.find((c) => c.id === id))
    .filter((c): c is Claim => Boolean(c))

  const blockers = api.plans.blockers(project)
  const approved = project.planApproval.state === 'approved'

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Research Plan', to: `/projects/${project.id}/plan` }, { label: 'Plan Approval' }]} />
      <StepShell question="Plan Approval" intro="This is the gate. Nothing is generated before it.">
        {approved ? (
          <Notice tone="accent" glyph="✓" title={`Approved at revision ${plan.revision}`}>
            <p style={{ margin: '0 0 var(--space-2)' }}>
              Generation has started. You can leave — a Notification arrives when the model is ready to
              inspect.
            </p>
            <div className="row gap-2 wrap">
              <Link to="/jobs" className="btn btn-secondary">
                Watch it run
              </Link>
              <Link to={`/projects/${project.id}/model`} className="btn btn-primary">
                Go to the model
              </Link>
            </div>
          </Notice>
        ) : (
          <GatePanel
            kind="plan"
            stamp={
              <span className="tag tag-neutral">
                <Ltr>Revision {plan.revision}</Ltr>
              </span>
            }
            whatIsApproved="You are approving this Research Plan as the evidence nova3D will build from — not the model, which does not exist yet."
            checklist={[
              { label: 'Completeness areas complete', count: plan.areas.filter((a) => a.state === 'complete').length },
              { label: 'Claims with a Source attached', count: planClaims.filter((c) => c.status === 'sourced').length },
              { label: 'Claims inferred, with reasoning shown', count: planClaims.filter((c) => c.status === 'inferred').length },
              { label: 'Unknowns declared rather than filled in', count: planClaims.filter((c) => c.status === 'unknown').length },
              {
                label: 'Disputed readings still awaiting your decision',
                count: planClaims.filter((c) => c.status === 'disputed' && !c.chosenOptionId).length,
                tone: 'warn',
              },
            ]}
            doesNotMean={[
              'It does not mean the reconstruction is historically correct. Where the evidence is thin, the model will be thin in the same places, and will say so.',
              'It does not mean anything can be printed. That is Model Approval, on a different screen, after you have seen the geometry.',
              'It does not approve any future revision. Change the evidence and this approval is withdrawn.',
            ]}
            invalidationRule="If a Source is rejected, a disputed reading is decided, or research adds a Claim, this Plan becomes a new revision and this approval is withdrawn in place — with what must be done again stated here."
            blockedReason={blockers[0]}
            withdrawn={
              project.planApproval.state === 'withdrawn'
                ? { because: project.planApproval.withdrawnBecause ?? '', mustRedo: project.planApproval.mustRedo ?? [] }
                : undefined
            }
            pending={action.pending}
            onApprove={() => void action.run(() => api.plans.approve(project.id))}
            onReject={() => setRejecting(true)}
          />
        )}

        {blockers.length > 0 && !approved && (
          <div className="row gap-2 wrap">
            <Link to={`/projects/${project.id}/plan`} className="btn btn-secondary">
              Take me to what is blocking it
            </Link>
          </div>
        )}

        {action.error && (
          <p className="blocker" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">▲</span>
            <span>{action.error}</span>
          </p>
        )}

        {rejecting && (
          <div className="stack gap-2">
            <label className="rail-label" htmlFor="why">
              Why are you rejecting this Plan?
            </label>
            <textarea id="why" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="caption muted" style={{ margin: 0 }}>
              The reason is recorded on the Plan and in the Source Record. Research restarts from it
              rather than from the beginning.
            </p>
            <div className="row gap-2 wrap">
              <Btn
                variant="danger"
                disabled={!reason.trim() || action.pending}
                onClick={async () => {
                  const ok = await action.run(() => api.plans.reject(project.id, reason))
                  if (ok) navigate(`/projects/${project.id}`)
                }}
              >
                Reject this Plan
              </Btn>
              <Btn variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Btn>
            </div>
          </div>
        )}
      </StepShell>
    </div>
  )
}

/** Sources in a Project — accepted, and rejected for this Project only. */
export function ProjectSources() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const { sources } = useWorkspace()
  const action = useAction()
  const navigate = useNavigate()

  if (!project) return <NotFound />

  const rows = project.sources
    .map((ps) => ({ ps, source: sources.find((s) => s.id === ps.sourceId) }))
    .filter((r): r is { ps: typeof r.ps; source: NonNullable<typeof r.source> } => Boolean(r.source))

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Sources' }]} />
      <StepShell
        question="Sources in this Project"
        intro="What this Project used, and what it was told not to use."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}`)}
            consequence="Rejecting a Source here affects this Project only."
            primary="Back to the Project"
            onPrimary={() => navigate(`/projects/${project.id}`)}
          />
        }
      >
        {rows.length === 0 && (
          <p className="sm muted">
            This Project has no Sources. Nothing was researched — it was converted directly from
            pictures.
          </p>
        )}

        {rows.filter((r) => !r.ps.rejected).length > 0 && (
          <section className="stack gap-2">
            <div className="rail-label">Accepted evidence</div>
            {rows
              .filter((r) => !r.ps.rejected)
              .map((r) => (
                <SourceRow
                  key={r.source.id}
                  source={r.source}
                  projectEntry={r.ps}
                  showRole
                  onReject={() => void action.run(() => api.plans.rejectSource(project.id, r.source.id, 'Not a primary description of the structure.'))}
                />
              ))}
          </section>
        )}

        {rows.filter((r) => r.ps.rejected).length > 0 && (
          <section className="stack gap-2">
            <div className="rail-label">Rejected for this Project</div>
            {rows.filter((r) => r.ps.rejected).map((r) => (
              <SourceRow key={r.source.id} source={r.source} projectEntry={r.ps} />
            ))}
          </section>
        )}

        <Notice title="Two different controls, deliberately">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            <strong>Do not use in this Project</strong> removes a Source from this Project&rsquo;s
            evidence. Claims that depended on it are invalidated and visibly rechecked, and nova3D looks
            for replacement evidence.
          </p>
          <p style={{ margin: 0 }}>
            <Link to="/settings/sources">Sources available to new Projects</Link>, in Settings, is
            Account-wide and affects what future Projects may use. It is a different decision, so it is a
            different control with different words — never one toggle doing both.
          </p>
        </Notice>
      </StepShell>
    </div>
  )
}
