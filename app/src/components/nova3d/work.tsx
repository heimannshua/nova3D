import { Link } from 'react-router-dom'
import type { Job, PrintJob } from '@/api'
import { JobStateToken, PrintStateToken, StepBlocks } from './status'
import { Btn, Ltr, Value } from '../ui/primitives'

const KIND_LABEL: Record<Job['kind'], string> = {
  research: 'Research',
  generation: 'Generation',
  validation: 'Validation',
  repair: 'Repair',
  slice: 'Slice',
  print: 'Print',
}

/**
 * Every strip carries stage, real recorded progress, cost impact when known, and
 * cancel where cancel is legal.
 *
 * A failed strip answers the same six questions in the same order, every time —
 * failed stage, known cause, what was preserved, cost impact, what needs
 * re-approval, and that nothing retries by itself (NFR-8).
 */
export function JobStrip({
  job,
  projectName,
  href,
  onCancel,
}: {
  job: Job
  projectName: string
  /** In-app route this Job opens. A strip without one is a leaf. */
  href?: string
  onCancel?: () => void
}) {
  return (
    <article className="job-strip" data-state={job.state}>
      <div className="row gap-3 wrap">
        <JobStateToken state={job.state} />
        <strong style={{ fontFamily: 'var(--font-heading)' }}>{KIND_LABEL[job.kind]}</strong>
        <span className="sm muted grow">{projectName}</span>
        {job.cancellable && job.state === 'running' && (
          <Btn variant="secondary" onClick={onCancel}>
            Cancel
          </Btn>
        )}
        {href && (
          <Link to={href} className="btn btn-ghost">
            Open
          </Link>
        )}
      </div>

      <div className="sm">{job.stage}</div>

      {job.state === 'running' && <StepBlocks done={job.progress?.done} total={job.progress?.total} />}

      {job.cost && (
        <div className="caption muted">
          Reserved <Value of={job.cost.reserved} as="span" />
          {job.cost.settled !== undefined && (
            <>
              {' · settled to '}
              <Value of={job.cost.settled} as="span" />
            </>
          )}
          {job.cost.released && ' · the reservation was released and nothing was charged'}
        </div>
      )}

      {job.failure && (
        <div className="notice notice-warn">
          <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-1)' }}>
            <Row k="What failed" v={job.failure.failedStage} />
            <Row k="Known cause" v={job.failure.knownCause} />
            <Row k="What was preserved" v={job.failure.preserved} />
            <Row k="Cost" v={job.failure.costImpact} />
            <Row k="Needs re-approval" v={job.failure.needsReapproval} />
            <Row k="Will it retry" v="No. Nothing retries by itself. This waits for your decision." />
          </dl>
        </div>
      )}

      {job.state === 'running' && (
        <p className="caption muted" style={{ margin: 0 }}>
          You can leave this page. The work continues and a Notification arrives when it finishes.
        </p>
      )}
    </article>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt style={{ display: 'inline', fontWeight: 600 }}>{k}: </dt>
      <dd style={{ display: 'inline', margin: 0 }}>{v}</dd>
    </div>
  )
}

/**
 * Progress is reported layers plus step blocks, always labelled as reported by
 * the printer rather than as nova3D's own certainty (NFR-11).
 *
 * A running job carries Stop at 44px on the strip itself — a control that stops a
 * physical machine should not be two screens away.
 */
export function PrintJobStrip({
  printJob,
  printerName,
  projectName,
  versionLabel,
  onStop,
  href,
}: {
  printJob: PrintJob
  printerName: string
  projectName: string
  versionLabel: string
  onStop?: () => void
  href?: string
}) {
  return (
    <article className="job-strip" data-state={printJob.state}>
      <div className="row gap-3 wrap">
        <PrintStateToken state={printJob.state} />
        <strong style={{ fontFamily: 'var(--font-heading)' }}>{projectName}</strong>
        <span className="sm muted">
          <Ltr>{versionLabel}</Ltr> on {printerName}
        </span>
        <span className="grow" />
        {(printJob.state === 'printing' || printJob.state === 'paused') && onStop && (
          <Btn variant="secondary" onClick={onStop}>
            Stop
          </Btn>
        )}
        {href && (
          <Link to={href} className="btn btn-ghost">
            Open
          </Link>
        )}
      </div>

      {(printJob.state === 'printing' || printJob.state === 'paused') && (
        <>
          <div className="row gap-3 wrap">
            <StepBlocks done={printJob.reportedLayer?.done} total={printJob.reportedLayer?.total} />
            <span className="caption muted">
              remaining <Value of={printJob.reportedRemaining} as="span" />
            </span>
          </div>
          <p className="caption muted" style={{ margin: 0 }}>
            Layers and time as reported by the printer, not as nova3D's own measurement.
          </p>
        </>
      )}

      {printJob.failure && (
        <div className="notice notice-warn">
          <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-1)' }}>
            <Row k="The printer reported" v={printJob.failure.printerReportedReason} />
            <div>
              <dt style={{ display: 'inline', fontWeight: 600 }}>Stopped at layer: </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                <Value of={printJob.failure.stoppedAtLayer} as="span" />
              </dd>
            </div>
            <div>
              <dt style={{ display: 'inline', fontWeight: 600 }}>Material used: </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                <Value of={printJob.failure.materialUsed} as="span" />
              </dd>
            </div>
            <Row k="The model" v="Unchanged. The Version and its Source Record are exactly as they were." />
            <Row k="The print file" v="Kept. You can send it again without slicing again." />
            <Row k="Will it retry" v="No. Nothing retries by itself." />
          </dl>
        </div>
      )}
    </article>
  )
}
