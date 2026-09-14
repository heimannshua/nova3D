/**
 * Validation and Export.
 *
 * PRD §4.5, which survives the print scope change unaltered: Export "still
 * exists and is never blocked" by printing existing. It is gated exactly as
 * printing is — Model Approval for the exact Version, and a validation result
 * that is not a blocking failure — and neither gate is softened because the file
 * is only being downloaded.
 */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '@/api'
import type { ValidationOutcome } from '@/api'
import { useCurrentVersion, useProject, useProjectJobs, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { StepShell } from '@/components/layout/shells'
import { ActionBar } from '@/components/nova3d/flow'
import { StepBlocks } from '@/components/nova3d/status'
import { KeyValue, Ltr, Notice, StatedAbsence, Value, Wording } from '@/components/ui/primitives'
import { Breadcrumbs } from '@/features/projects/ProjectNav'
import { NotFound } from '@/features/errors'

const OUTCOME: Record<ValidationOutcome, { glyph: string; word: string; warn?: boolean }> = {
  passing: { glyph: '✓', word: 'passing' },
  warning: { glyph: '◐', word: 'warning' },
  blocking: { glyph: '▲', word: 'blocking failure', warn: true },
  unknown: { glyph: '?', word: 'unknown' },
}

function Outcome({ outcome }: { outcome: ValidationOutcome }) {
  const o = OUTCOME[outcome]
  return (
    <span className="status-token" style={{ color: o.warn ? 'var(--color-accent-2-strong)' : undefined }}>
      <span className="glyph" aria-hidden="true">
        {o.glyph}
      </span>
      <span>{o.word}</span>
    </span>
  )
}

const steps = (current: number) =>
  ['Profile', 'Validate', 'Repair', 'Download'].map((label, i) => ({
    n: i + 1,
    label,
    state: i + 1 < current ? ('passed' as const) : i + 1 === current ? ('current' as const) : ('ahead' as const),
  }))

export function ExportOverview() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const version = useCurrentVersion(project)
  const { profiles } = useWorkspace()
  const navigate = useNavigate()
  const action = useAction()
  const jobs = useProjectJobs(projectId)
  const validating = jobs.some((j) => j.kind === 'validation' && j.state === 'running')

  if (!project || !version) return <NotFound />

  const profile = profiles.find((p) => p.id === project.targetProfileId)
  const blockers = api.exports.blockers(project)

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Validate and export' }]} />
      <StepShell
        steps={steps(profile ? (project.validation ? 4 : 2) : 1)}
        question="What are you making this for?"
        intro="Validation is only meaningful against a specific printer, material and physical size. This is that choice."
        actionBar={
          <ActionBar
            back="Back to the model"
            onBack={() => navigate(`/projects/${project.id}/model`)}
            consequence="Changing any of these invalidates the current validation and slice."
            primary={validating ? 'Validating…' : project.validation ? 'See the results' : 'Validate against this profile'}
            blockedReason={!profile ? 'Choose a Target Print Profile first.' : undefined}
            onPrimary={async () => {
              if (project.validation) {
                navigate(`/projects/${project.id}/export/validate`)
                return
              }
              const ok = await action.run(() => api.exports.validate(project.id))
              if (ok) navigate(`/projects/${project.id}/export/validate`)
            }}
          />
        }
      >
        <div className="stack gap-3">
          <div className="rail-label">Target Print Profile</div>
          {profiles.map((p) => (
            <label key={p.id} className="radio-card" data-checked={project.targetProfileId === p.id}>
              <input
                type="radio"
                name="profile"
                checked={project.targetProfileId === p.id}
                onChange={() => void action.run(() => api.exports.setProfile(project.id, p.id))}
              />
              <span className="dot" aria-hidden="true" />
              <span className="stack gap-1 grow">
                <span className="radio-card-title">{p.printerName}</span>
                <span className="sm">
                  Material <Value of={p.material} kind="content" as="span" /> · size{' '}
                  <Value of={p.physicalSize} as="span" />
                </span>
              </span>
            </label>
          ))}
        </div>

        <Notice glyph="▲">
          The wall, feature, clearance, orientation and support rules for this profile have not been
          established yet (AD-3). Until they are, checks that depend on them report{' '}
          <strong>unknown</strong> rather than passing.
        </Notice>

        {blockers.length > 0 && (
          <Notice tone="warn" glyph="▲" title="Export is blocked">
            <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
              {blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </Notice>
        )}
      </StepShell>
    </div>
  )
}

