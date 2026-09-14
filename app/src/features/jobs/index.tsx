import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '@/api'
import { useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { PageHeader } from '@/components/layout/shells'
import { JobStrip } from '@/components/nova3d/work'
import { SourceRow } from '@/components/nova3d/evidence'
import { StepBlocks } from '@/components/nova3d/status'
import { Btn, KeyValue, Ltr, Notice } from '@/components/ui/primitives'
import { NotFound } from '@/features/errors'

export function JobsList() {
  const { jobs, projects } = useWorkspace()
  const action = useAction()

  return (
    <div className="page page-wide">
      <PageHeader
        title="In Progress"
        meta="Six kinds of work. Each row offers only the actions that are legal for it, and no Job blocks you from using the rest of nova3D."
      />

      {jobs.length === 0 ? (
        <Notice tone="accent" title="Nothing is running">
          When research, generation, validation, repair, slicing or printing is running, it appears here —
          and you can leave the page without stopping it.
        </Notice>
      ) : (
        <div className="stack gap-3">
          {jobs.map((j) => (
            <JobStrip
              key={j.id}
              job={j}
              projectName={projects.find((p) => p.id === j.projectId)?.name ?? ''}
              href={`/jobs/${j.id}`}
              onCancel={() => void action.run(() => api.jobs.cancel(j.id))}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function JobDetail() {
  const { jobId } = useParams()
  const { jobs, projects, sources } = useWorkspace()
  const navigate = useNavigate()
  const action = useAction()
  const job = jobs.find((j) => j.id === jobId)

  if (!job) return <NotFound />

  const project = projects.find((p) => p.id === job.projectId)
  const liveSources = (job.liveSourceIds ?? [])
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  return (
    <div className="page page-wide">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/jobs">In Progress</Link>
        <span aria-hidden="true">/</span>
        <span className="muted">{job.kind}</span>
      </nav>

      <PageHeader
        title={`${job.kind[0].toUpperCase()}${job.kind.slice(1)} Job`}
        meta={
          <>
            <span>{project?.name}</span>
            <span>·</span>
            <span>
              started <Ltr>{job.startedAt.slice(0, 16).replace('T', ' ')}</Ltr>
            </span>
          </>
        }
        actions={
          project ? (
            <Link to={`/projects/${project.id}`} className="btn btn-secondary">
              Open the Project
            </Link>
          ) : undefined
        }
      />

      <JobStrip
        job={job}
        projectName={project?.name ?? ''}
        onCancel={() => void action.run(() => api.jobs.cancel(job.id))}
      />

      <section className="stack gap-2">
        <div className="rail-label">Where it is</div>
        <KeyValue
          rows={[
            { k: 'Stage', v: job.stage },
            {
              k: 'Progress',
              v: <StepBlocks done={job.progress?.done} total={job.progress?.total} />,
            },
            ...(job.finishedAt ? [{ k: 'Finished', v: <Ltr>{job.finishedAt.slice(0, 16).replace('T', ' ')}</Ltr> }] : []),
          ]}
        />
      </section>

      {/* Live Source activity — the Sources nova3D actually opened, and what it is
          doing with each. Not a narration of hidden reasoning (FR-8). */}
      {job.kind === 'research' && job.state === 'running' && (
        <section className="stack gap-3">
          <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Sources this research is using right now</h2>
          <p className="sm muted" style={{ margin: 0 }}>
            The Job keeps running while you read. Rejecting a Source removes it from this Job and from this
            Project&rsquo;s evidence, and nova3D looks for replacement evidence automatically.
          </p>
          {liveSources.length === 0 ? (
            <p className="sm muted" style={{ margin: 0 }}>
              No Source is open at this moment.
            </p>
          ) : (
            liveSources.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                projectEntry={project?.sources.find((ps) => ps.sourceId === s.id)}
                showRole
                onRead={() => {}}
                onReject={() =>
                  project &&
                  void action.run(() => api.plans.rejectSource(project.id, s.id, 'Rejected while research was running.'))
                }
              />
            ))
          )}
          <Notice title="What rejecting one sets off">
            <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
              <li>It is out of this Project&rsquo;s evidence — not hidden, removed.</li>
              <li>Claims that leaned on it are invalidated and visibly rechecked.</li>
              <li>This Job looks for replacement evidence. It does not stop.</li>
              <li>
                This is scoped to this Project only. That Source stays available to every other Project
                unless you switch it off <Link to="/settings/sources">Account-wide</Link>, which is a
                different control.
              </li>
            </ul>
          </Notice>
        </section>
      )}

      {job.state === 'running' && (
        <div className="row gap-2 wrap">
          <Btn variant="secondary" onClick={() => navigate(-1)}>
            Leave — it keeps running
          </Btn>
        </div>
      )}
    </div>
  )
}
