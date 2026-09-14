import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '@/api'
import { useCurrentVersion, useProject, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { StepShell, WorkspaceShell } from '@/components/layout/shells'
import { ActionBar, GatePanel } from '@/components/nova3d/flow'
import { EvidenceRow, Reasoning, SourceReader } from '@/components/nova3d/evidence'
import { StatusLegend, StatusToken } from '@/components/nova3d/status'
import { Btn, Field, KeyValue, Ltr, Notice, PlateMark, Value, ViewportPlaceholder } from '@/components/ui/primitives'
import { AccuracyClaim, Breadcrumbs, useCurrentStageId, projectStages, useStageNav } from '@/features/projects/ProjectNav'
import { NotFound } from '@/features/errors'

export function ModelWorkspace() {
  const { projectId, featureId } = useParams()
  const project = useProject(projectId)
  const version = useCurrentVersion(project)
  const { claims } = useWorkspace()
  const navigate = useNavigate()
  const onStage = useStageNav()
  const stage = useCurrentStageId()
  const [tab, setTab] = useState('Feature')

  if (!project) return <NotFound />

  if (!version) {
    return (
      <div className="page page-wide">
        <Breadcrumbs project={project} trail={[{ label: 'Model' }]} />
        <h1 className="page-title">Nothing has been built yet</h1>
        <Notice glyph="⊘">
          {project.planApproval.state === 'approved'
            ? 'Generation is running. A Notification arrives when the model is ready to inspect.'
            : 'There is no model because the Plan has not been approved. Nothing is built before that gate.'}
        </Notice>
        <Link
          to={project.planApproval.state === 'approved' ? '/jobs' : `/projects/${project.id}/plan/approve`}
          className="btn btn-primary"
          style={{ alignSelf: 'flex-start' }}
        >
          {project.planApproval.state === 'approved' ? 'Watch generation' : 'Go to Plan Approval'}
        </Link>
      </div>
    )
  }

  const selected = version.features.find((f) => f.id === featureId) ?? version.features[0]
  const featureClaims = selected
    ? selected.claimIds.map((id) => claims.find((c) => c.id === id)).filter(Boolean)
    : []

  return (
    <div className="page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
        <Breadcrumbs project={project} trail={[{ label: 'Model' }]} />
      </div>

      <WorkspaceShell
        stages={projectStages(project)}
        currentStage={stage}
        onStage={onStage}
        panelTitle={
          <>
            Model Features · <Ltr>Version {version.number}</Ltr>
          </>
        }
        panel={
          <div className="stack">
            {version.features.map((f) => (
              <EvidenceRow
                key={f.id}
                title={f.name}
                status={f.status}
                claimCount={f.claimIds.length}
                governingRevision={f.governingRevision}
                selected={selected?.id === f.id}
                onSelect={() => navigate(`/projects/${project.id}/model/features/${f.id}`)}
              />
            ))}
          </div>
        }
        panelAction={
          <div className="stack gap-2">
            <Btn variant="primary" className="btn-block" onClick={() => navigate(`/projects/${project.id}/model/approve`)}>
              Go to Model Approval
            </Btn>
            <Link to={`/projects/${project.id}/model/versions`} className="btn btn-ghost btn-block">
              Versions
            </Link>
          </div>
        }
        viewport={
          <div className="stack" style={{ flex: 1 }}>
            <ViewportPlaceholder
              label="Read-only viewport"
              note="Rotate, pan and zoom. Nothing here can be moved, and no vertex can be dragged."
            />
            <div className="row gap-2 wrap" style={{ padding: 'var(--space-2)' }}>
              <Btn variant="secondary">Section</Btn>
              <Btn variant="secondary">Measure</Btn>
              <Btn variant="secondary">Isolate</Btn>
              <Link to={`/projects/${project.id}/model/legend`} className="btn btn-ghost">
                What the statuses mean
              </Link>
              <span className="caption muted grow">
                Every one of these has a keyboard path. None of them changes the model.
              </span>
            </div>

            {selected && (
              <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
                <h2 style={{ fontSize: 'var(--text-h4)' }}>Why {selected.name.toLowerCase()} is this shape</h2>
                {featureClaims.length === 0 && (
                  <p className="sm muted">
                    {selected.status === 'user-added'
                      ? 'You asked for this. It is not a claim about the historical object.'
                      : 'No Source examined answers this. It is left unknown rather than filled in.'}
                  </p>
                )}
                {featureClaims.map((c) =>
                  c ? (
                    <section key={c.id} className="stack gap-3" style={{ marginBottom: 'var(--space-6)' }}>
                      <EvidenceRow
                        title={c.statement}
                        status={c.status}
                        claimCount={c.sourceIds.length}
                        governingRevision={c.governingRevision}
                        onSelect={() => navigate(`/projects/${project.id}/plan/claims/${c.id}`)}
                      />
                      {c.reasoning && <Reasoning>{c.reasoning}</Reasoning>}
                      {c.passages[0] && <SourceReader passage={c.passages[0]} />}
                    </section>
                  ) : null,
                )}
              </div>
            )}
          </div>
        }
        inspectorTabs={['Feature', 'Actions']}
        activeTab={tab}
        onTab={setTab}
        inspector={
          tab === 'Feature' && selected ? (
            <div className="stack gap-3">
              <h3 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>{selected.name}</h3>
              <StatusToken status={selected.status} />
              {selected.dimensions.length > 0 ? (
                <KeyValue rows={selected.dimensions.map((d) => ({ k: d.label, v: <Value of={d.value} as="span" /> }))} />
              ) : (
                <p className="sm muted" style={{ margin: 0 }}>
                  No dimensions. This feature is present because a Claim describes it, not because a Source
                  gives a measurement.
                </p>
              )}
              <Notice>
                This model is read-only. Corrections go back through the evidence — a hand-moved vertex
                would have nothing behind it.
              </Notice>
            </div>
          ) : (
            <div className="stack gap-2">
              <Link to={`/projects/${project.id}/model/correct`} className="btn btn-secondary btn-block">
                Report a problem
              </Link>
              <Link to={`/projects/${project.id}/model/versions`} className="btn btn-secondary btn-block">
                Versions
              </Link>
              <Link to={`/projects/${project.id}/sources`} className="btn btn-secondary btn-block">
                Sources in this Project
              </Link>
            </div>
          )
        }
        statusStrip={
          <>
            <span>
              <Ltr>Version {version.number}</Ltr> · read-only
            </span>
            <span>
              {version.fromPlanRevision
                ? `Built from approved Plan revision ${version.fromPlanRevision}`
                : 'Converted from pictures — nothing was researched'}
            </span>
            <AccuracyClaim project={project} />
          </>
        }
      />
    </div>
  )
}

export function DetailStatusLegend() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const navigate = useNavigate()
  if (!project) return <NotFound />
  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Model', to: `/projects/${project.id}/model` }, { label: 'Statuses' }]} />
      <StepShell
        question="What the five statuses mean"
        intro="Every part of the model carries one of these. Each is a glyph and a word before it is a colour, so none of them depends on seeing colour accurately."
        actionBar={
          <ActionBar
            back="Back to the model"
            onBack={() => navigate(`/projects/${project.id}/model`)}
            consequence="Reading this changes nothing."
            primary="Back to the model"
            onPrimary={() => navigate(`/projects/${project.id}/model`)}
          />
        }
      >
        <StatusLegend />
        <Notice title="Two different things, kept apart">
          A Detail Status describes how firm a piece of the reconstruction is. Whether a Source is a lead
          or accepted evidence is a different question about a different object, so it is said in words —{' '}
          <em>lead — not yet evidence</em> and <em>accepted evidence</em> — rather than given a glyph that
          would look like a sixth status.
        </Notice>
      </StepShell>
    </div>
  )
}