export function ValidationResults() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const { profiles } = useWorkspace()
  const jobs = useProjectJobs(projectId)
  const navigate = useNavigate()
  const running = jobs.find((j) => j.kind === 'validation' && j.state === 'running')

  if (!project) return <NotFound />

  const profile = profiles.find((p) => p.id === project.targetProfileId)

  if (running) {
    return (
      <div className="page page-wide">
        <Breadcrumbs project={project} trail={[{ label: 'Validate', to: `/projects/${project.id}/export` }, { label: 'Results' }]} />
        <StepShell steps={steps(2)} question="Validating" intro={running.stage}>
          <StepBlocks done={running.progress?.done} total={running.progress?.total} />
          <p className="sm muted">You can leave. A Notification arrives when it finishes.</p>
        </StepShell>
      </div>
    )
  }

  if (!project.validation) {
    return (
      <div className="page page-wide">
        <Breadcrumbs project={project} trail={[{ label: 'Validate' }]} />
        <h1 className="page-title">Not validated yet</h1>
        <Link to={`/projects/${project.id}/export`} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
          Choose a profile and validate
        </Link>
      </div>
    )
  }

  const v = project.validation
  const blocking = v.outcome === 'blocking'

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Validate', to: `/projects/${project.id}/export` }, { label: 'Results' }]} />
      <StepShell
        steps={steps(2)}
        question="Validation results"
        intro={
          <>
            Checked against <strong>{profile?.printerName}</strong>, last run <Ltr>{v.lastValidated.slice(0, 10)}</Ltr>.
          </>
        }
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/export`)}
            consequence="A pass is about this profile only. It is not a statement about safety."
            primary={blocking ? 'Repair what can be repaired' : 'Continue to the download'}
            onPrimary={() => navigate(blocking ? `/projects/${project.id}/export/repair` : `/projects/${project.id}/export/download`)}
          />
        }
      >
        <table className="table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Result</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {v.checks.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>
                  <Outcome outcome={c.outcome} />
                </td>
                <td className="sm muted">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Notice tone="accent" title="What this result is and is not">
          <p style={{ margin: 0 }}>
            <Wording
              ordinary="It says this model passed the checks nova3D can run for the printer and material you chose. It is not a promise the print will work, not a statement that the object is structurally sound, and not a claim that it will print on any other machine."
              technical="Validated against the named Target Print Profile. Not a certification of safety, structural adequacy, or universal manufacturability, and not transferable to another profile."
            />
          </p>
        </Notice>

        <div className="row gap-2 wrap">
          <Link to={`/projects/${project.id}/export/repair`} className="btn btn-secondary">
            Repair history
          </Link>
          <Link to={`/projects/${project.id}/export/regenerate`} className="btn btn-secondary">
            Regeneration fallback
          </Link>
        </div>
      </StepShell>
    </div>
  )
}

export function RepairView() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const navigate = useNavigate()
  const action = useAction()

  if (!project) return <NotFound />

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Validate', to: `/projects/${project.id}/export` }, { label: 'Repair' }]} />
      <StepShell
        steps={steps(3)}
        question="Automatic repair"
        intro="Repair fixes geometry faults. It never changes a dimension, a proportion or a Model Feature."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/export/validate`)}
            consequence="A repair that changes visible geometry creates a new Version and re-gates it."
            primary={action.pending ? 'Repairing…' : project.repairs.length ? 'Continue' : 'Run repair'}
            onPrimary={async () => {
              if (project.repairs.length) {
                navigate(`/projects/${project.id}/export/download`)
                return
              }
              await action.run(() => api.exports.repair(project.id))
            }}
          />
        }
      >
        {project.repairs.length === 0 && <p className="sm muted">No repair has been run for this Version.</p>}

        {project.repairs.map((r) => (
          <section key={r.id} className="stack gap-2" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="rail-label">{r.failed ? 'Not repaired' : 'Repaired'}</div>
            <KeyValue
              rows={[
                { k: 'Detected', v: r.detected },
                { k: 'Done', v: r.failed ?? r.repaired },
                { k: 'Before', v: <Value of={r.before} as="span" /> },
                { k: 'After', v: <Value of={r.after} as="span" /> },
              ]}
            />
            {r.substantive && !r.failed && (
              <Notice tone="warn" glyph="▲">
                This repair changed visible geometry, so it created a new Version and Model Approval has to
                be given again. A repair that changes what you can see is not a silent fix.
              </Notice>
            )}
            {r.failed && (
              <Notice tone="warn" glyph="▲" title="Why it failed">
                <p style={{ margin: '0 0 var(--space-2)' }}>{r.failed}</p>
                <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
                  <li>Every Version is preserved. Nothing was lost.</li>
                  <li>Nothing was charged.</li>
                  <li>Nothing retries by itself. This waits for you.</li>
                </ul>
              </Notice>
            )}
          </section>
        ))}

        <Notice title="What repair did not touch">
          No dimension, no proportion and no Model Feature changed.
        </Notice>
      </StepShell>
    </div>
  )
}

