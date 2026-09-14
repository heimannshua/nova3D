import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import * as api from '@/api'
import { useProject, useProjectJobs, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { PageHeader } from '@/components/layout/shells'
import { Btn, Dialog, KeyValue, Ltr, Notice, Value } from '@/components/ui/primitives'
import { StatusToken } from '@/components/nova3d/status'
import { JobStrip } from '@/components/nova3d/work'
import { AccuracyClaim, Breadcrumbs } from './ProjectNav'
import { NotFound } from '@/features/errors'

const STAGE_LABEL: Record<string, string> = {
  researching: 'Researching',
  'plan-review': 'Plan waiting to be read',
  generating: 'Generating',
  'model-review': 'Model waiting to be inspected',
  approved: 'Approved',
  printing: 'Printing',
}

export function ProjectsList() {
  const { projects } = useWorkspace()

  return (
    <div className="page page-wide">
      <PageHeader
        title="My Projects"
        meta="Every row says how accurate it claims to be. That claim never comes off."
        actions={
          <Link to="/create" className="btn btn-primary">
            Create something
          </Link>
        }
      />

      {projects.length === 0 ? (
        <Notice tone="accent" title="Nothing here yet">
          A Project begins either by describing what you want, or by photographing an object you have.
          Both end in a model you can inspect and print.
        </Notice>
      ) : (
        <div className="list">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="list-row list-row-link">
              <span className="stack gap-1 grow">
                <strong style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>{p.name}</strong>
                <span className="card-meta">
                  <Ltr>{p.createdAt.slice(0, 10)}</Ltr>
                  <span>·</span>
                  <span>{STAGE_LABEL[p.stage]}</span>
                  <span>·</span>
                  <span>
                    {p.versions.length} {p.versions.length === 1 ? 'Version' : 'Versions'}
                  </span>
                  {p.sync === 'device-only' && (
                    <>
                      <span>·</span>
                      <span>on this device only</span>
                    </>
                  )}
                  {p.sync === 'conflict' && (
                    <>
                      <span>·</span>
                      <span style={{ color: 'var(--color-accent-2-strong)' }}>needs a decision</span>
                    </>
                  )}
                </span>
                <AccuracyClaim project={p} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectOverview() {
  const { projectId } = useParams()
  const project = useProject(projectId)
  const jobs = useProjectJobs(projectId)
  const { auditEvents } = useWorkspace()
  const navigate = useNavigate()
  const action = useAction()
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  if (!project) return <NotFound />

  const version = api.models.current(project)
  const nextStep = (() => {
    if (project.stage === 'researching') return { label: 'Watch the research', to: '/jobs' }
    if (project.stage === 'plan-review') return { label: 'Read the Research Plan', to: `/projects/${project.id}/plan` }
    if (project.stage === 'generating') return { label: 'Watch generation', to: '/jobs' }
    if (project.stage === 'model-review') return { label: 'Inspect the model', to: `/projects/${project.id}/model` }
    if (project.stage === 'approved') return { label: 'Validate and export', to: `/projects/${project.id}/export` }
    return { label: 'See the print', to: '/printers' }
  })()

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[]} />
      <PageHeader
        title={project.name}
        meta={
          <>
            <AccuracyClaim project={project} />
            <span>·</span>
            <span>{STAGE_LABEL[project.stage]}</span>
          </>
        }
        actions={
          <Link to={nextStep.to} className="btn btn-primary">
            {nextStep.label}
          </Link>
        }
      />

      {project.sync === 'conflict' && (
        <Notice tone="warn" glyph="▲" title="Two versions of this Project have been kept">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            It changed on this device while it was offline, and also changed elsewhere. nova3D has kept
            both and will not merge or overwrite either one.
          </p>
          <div className="row gap-2 wrap">
            <Btn
              variant="secondary"
              onClick={() => void action.run(() => api.projects.resolveSyncConflict(project.id, 'device'))}
            >
              Keep the version from this device
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => void action.run(() => api.projects.resolveSyncConflict(project.id, 'account'))}
            >
              Keep the version from your Account
            </Btn>
          </div>
        </Notice>
      )}

      {project.planApproval.state === 'rejected' && (
        <Notice tone="warn" glyph="▲" title="This Project is waiting on you">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            You rejected <Ltr>{project.planApproval.boundTo}</Ltr>: {project.planApproval.reason}
          </p>
          <p style={{ margin: 0 }}>
            Nothing has been built and nothing is running. Research restarts from your reason, not from
            the beginning.
          </p>
        </Notice>
      )}

      {project.scope && (
        <section className="stack gap-2">
          <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>What nova3D understood</h2>
          <KeyValue
            rows={[
              { k: 'Subject', v: project.scope.subject },
              { k: 'Scope', v: project.scope.scope },
              { k: 'Intended outcome', v: project.scope.outcome },
              ...(project.scope.personalization
                ? [{ k: 'Personalization', v: <><span aria-hidden="true">+ </span>{project.scope.personalization}</> }]
                : []),
            ]}
          />
        </section>
      )}

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Where it stands</h2>
        <KeyValue
          rows={[
            {
              k: 'Plan',
              v: project.plan ? (
                <>
                  <Ltr>Revision {project.plan.revision}</Ltr> · {project.planApproval.state}
                </>
              ) : (
                'No Research Plan — nothing was researched.'
              ),
            },
            {
              k: 'Current Version',
              v: version ? <Ltr>Version {version.number}</Ltr> : 'None generated yet',
            },
            {
              k: 'Model Approval',
              v: version ? version.approval.state : '—',
            },
            {
              k: 'Validation',
              v: project.validation
                ? `${project.validation.outcome} against the named profile`
                : 'Not validated',
            },
            { k: 'Sources used', v: `${project.sources.filter((s) => !s.rejected).length} accepted, ${project.sources.filter((s) => s.rejected).length} rejected for this Project` },
          ]}
        />
      </section>

      {jobs.length > 0 && (
        <section className="stack gap-3">
          <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Work on this Project</h2>
          {jobs.map((j) => (
            <JobStrip key={j.id} job={j} projectName={project.name} href={`/jobs/${j.id}`} />
          ))}
        </section>
      )}

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>History</h2>
        <table className="table">
          <tbody>
            {auditEvents.slice(0, 8).map((e) => (
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
      </section>

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Delete this Project</h2>
        <p className="sm muted" style={{ margin: 0 }}>
          Immediate, and it cannot be undone. Export first if you want to keep anything.
        </p>
        <Btn variant="danger" onClick={() => setConfirming(true)} style={{ alignSelf: 'flex-start' }}>
          Delete this Project
        </Btn>
      </section>

      {confirming && (
        <Dialog
          title={`Delete ${project.name}?`}
          actions={
            <>
              <Btn variant="secondary" onClick={() => setConfirming(false)}>
                Keep it
              </Btn>
              <Btn
                variant="danger"
                disabled={typed !== project.name || action.pending}
                onClick={async () => {
                  const ok = await action.run(() => api.projects.remove(project.id))
                  if (ok) navigate('/projects', { replace: true })
                }}
              >
                Delete it
              </Btn>
            </>
          }
        >
          <div className="stack gap-3">
            <div>
              <strong>What is removed</strong>
              <ul style={{ margin: 'var(--space-1) 0 0', paddingInlineStart: '1.2em' }}>
                <li>This Project, its Plan, every Version and its Source Record.</li>
                <li>Its approvals, decisions, corrections and validation history.</li>
                <li>Its Print Records.</li>
              </ul>
            </div>
            <div>
              <strong>What is retained, and why</strong>
              <p style={{ margin: 'var(--space-1) 0 0' }}>
                Research derived from public Sources may remain in a shared cache — the retrieval date,
                the passage identity, the Source edition. It contains nothing of yours: not your
                identity, not your Project names, not your inputs, not your decisions.
              </p>
            </div>
            {action.error && (
              <p className="sm" style={{ margin: 0, color: 'var(--color-accent-2-strong)' }}>
                <span aria-hidden="true">▲ </span>
                {action.error}
              </p>
            )}
            <label className="stack gap-1">
              <span className="rail-label">Type the Project name to confirm</span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={project.name} />
            </label>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const { projects, claims, sources } = useWorkspace()
  const needle = q.trim().toLowerCase()

  const matchedProjects = needle ? projects.filter((p) => p.name.toLowerCase().includes(needle)) : []
  const matchedClaims = needle ? claims.filter((c) => c.statement.toLowerCase().includes(needle)) : []
  const matchedSources = needle ? sources.filter((s) => s.retrieved.includes(needle)) : []
  const none = needle.length > 0 && !matchedProjects.length && !matchedClaims.length && !matchedSources.length

  return (
    <div className="page page-wide">
      <PageHeader title="Search" meta="Reaches Claims and Sources, not just Project names." />
      <input
        className="input"
        style={{ maxWidth: 460 }}
        value={q}
        placeholder="ramp, altar, a retrieval date…"
        aria-label="Search"
        onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {})}
      />

      {none && (
        <Notice title="Nothing matched">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            No Project, Claim or Source in your Workspace matches that.
          </p>
          <p style={{ margin: 0 }}>
            Search only reaches your own Workspace. It does not search the internet, and it does not
            search other Accounts.
          </p>
        </Notice>
      )}

      {matchedProjects.length > 0 && (
        <section className="stack gap-2">
          <div className="rail-label">Projects</div>
          {matchedProjects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="list-row list-row-link">
              <strong>{p.name}</strong>
            </Link>
          ))}
        </section>
      )}

      {matchedClaims.length > 0 && (
        <section className="stack gap-2">
          <div className="rail-label">Claims</div>
          {matchedClaims.map((c) => (
            <div key={c.id} className="list-row">
              <span className="stack gap-1">
                <span>{c.statement}</span>
                <StatusToken status={c.status} />
              </span>
            </div>
          ))}
        </section>
      )}

      {matchedSources.length > 0 && (
        <section className="stack gap-2">
          <div className="rail-label">Sources</div>
          {matchedSources.map((s) => (
            <div key={s.id} className="list-row">
              <span className="stack gap-1">
                <Value of={s.title} kind="content" />
                <span className="caption muted">
                  retrieved <Ltr>{s.retrieved}</Ltr>
                </span>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
