import { isPending, type EvidenceCollision, type Printer, type ProblemDetection, type Spool } from '@/api'
import { Btn, Notice, StatedAbsence, Value } from '../ui/primitives'

/**
 * Camera presence and Watching are TWO SEPARATE STATED ROWS (NFR-14).
 *
 * A live view never implies anything is being checked, and a printer with no
 * camera says so in a dashed block with the consequence spelled out. Silence is
 * never allowed to imply monitoring.
 */
export function PrinterControl({
  printer,
  running,
  onPause,
  onResume,
  onStop,
  pending,
}: {
  printer: Printer
  running: boolean
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  pending?: boolean
}) {
  return (
    <div className="printer-control">
      <div className="controls">
        <Btn variant="secondary" onClick={onPause} disabled={!running || pending}>
          Pause
        </Btn>
        <Btn variant="secondary" onClick={onResume} disabled={running || pending}>
          Resume
        </Btn>
        <Btn variant="danger" onClick={onStop} disabled={!running || pending}>
          Stop
        </Btn>
      </div>
      <p className="caption muted" style={{ margin: 0 }}>
        Stopping cannot be undone. The print ends where it is and the object cannot be continued from
        that point.
      </p>

      {/* Two separate facts. Never one row, never one toggle. */}
      {printer.hasCamera ? (
        <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-1)' }}>
          <div className="row gap-2">
            <dt className="sm" style={{ fontWeight: 600, minWidth: 160 }}>
              Camera
            </dt>
            <dd className="sm" style={{ margin: 0 }}>
              This printer has a camera and you can see it.
            </dd>
          </div>
          <div className="row gap-2">
            <dt className="sm" style={{ fontWeight: 600, minWidth: 160 }}>
              Watching
            </dt>
            <dd className="sm" style={{ margin: 0 }}>
              {printer.watching
                ? 'On. nova3D checks frames for a failing print and pauses if it sees one.'
                : 'Off. nova3D is not checking these frames. Seeing the print is not the same as it being watched.'}
            </dd>
          </div>
        </dl>
      ) : (
        <StatedAbsence>
          <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
            This printer has no camera, so it cannot be watched.
          </strong>
          nova3D will not know if this print starts to fail. It will report what the printer reports
          and nothing more.
        </StatedAbsence>
      )}

      {printer.hasCamera && printer.watching && (
        <p className="caption muted" style={{ margin: 0 }}>
          Frames are checked and discarded. Nothing is kept unless a problem is found.
        </p>
      )}

      {printer.controlLevel === 'cloud-limited' && (
        <Notice glyph="▲">
          This printer is reached through its maker account rather than directly, so some controls are
          not available. Which ones depends on the vendor integration, which is not settled yet
          (AD-8).
        </Notice>
      )}
    </div>
  )
}

/**
 * Colour and type read from each spool tag, shown as a swatch PLUS its name —
 * the swatch alone would be a colour-only signal. A spool that cannot be read
 * says so and is not checked against the slice rather than being guessed (AD-11).
 */
export function SpoolRow({ spool }: { spool: Spool }) {
  return (
    <div className="row gap-3" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-divider)' }}>
      <span className="caption muted" style={{ minWidth: 48 }}>
        Slot {spool.slot}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          flex: 'none',
          border: '1px solid var(--color-divider)',
          background: isPending(spool.colorHex) ? 'var(--color-neutral-300)' : (spool.colorHex as string),
        }}
      />
      <span className="stack grow">
        <span className="sm">
          <Value of={spool.colorName} kind="content" as="span" />
        </span>
        <span className="caption muted">
          <Value of={spool.material} kind="content" as="span" />
        </span>
      </span>
      {!spool.readable && (
        <span className="caption" style={{ color: 'var(--color-accent-2-strong)', maxWidth: 260 }}>
          <span aria-hidden="true">▲ </span>
          This spool's tag could not be read. nova3D will not check it against the slice rather than
          guess what is loaded.
        </span>
      )}
    </div>
  )
}

/**
 * Where printability and an evidence-backed dimension collide, nova3D asks every
 * time. NEITHER OPTION IS PRESELECTED, each states its cost to the reconstruction
 * and to the print, and the decision is recorded in the Source Record.
 *
 * NFR-13 makes a violation of this a correctness defect, not a usability one, so
 * this component takes no `defaultValue` and offers no "recommended" styling.
 */