export function RegenerationFallback() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const navigate = useNavigate()
  const [stopped, setStopped] = useState(false)

  if (!project) return <NotFound />

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Validate', to: `/projects/${project.id}/export` }, { label: 'Regenerate' }]} />
      <StepShell
        steps={steps(3)}
        question={stopped ? 'nova3D has stopped trying' : 'Regenerate from the approved Plan'}
        intro={stopped ? undefined : 'One attempt, from the Plan you already approved. Not a loop.'}
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/export/validate`)}
            consequence={stopped ? 'Every Version is preserved. Nothing was lost.' : 'This produces a new Version, which needs Model Approval again.'}
            primary={stopped ? 'Back to the model' : 'Regenerate once'}
            onPrimary={() => (stopped ? navigate(`/projects/${project.id}/model`) : setStopped(true))}
          />
        }
      >
        {stopped ? (
          <>
            <Notice tone="warn" glyph="▲" title="What remains">
              <p style={{ margin: '0 0 var(--space-2)' }}>
                The fault survived regeneration. nova3D has run its one attempt and will not run another by
                itself.
              </p>
              <p style={{ margin: 0 }}>
                It does not loop, because a loop would spend your time and your allowance on the same
                failure repeatedly without telling you anything new.
              </p>
            </Notice>
            <Notice title="What is preserved">
              <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
                <li>Every Version, including the one that fails validation.</li>
                <li>The approved Plan and every Claim in it.</li>
                <li>The full validation and repair history.</li>
              </ul>
            </Notice>
            <Notice tone="accent" title="What you can do">
              <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
                <li>
                  <Link to={`/projects/${project.id}/model/correct`}>Report the problem as a correction</Link>, which goes
                  back through the evidence.
                </li>
                <li>
                  <Link to={`/projects/${project.id}/export`}>Choose a different physical size</Link> — the fault may not
                  appear at another scale.
                </li>
                <li>Export anyway if the warning is not blocking.</li>
              </ul>
            </Notice>
          </>
        ) : (
          <Notice tone="accent" title="What regeneration does">
            <p style={{ margin: '0 0 var(--space-2)' }}>
              It builds the model again from the approved Plan, using the same evidence and the same
              decisions. It is not a second opinion and it will not find new evidence.
            </p>
            <p style={{ margin: 0 }}>
              It runs <strong>once</strong>. If the same fault survives, nova3D stops and says so.
            </p>
          </Notice>
        )}
      </StepShell>
    </div>
  )
}

export function Download() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const version = useCurrentVersion(project)
  const { profiles } = useWorkspace()
  const navigate = useNavigate()
  const [stl, setStl] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  if (!project || !version) return <NotFound />

  const blockers = api.exports.blockers(project)
  const profile = profiles.find((p) => p.id === project.targetProfileId)

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Validate', to: `/projects/${project.id}/export` }, { label: 'Download' }]} />
      <StepShell
        steps={steps(4)}
        question="Your download"
        intro={
          <>
            <Ltr>Version {version.number}</Ltr>
            {profile ? <>, validated against {profile.printerName}</> : null}.
          </>
        }
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/export/validate`)}
            consequence="The files are yours. nova3D is not needed to read them."
            primary={downloaded ? 'Downloaded' : 'Download'}
            blockedReason={blockers[0]}
            onPrimary={() => setDownloaded(true)}
          />
        }
      >
        {blockers.length > 0 && (
          <Notice tone="warn" glyph="▲" title="Export is blocked">
            <ul style={{ margin: '0 0 var(--space-2)', paddingInlineStart: '1.2em' }}>
              {blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <p style={{ margin: 0 }}>
              Export is gated exactly as printing is. Neither gate is softened because the file is only
              being downloaded.
            </p>
          </Notice>
        )}

        <section className="stack gap-3">
          <div className="list-row">
            <span className="stack gap-1 grow">
              <strong>
                <Ltr>3MF</Ltr> — the print-ready file
              </strong>
              <span className="caption muted">
                The primary file. Carries the geometry and the print settings together.{' '}
                <Value of={api.PENDING} as="span" />
              </span>
            </span>
            <span className="tag tag-accent">always included</span>
          </div>

          <label className="list-row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={stl} onChange={() => setStl(!stl)} style={{ marginTop: 6 }} />
            <span className="stack gap-1 grow">
              <strong>
                <Ltr>STL</Ltr> — a compatibility copy
              </strong>
              <span className="caption muted">
                For older software that cannot read 3MF. Geometry only — it carries none of the print
                settings. <Value of={api.PENDING} as="span" />
              </span>
            </span>
          </label>

          <div className="list-row">
            <span className="stack gap-1 grow">
              <strong>
                <Ltr>PDF</Ltr> — the Source Record
              </strong>
              <span className="caption muted">
                The Project, the Plan, every Consequential Detail, Claim, Source, piece of reasoning,
                option, approval, Personalization, Version, print profile, validation and repair — with
                stable identifiers, so a Claim can be traced to a Model Feature and back.{' '}
                <Value of={api.PENDING} as="span" />
              </span>
            </span>
            <span className="tag tag-accent">always included</span>
          </div>
        </section>

        <Notice tone="accent" title="Why the Source Record is the point">
          The 3MF is a shape. The Source Record is what makes that shape defensible away from nova3D —
          readable by someone who has never used it, months from now, without access to your Account.
        </Notice>

        {downloaded && (
          <Notice tone="accent" glyph="✓" title="Downloaded">
            The files are in your downloads. Printing is still available here if you would rather nova3D
            printed it: <Link to={`/projects/${project.id}/print`}>go to printing</Link>.
          </Notice>
        )}

        <StatedAbsence>
          On a phone these go to your files rather than opening. Large models take a moment to write, and
          the Source Record opens in whatever reads PDFs on that device.
        </StatedAbsence>
      </StepShell>
    </div>
  )
}
