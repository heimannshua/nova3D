/**
 * Printers and prints.
 *
 * The camera honesty rule lives here: camera presence and Watching are two
 * separate stated rows, a printer without a camera says it cannot be watched,
 * and every automatic pause shows the frames it acted on and offers three real
 * exits — resume, stop, and false alarm (NFR-14).
 */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '@/api'
import { usePrintJob, usePrinter, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { PageHeader } from '@/components/layout/shells'
import { PrintJobStrip } from '@/components/nova3d/work'
import { PrinterControl, ProblemAlert, SpoolRow } from '@/components/nova3d/printing'
import { PrintStateToken } from '@/components/nova3d/status'
import { Btn, KeyValue, Ltr, Notice, StatedAbsence, Value, ViewportPlaceholder } from '@/components/ui/primitives'
import { NotFound } from '@/features/errors'

export function PrintersList() {
  const { printers: allPrinters, printJobs, projects, offline } = useWorkspace()
  const printers = allPrinters.filter((p) => p.linked)
  const live = printJobs.filter((p) => p.state === 'printing' || p.state === 'paused' || p.state === 'queued')
  const action = useAction()

  return (
    <div className="page page-wide">
      <PageHeader
        title="Printers"
        meta="nova3D controls one job at a time on each machine. It is not a print farm and does not schedule across machines."
      />

      {offline && (
        <StatedAbsence>
          nova3D cannot reach any printer while you are offline, so it does not know what these machines
          are doing. The last thing it saw is not shown, because it would look current and it is not.
        </StatedAbsence>
      )}

      <section className="stack gap-3">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Machines</h2>
        {printers.map((p) => (
          <article key={p.id} className="card">
            <div className="row gap-3 wrap">
              <div className="stack gap-1 grow">
                <div className="card-title">{p.name}</div>
                <div className="card-meta">
                  <span>{p.online && !offline ? `● ${p.state}` : '⊘ not reachable'}</span>
                  <span>·</span>
                  <span>
                    {p.hasCamera ? (p.watching ? 'camera, watching on' : 'camera, watching off') : 'no camera'}
                  </span>
                </div>
                {!p.hasCamera && (
                  <div className="caption muted">
                    <span aria-hidden="true">⊘ </span>
                    This printer cannot be watched. nova3D will report what it reports and nothing more.
                  </div>
                )}
              </div>
              <Link
                to={`/printers/${p.id}`}
                className="btn btn-secondary"
                aria-disabled={!p.online || offline}
                onClick={(e) => (!p.online || offline) && e.preventDefault()}
              >
                Control
              </Link>
            </div>
          </article>
        ))}
      </section>

      <section className="stack gap-3">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Running now</h2>
        {live.length === 0 ? (
          <p className="sm muted" style={{ margin: 0 }}>
            Nothing is printing. A queued job never starts by itself — nova3D asks before each one.
          </p>
        ) : (
          live.map((pj) => (
            <PrintJobStrip
              key={pj.id}
              printJob={pj}
              printerName={printers.find((p) => p.id === pj.printerId)?.name ?? ''}
              projectName={projects.find((p) => p.id === pj.projectId)?.name ?? ''}
              versionLabel={`Version ${projects.find((p) => p.id === pj.projectId)?.versions.find((v) => v.id === pj.versionId)?.number ?? '—'}`}
              href={`/prints/${pj.id}`}
              onStop={() => void action.run(() => api.prints.control(pj.id, 'stop'))}
            />
          ))
        )}
      </section>

      <Link to="/prints/history" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
        Print history and reprinting
      </Link>
    </div>
  )
}

export function PrinterDetail() {
  const { printerId } = useParams()
  const printer = usePrinter(printerId)
  const { printJobs, projects } = useWorkspace()
  const action = useAction()
  const [tab, setTab] = useState<'control' | 'machine' | 'upkeep'>('control')

  if (!printer) return <NotFound />

  const activeJob = printJobs.find(
    (p) => p.printerId === printer.id && (p.state === 'printing' || p.state === 'paused'),
  )
  const running = activeJob?.state === 'printing'

  return (
    <div className="page page-wide">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/printers">Printers</Link>
        <span aria-hidden="true">/</span>
        <span className="muted">{printer.name}</span>
      </nav>

      <PageHeader
        title={printer.name}
        meta={
          <>
            <span>{printer.state}</span>
            <span>·</span>
            <span>
              {printer.discovery === 'network'
                ? 'found on your network'
                : printer.discovery === 'maker-account'
                  ? 'found through your maker account'
                  : 'added by hand'}
            </span>
          </>
        }
      />

      <div className="seg" role="group" aria-label="Sections">
        {(['control', 'machine', 'upkeep'] as const).map((t) => (
          <button key={t} type="button" className="seg-opt" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'control' ? 'Print and camera' : t === 'machine' ? 'Machine' : 'Upkeep'}
          </button>
        ))}
      </div>

      {tab === 'control' && (
        <>
          {printer.hasCamera ? (
            <ViewportPlaceholder label="Live camera" note="What the camera sees. Seeing is not the same as watching." />
          ) : null}

          <PrinterControl
            printer={printer}
            running={Boolean(running)}
            pending={action.pending}
            onPause={() => activeJob && void action.run(() => api.prints.control(activeJob.id, 'pause'))}
            onResume={() => activeJob && void action.run(() => api.prints.control(activeJob.id, 'resume'))}
            onStop={() => activeJob && void action.run(() => api.prints.control(activeJob.id, 'stop'))}
          />

          {printer.hasCamera && (
            <div className="row gap-2 wrap">
              <Btn
                variant="secondary"
                disabled={action.pending}
                onClick={() => void action.run(() => api.prints.setWatching(printer.id, !printer.watching))}
              >
                {printer.watching ? 'Stop watching this printer' : 'Watch this printer'}
              </Btn>
              {activeJob && (
                <Btn variant="ghost" disabled={action.pending} onClick={() => void action.run(() => api.prints.simulateProblem(activeJob.id))}>
                  Simulate a detected problem
                </Btn>
              )}
            </div>
          )}

          {activeJob ? (
            <>
              <PrintJobStrip
                printJob={activeJob}
                printerName={printer.name}
                projectName={projects.find((p) => p.id === activeJob.projectId)?.name ?? ''}
                versionLabel={`Version ${projects.find((p) => p.id === activeJob.projectId)?.versions.find((v) => v.id === activeJob.versionId)?.number ?? '—'}`}
                href={`/prints/${activeJob.id}`}
              />
              <p className="caption muted" style={{ margin: 0 }}>
                Layers and time as reported by the printer, not as nova3D&rsquo;s own measurement.
              </p>
            </>
          ) : (
            <p className="sm muted">This machine is idle.</p>
          )}
        </>
      )}

      {tab === 'machine' && (
        <>
          <section className="stack gap-3">
            <div className="rail-label">Material</div>
            <div className="row gap-2 wrap">
              <Btn variant="secondary" disabled={Boolean(running)}>
                Load
              </Btn>
              <Btn variant="secondary" disabled={Boolean(running)}>
                Unload
              </Btn>
            </div>
            {printer.spools.map((s) => (
              <SpoolRow key={s.slot} spool={s} />
            ))}
            {printer.spools.length === 0 && <p className="sm muted">No spools reported.</p>}
          </section>

          <section className="stack gap-3">
            <div className="rail-label">Machine</div>
            <div className="row gap-2 wrap">
              {['Temperatures', 'Move the axes', 'Fans', 'Print speed', 'Level the plate', 'Calibrate', 'Clean the nozzle', 'Chamber light'].map(
                (c) => (
                  <Btn
                    key={c}
                    variant="secondary"
                    disabled={
                      printer.controlLevel !== 'full' ||
                      (Boolean(running) && c !== 'Chamber light' && c !== 'Fans' && c !== 'Print speed')
                    }
                  >
                    {c}
                  </Btn>
                ),
              )}
            </div>
            {running && (
              <Notice tone="warn" glyph="▲" title="Not while a print is running">
                Moving the axes, levelling the plate, calibrating and cleaning the nozzle would ruin the
                print that is running. Stop the print first if you need them — and stopping cannot be
                undone.
              </Notice>
            )}
            {printer.controlLevel !== 'full' && (
              <Notice glyph="▲">
                This printer is reached through its maker account rather than directly, so some controls
                are not available. Which ones depends on the vendor integration, which is not settled yet
                (AD-8).
              </Notice>
            )}
          </section>
        </>
      )}

      {tab === 'upkeep' && (
        <section className="stack gap-3">
          <p className="sm muted" style={{ margin: 0 }}>
            Worked out from what this machine has printed, not from a calendar.
          </p>
          {printer.upkeep.length === 0 ? (
            <p className="sm muted">Nothing recorded for this machine.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Due</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {printer.upkeep.map((u) => (
                  <tr key={u.item}>
                    <td>{u.item}</td>
                    <td className="sm">{u.due === 'not-yet' ? 'not yet' : u.due}</td>
                    <td className="sm muted">{u.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="caption muted" style={{ margin: 0 }}>
            Upkeep is advice about a machine. It is never a gate, and it never touches a model.
          </p>
        </section>
      )}
    </div>
  )
}

export function PrintDetail() {
  const { printJobId } = useParams()
  const printJob = usePrintJob(printJobId)
  const { printers, projects, detections, printRecords } = useWorkspace()
  const action = useAction()
  const navigate = useNavigate()

  if (!printJob) return <NotFound />

  const printer = printers.find((p) => p.id === printJob.printerId)
  const project = projects.find((p) => p.id === printJob.projectId)
  const version = project?.versions.find((v) => v.id === printJob.versionId)
  const detection = detections.find((d) => d.id === printJob.detectionId)
  const record = printRecords.find((r) => r.printJobId === printJob.id)

  return (
    <div className="page page-wide">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/printers">Printers</Link>
        <span aria-hidden="true">/</span>
        <span className="muted">Print</span>
      </nav>

      <PageHeader
        title={project?.name ?? 'Print'}
        meta={
          <>
            <PrintStateToken state={printJob.state} />
            <span>·</span>
            <span>
              <Ltr>Version {version?.number ?? '—'}</Ltr> on {printer?.name}
            </span>
          </>
        }
      />

      {detection && !detection.resolution && (
        <ProblemAlert
          detection={detection}
          pending={action.pending}
          onResume={() => void action.run(() => api.prints.resolveDetection(detection.id, 'resumed'))}
          onStop={() => void action.run(() => api.prints.resolveDetection(detection.id, 'stopped'))}
          onFalseAlarm={() => void action.run(() => api.prints.resolveDetection(detection.id, 'false-alarm'))}
        />
      )}

      {detection?.resolution === 'false-alarm' && (
        <Notice tone="accent" glyph="✓" title="The frames were deleted">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            The frames nova3D acted on have been deleted. Nothing from that alert is kept.
          </p>
          <p style={{ margin: 0 }}>
            The print is running again from where it paused. nova3D will be less eager about this shape,
            though it can still be wrong the other way — it may miss a real failure.
          </p>
        </Notice>
      )}

      <PrintJobStrip
        printJob={printJob}
        printerName={printer?.name ?? ''}
        projectName={project?.name ?? ''}
        versionLabel={`Version ${version?.number ?? '—'}`}
        onStop={() => void action.run(() => api.prints.control(printJob.id, 'stop'))}
      />

      {printJob.state === 'finished' && record && (
        <section className="stack gap-4">
          <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>The print finished</h2>

          <div className="stack gap-2">
            <div className="rail-label">What the machine reported</div>
            <KeyValue
              rows={[
                { k: 'Outcome', v: 'Finished all layers.' },
                { k: 'Material used', v: <Value of={record.materialUsed} as="span" /> },
              ]}
            />
          </div>

          <div className="stack gap-2">
            <div className="rail-label">What the camera saw</div>
            <p className="sm" style={{ margin: 0 }}>
              {record.cameraFindings.join(' ')} That is not the same as nothing having gone wrong.
            </p>
          </div>

          <div className="stack gap-3">
            <div className="rail-label">What only you can judge</div>
            <p className="sm" style={{ margin: 0 }}>
              nova3D cannot tell whether the object came out well. Look at it.
            </p>
            <div className="row gap-2 wrap">
              <Btn
                variant={record.userJudgement === 'good' ? 'primary' : 'secondary'}
                onClick={() => void action.run(() => api.prints.setJudgement(record.id, 'good'))}
              >
                It came out well
              </Btn>
              <Btn
                variant={record.userJudgement === 'not-good' ? 'primary' : 'secondary'}
                onClick={() => void action.run(() => api.prints.setJudgement(record.id, 'not-good'))}
              >
                It did not
              </Btn>
              <Btn variant="ghost" onClick={() => void action.run(() => api.prints.setJudgement(record.id, 'not-said'))}>
                I have not looked yet
              </Btn>
            </div>
          </div>
        </section>
      )}

      {printJob.state === 'failed' && (
        <section className="stack gap-3">
          <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Recovering this print</h2>
          <Notice glyph="◷" title="This is a chance, not a promise">
            Resuming from a layer works more often than not when the object never moved. It can still
            leave a visible line where the two halves meet, and it can fail outright. nova3D cannot tell
            which from here.
          </Notice>
          <div className="row gap-2 wrap">
            <Btn variant="secondary" disabled>
              Try resuming
            </Btn>
            <Btn variant="secondary" onClick={() => project && navigate(`/projects/${project.id}/print/send`)}>
              Start again from the first layer
            </Btn>
          </div>
          <p className="sm muted" style={{ margin: 0 }}>
            Resuming is unavailable here: the printer reported the print came loose, so there is nothing in
            the right place to build on. The model, its Version and its Source Record are unchanged, and
            the print file is kept.
          </p>
        </section>
      )}

      <section className="stack gap-2">
        <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Timelapse</h2>
        <ViewportPlaceholder label="Timelapse playback" note="Recorded frames. Not a live view." />
        <Notice tone="accent" title="Two different uses of the same camera">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            <strong>Watching</strong> checks frames for a failing print and throws them away. Nothing is
            kept unless a problem is found.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Timelapse</strong> keeps a recording on purpose, because you asked for one. Turning one
            on does not turn the other on.
          </p>
        </Notice>
      </section>
    </div>
  )
}

export function PrintHistory() {
  const { printRecords, projects, printJobs } = useWorkspace()
  const navigate = useNavigate()

  return (
    <div className="page page-wide">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/printers">Printers</Link>
        <span aria-hidden="true">/</span>
        <span className="muted">History</span>
      </nav>
      <PageHeader title="Print history" meta="Every print leaves a record attached to the Version it came from." />

      {printRecords.length === 0 ? (
        <p className="sm muted">Nothing has been printed yet.</p>
      ) : (
        <div className="stack gap-3">
          {printRecords.map((r) => {
            const project = projects.find((p) => p.id === r.projectId)
            const version = project?.versions.find((v) => v.id === r.versionId)
            const superseded = Boolean(version?.supersededBy)
            return (
              <article key={r.id} className="card">
                <div className="row gap-3 wrap">
                  <div className="stack gap-1 grow">
                    <div className="card-title">
                      {project?.name} · <Ltr>Version {version?.number ?? '—'}</Ltr> · {r.outcome}
                    </div>
                    <div className="card-meta">
                      <span>
                        material used <Value of={r.materialUsed} as="span" />
                      </span>
                      <span>·</span>
                      <span>{r.pauses.length} pauses</span>
                    </div>
                    {r.cameraFindings.map((c, i) => (
                      <div key={i} className="caption muted">
                        {c}
                      </div>
                    ))}
                    {r.userJudgement === 'not-said' && (
                      <div className="caption">
                        <span aria-hidden="true">? </span>
                        You have not said whether this one came out well. nova3D does not know.
                      </div>
                    )}
                    {superseded && (
                      <div className="caption" style={{ color: 'var(--color-accent-2-strong)' }}>
                        <span aria-hidden="true">▲ </span>
                        That Version has been superseded. Reprinting it is allowed — it was approved at the
                        time, and the record will say the printed object is the older reconstruction.
                      </div>
                    )}
                  </div>
                  <Btn variant="secondary" onClick={() => project && navigate(`/projects/${project.id}/print`)}>
                    Print again
                  </Btn>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {printJobs.filter((p) => p.state === 'failed').length > 0 && (
        <Notice title="A failed print still produces a record">
          It states what the printer reported, the layer it stopped at, the material used, that the model
          and Version are unchanged, that the print file is kept, and that nothing retries by itself.
        </Notice>
      )}
    </div>
  )
}