export function Versions() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const navigate = useNavigate()
  const action = useAction()

  if (!project) return <NotFound />

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Model', to: `/projects/${project.id}/model` }, { label: 'Versions' }]} />
      <StepShell
        question="Versions"
        intro="Every Version is restorable, and each one keeps the evidence it was built from."
        actionBar={
          <ActionBar
            back="Back to the model"
            onBack={() => navigate(`/projects/${project.id}/model`)}
            consequence="Restoring an older Version does not delete the newer one."
            primary="Back to the model"
            onPrimary={() => navigate(`/projects/${project.id}/model`)}
          />
        }
      >
        {project.versions.length === 0 && <p className="sm muted">No Version has been generated yet.</p>}

        <div className="stack gap-3">
          {[...project.versions].reverse().map((v) => (
            <article key={v.id} className="card">
              <div className="row gap-3 wrap">
                <PlateMark size={34}>{`V${v.number}`}</PlateMark>
                <div className="stack gap-1 grow">
                  <div className="card-title">{v.summary}</div>
                  <div className="card-meta">
                    <span>{v.origin}</span>
                    <span>·</span>
                    <Ltr>{v.createdAt.slice(0, 10)}</Ltr>
                    {v.supersededBy && (
                      <>
                        <span>·</span>
                        <span>superseded by Version {project.versions.find((x) => x.id === v.supersededBy)?.number}</span>
                      </>
                    )}
                  </div>
                  {v.personalization && (
                    <div className="caption">
                      <span aria-hidden="true">+ </span>
                      {v.personalization}
                    </div>
                  )}
                  {v.approval.state === 'approved' && (
                    <div className="caption">
                      <span aria-hidden="true">✓ </span>
                      Model Approval bound to <Ltr>Version {v.number}</Ltr>
                    </div>
                  )}
                  {v.approval.state === 'withdrawn' && (
                    <div className="caption" style={{ color: 'var(--color-accent-2-strong)' }}>
                      <span aria-hidden="true">▲ </span>
                      Approval withdrawn — {v.approval.withdrawnBecause}
                    </div>
                  )}
                </div>
                <Btn
                  variant="secondary"
                  disabled={action.pending}
                  onClick={() => void action.run(() => api.models.restoreVersion(project.id, v.id))}
                >
                  Restore
                </Btn>
              </div>
            </article>
          ))}
        </div>
      </StepShell>
    </div>
  )
}