export function EvidenceCollisionPrompt({
  collision,
  chosen,
  onChoose,
  pending,
}: {
  collision: EvidenceCollision
  /** Undefined until the user decides. There is no default and no recommendation. */
  chosen?: 'evidence' | 'printability'
  onChoose: (which: 'evidence' | 'printability') => void
  pending?: boolean
}) {
  return (
    <section className="stack gap-4">
      <Notice tone="warn" glyph="▲" title="This one needs your decision">
        {collision.description}
      </Notice>

      <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {(
          [
            ['evidence', collision.evidenceOption],
            ['printability', collision.printabilityOption],
          ] as const
        ).map(([key, opt]) => (
          <div key={key} className="card" data-chosen={chosen === key}>
            <div className="card-title">{opt.label}</div>
            <div className="sm">
              <strong>What it costs the reconstruction: </strong>
              {opt.costToReconstruction}
            </div>
            <div className="sm">
              <strong>What it costs the print: </strong>
              {opt.costToPrint}
            </div>
            <Btn variant={chosen === key ? 'primary' : 'secondary'} disabled={pending} onClick={() => onChoose(key)}>
              {chosen === key ? 'Chosen' : 'Choose this'}
            </Btn>
          </div>
        ))}
      </div>

      <p className="caption muted" style={{ margin: 0 }}>
        Neither option is preselected, and nova3D will not pick one for you. Whichever you choose is
        written into the Source Record, so a reader months from now can see that this was a decision
        and what it cost.
      </p>
    </section>
  )
}

/**
 * Four labelled blocks — what nova3D saw, why it happens, how to fix it now, and
 * what would prevent it next time — the frames it acted on as captioned evidence,
 * the sentence "nova3D can be wrong" directly above the exits, and three real
 * exits. A false alarm deletes the kept frames and says so (NFR-14).
 */
export function ProblemAlert({
  detection,
  onResume,
  onStop,
  onFalseAlarm,
  pending,
}: {
  detection: ProblemDetection
  onResume?: () => void
  onStop?: () => void
  onFalseAlarm?: () => void
  pending?: boolean
}) {
  return (
    <section className="problem-alert" aria-labelledby="problem-title">
      <header className="stack gap-1">
        <h3 id="problem-title" style={{ margin: 0 }}>
          <span aria-hidden="true">▲ </span>The print was paused
        </h3>
        <p className="sm" style={{ margin: 0 }}>
          Paused automatically at layer <Value of={detection.atLayer} as="span" />. The printer is
          holding, not stopped.
        </p>
      </header>

      <div className="blocks">
        <Block title="What nova3D saw">{detection.whatWeSaw}</Block>
        <Block title="Why this happens">{detection.whyItHappens}</Block>
        <Block title="How to fix it now">{detection.howToFixNow}</Block>
        <Block title="What would prevent it next time">{detection.whatWouldPreventIt}</Block>
      </div>

      <div className="stack gap-2">
        <div className="rail-label">The frames nova3D acted on</div>
        <div className="frame-evidence">
          {detection.frames.map((f) => (
            <figure key={f.id}>
              <div className="plate halftone">
                <span className="caption muted">camera frame</span>
              </div>
              <figcaption>{f.caption}</figcaption>
            </figure>
          ))}
        </div>
        <p className="caption muted" style={{ margin: 0 }}>
          These frames are kept only while this alert is open. Marking it a false alarm deletes them.
        </p>
      </div>

      <p className="can-be-wrong" style={{ margin: 0 }}>
        nova3D can be wrong. Look at the print before you decide.
      </p>

      <div className="exits">
        <Btn variant="primary" disabled={pending} onClick={onResume}>
          I fixed it — resume
        </Btn>
        <Btn variant="danger" disabled={pending} onClick={onStop}>
          Stop the print
        </Btn>
        <Btn variant="secondary" disabled={pending} onClick={onFalseAlarm}>
          False alarm — nothing is wrong
        </Btn>
      </div>

      <p className="caption muted" style={{ margin: 0 }}>
        The model, its Version and its Source Record are not affected by anything that happens to a
        print.
      </p>
    </section>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stack gap-1">
      <div className="rail-label">{title}</div>
      <p className="sm" style={{ margin: 0 }}>
        {children}
      </p>
    </div>
  )
}
