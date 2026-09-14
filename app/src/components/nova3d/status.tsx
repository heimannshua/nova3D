import type { DetailStatus, JobState, PrintState, SourceRole } from '@/api'

/**
 * Detail Status: a glyph, a word, and only then a colour.
 * Never colour alone. Never an icon alone. Screen readers get the word (NFR-18).
 */
const STATUS: Record<DetailStatus, { glyph: string; word: string }> = {
  sourced: { glyph: '●', word: 'sourced' },
  inferred: { glyph: '○', word: 'inferred' },
  disputed: { glyph: '◐', word: 'disputed' },
  unknown: { glyph: '?', word: 'unknown' },
  'user-added': { glyph: '+', word: 'user-added' },
}

export function StatusToken({ status }: { status: DetailStatus }) {
  const s = STATUS[status]
  return (
    <span className="status-token" data-status={status}>
      <span className="glyph" aria-hidden="true">
        {s.glyph}
      </span>
      <span>{s.word}</span>
    </span>
  )
}

export function StatusLegend() {
  return (
    <div className="stack gap-2">
      {(Object.keys(STATUS) as DetailStatus[]).map((s) => (
        <div key={s} className="row gap-3">
          <span style={{ minWidth: 130 }}>
            <StatusToken status={s} />
          </span>
          <span className="sm muted">{LEGEND[s]}</span>
        </div>
      ))}
    </div>
  )
}

const LEGEND: Record<DetailStatus, string> = {
  sourced: 'A Source says this directly. The passage is attached.',
  inferred: 'No Source says it, but it follows from ones that do. The reasoning is shown in full.',
  disputed: 'Sources disagree. Both readings are shown and you decide — nova3D does not.',
  unknown: 'No Source examined answers this. It is left unknown rather than filled in.',
  'user-added': 'You asked for this. It is not a claim about the historical object.',
}

/**
 * Research lead versus accepted evidence is a DIFFERENT axis from Detail Status,
 * so it takes words rather than glyphs — otherwise two unrelated meanings would
 * share one visual language (DESIGN.md, status-token).
 */
export function SourceRoleLabel({ role }: { role: SourceRole }) {
  return (
    <span className="sm muted">{role === 'lead' ? 'lead — not yet evidence' : 'accepted evidence'}</span>
  )
}

const JOB_STATE: Record<JobState, { glyph: string; word: string }> = {
  running: { glyph: '▶', word: 'running' },
  waiting: { glyph: '◷', word: 'waiting' },
  completed: { glyph: '✓', word: 'completed' },
  failed: { glyph: '▲', word: 'failed' },
  cancelled: { glyph: '⊘', word: 'cancelled' },
}

const PRINT_STATE: Record<PrintState, { glyph: string; word: string }> = {
  printing: { glyph: '▶', word: 'printing' },
  paused: { glyph: '❙❙', word: 'paused' },
  queued: { glyph: '◷', word: 'queued' },
  finished: { glyph: '✓', word: 'finished' },
  failed: { glyph: '▲', word: 'failed' },
  stopped: { glyph: '⊘', word: 'stopped' },
}

export function JobStateToken({ state }: { state: JobState }) {
  const s = JOB_STATE[state]
  return (
    <span className="job-state" data-state={state}>
      <span aria-hidden="true">{s.glyph}</span>
      <span>{s.word}</span>
    </span>
  )
}

export function PrintStateToken({ state }: { state: PrintState }) {
  const s = PRINT_STATE[state]
  return (
    <span className="job-state" data-state={state}>
      <span aria-hidden="true">{s.glyph}</span>
      <span>{s.word}</span>
    </span>
  )
}

/**
 * Progress is countable blocks, never a continuous bar.
 * Work whose progress is unknown gets the word "working" and NO blocks at all —
 * a bar with no information behind it is a fabricated claim about progress.
 */
export function StepBlocks({ done, total }: { done?: number; total?: number }) {
  if (done === undefined || total === undefined) {
    return <span className="sm muted">working</span>
  }
  return (
    <span className="row gap-2">
      <span className="step-blocks" role="img" aria-label={`${done} of ${total} stages done`}>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} data-on={i < done} />
        ))}
      </span>
      <span className="caption muted">
        {done} of {total}
      </span>
    </span>
  )
}