export function CorrectionRequest() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const version = useCurrentVersion(project)
  const navigate = useNavigate()
  const action = useAction()
  const [featureId, setFeatureId] = useState('')
  const [text, setText] = useState('')

  if (!project || !version) return <NotFound />

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Model', to: `/projects/${project.id}/model` }, { label: 'Report a problem' }]} />
      <StepShell
        question="Report a problem with the model"
        intro="Say what looks wrong. nova3D takes it back through the evidence rather than moving geometry."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/model`)}
            consequence="A correction may create a new Version, which needs Model Approval again."
            primary={action.pending ? 'Sending…' : 'Send this correction'}
            blockedReason={!text.trim() ? 'Say what looks wrong before sending it.' : undefined}
            onPrimary={async () => {
              const ok = await action.run(() => api.models.requestCorrection(project.id, featureId || version.features[0].id, text))
              if (ok) navigate(`/projects/${project.id}/model`)
            }}
          />
        }
      >
        <Field label="Which part?" hint="You can also select the part in the viewport and report from there.">
          <select className="input" value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
            <option value="">Choose a Model Feature</option>
            {version.features.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What is wrong with it?">
          <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>

        {action.error && (
          <p className="blocker" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">▲</span>
            <span>{action.error}</span>
          </p>
        )}

        <Notice title="What happens to this">
          nova3D re-researches the Claims that govern that feature. If the evidence supports your reading,
          the Plan gets a new revision and the geometry follows. If it does not, nova3D tells you what the
          Sources actually say and nothing changes.
        </Notice>
      </StepShell>
    </div>
  )
}

// ── The second gate ─────────────────────────────────────────────────────────

export function ModelApproval() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const version = useCurrentVersion(project)
  const navigate = useNavigate()
  const action = useAction()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  if (!project || !version) return <NotFound />

  const blockers = api.models.blockers(project)
  const approved = version.approval.state === 'approved'
  const f = version.features

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Model', to: `/projects/${project.id}/model` }, { label: 'Model Approval' }]} />
      <StepShell
        question="Model Approval"
        intro="The second gate. Export and printing both unlock after it — and both are blocked without it."
      >
        {approved ? (
          <Notice tone="accent" glyph="✓" title={`Version ${version.number} is approved`}>
            <p style={{ margin: '0 0 var(--space-2)' }}>Validation, Export and printing are open.</p>
            <div className="row gap-2 wrap">
              <Link to={`/projects/${project.id}/export`} className="btn btn-secondary">
                Validate and export
              </Link>
              <Link to={`/projects/${project.id}/print`} className="btn btn-primary">
                Print it
              </Link>
            </div>
          </Notice>
        ) : (
          <GatePanel
            kind="model"
            stamp={
              <span className="tag tag-neutral">
                <Ltr>Version {version.number}</Ltr>
              </span>
            }
            whatIsApproved="You are approving this exact Version as the model you want — the geometry you have inspected, built from the Plan you approved."
            checklist={[
              { label: 'Model Features built', count: f.length },
              { label: 'Features traced to a Source', count: f.filter((x) => x.status === 'sourced').length },
              { label: 'Features inferred', count: f.filter((x) => x.status === 'inferred').length },
              { label: 'Features left unknown', count: f.filter((x) => x.status === 'unknown').length },
              { label: 'Features you added', count: f.filter((x) => x.status === 'user-added').length },
              { label: 'Features still disputed', count: f.filter((x) => x.status === 'disputed').length, tone: 'warn' },
            ]}
            doesNotMean={[
              'It does not mean this will print. Validation against a Target Print Profile is a separate step, and even a pass is not a promise.',
              'It does not mean the reconstruction is correct. It means you have seen how firm each part is and accepted it.',
              'It does not approve any other Version. Regenerate, repair substantively, or correct, and this approval is withdrawn.',
            ]}
            invalidationRule="Model Approval is bound to this exact Version. Any change that produces a new Version withdraws it, and this panel will say what must be done again."
            blockedReason={blockers[0]}
            pending={action.pending}
            onApprove={() => void action.run(() => api.models.approve(project.id))}
            onReject={() => setRejecting(true)}
          />
        )}

        {project.imageDerived && (
          <Notice tone="warn" glyph="▲">
            This model is <strong>image-derived — not historically verified</strong>. Approving it does not
            change that, and nothing downstream removes the label.
          </Notice>
        )}

        {action.error && (
          <p className="blocker" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">▲</span>
            <span>{action.error}</span>
          </p>
        )}

        {rejecting && (
          <div className="stack gap-2">
            <label className="rail-label" htmlFor="mwhy">
              What is wrong with this Version?
            </label>
            <textarea id="mwhy" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="caption muted" style={{ margin: 0 }}>
              Rejecting sends this back as a correction request. The Version is kept and stays restorable.
            </p>
            <div className="row gap-2 wrap">
              <Btn
                variant="danger"
                disabled={!reason.trim() || action.pending}
                onClick={async () => {
                  const ok = await action.run(() => api.models.reject(project.id, reason))
                  if (ok) navigate(`/projects/${project.id}/model/correct`)
                }}
              >
                Reject this Version
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
