/**
 * The print pipeline: choose a printer, prepare, resolve any evidence collision,
 * arrange the plate, slice, send.
 *
 * The three printing rules are enforced here and in the backend, not described:
 * printing-only fixes are listed and each has an Undo; reconstruction geometry
 * is never altered automatically; and an evidence collision blocks slicing until
 * the user decides, with neither option preselected (NFR-13, D-4).
 */

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as api from '@/api'
import { useCurrentVersion, useProject, useProjectJobs, useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { StepShell } from '@/components/layout/shells'
import { ActionBar } from '@/components/nova3d/flow'
import { StepBlocks, StatusToken } from '@/components/nova3d/status'
import { EvidenceCollisionPrompt, SpoolRow } from '@/components/nova3d/printing'
import { Btn, KeyValue, Ltr, Notice, StatedAbsence, Value, ViewportPlaceholder, Wording } from '@/components/ui/primitives'
import { Breadcrumbs } from '@/features/projects/ProjectNav'
import { NotFound } from '@/features/errors'

const steps = (current: number) =>
  ['Printer', 'Prepare', 'Plate', 'Slice', 'Send'].map((label, i) => ({
    n: i + 1,
    label,
    state: i + 1 < current ? ('passed' as const) : i + 1 === current ? ('current' as const) : ('ahead' as const),
  }))

function useGate(projectId: string | undefined) {
  const project = useProject(projectId)
  const version = useCurrentVersion(project)
  const blocked =
    !version
      ? 'Nothing has been generated yet.'
      : version.approval.state !== 'approved'
        ? 'Model Approval is not bound to this Version. Printing is blocked until you approve it.'
        : undefined
  return { project, version, blocked }
}

export function ChoosePrinter() {
  const { projectId } = useParams()
  const { project, blocked } = useGate(projectId)
  const { printers: allPrinters, profiles, offline } = useWorkspace()
  const printers = allPrinters.filter((p) => p.linked)
  const navigate = useNavigate()
  const action = useAction()
  const [manual, setManual] = useState(false)

  if (!project) return <NotFound />

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Print' }]} />
      <StepShell
        steps={steps(1)}
        question="Which printer?"
        intro="nova3D looks for printers on your network and in any maker account you are signed in to. Adding one by hand is the exception, not the way in."
        actionBar={
          <ActionBar
            back="Back to the model"
            onBack={() => navigate(`/projects/${project.id}/model`)}
            consequence="Choosing a printer does not start anything."
            primary="Continue"
            blockedReason={blocked ?? (!project.targetProfileId ? 'Choose a printer to continue.' : undefined)}
            onPrimary={async () => {
              await action.run(() => api.prints.prepare(project.id))
              navigate(`/projects/${project.id}/print/prepare`)
            }}
          />
        }
      >
        {blocked && (
          <Notice tone="warn" glyph="▲" title="Printing is gated">
            <p style={{ margin: '0 0 var(--space-2)' }}>{blocked}</p>
            <Link to={`/projects/${project.id}/model/approve`} className="btn btn-secondary">
              Go to Model Approval
            </Link>
          </Notice>
        )}

        {offline && (
          <StatedAbsence>
            <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
              You are offline, so nova3D cannot reach any printer.
            </strong>
            Preparing, arranging and slicing for a printer you have used before all still work. Sending
            and watching do not.
          </StatedAbsence>
        )}

        <div className="stack gap-3">
          {printers.map((p) => {
            const profile = profiles.find((x) => x.printerId === p.id)
            const selected = profile && project.targetProfileId === profile.id
            return (
              <article key={p.id} className="card" style={selected ? { boxShadow: 'inset 3px 0 0 var(--color-accent)' } : undefined}>
                <div className="row gap-3 wrap">
                  <div className="stack gap-1 grow">
                    <div className="card-title">{p.name}</div>
                    <div className="card-meta">
                      <span>
                        {p.discovery === 'network'
                          ? 'found on your network'
                          : p.discovery === 'maker-account'
                            ? 'found through your maker account'
                            : 'added by hand'}
                      </span>
                      <span>·</span>
                      <span>{p.online && !offline ? '● online' : '⊘ not reachable'}</span>
                    </div>
                    {!p.hasCamera && (
                      <div className="caption muted">
                        <span aria-hidden="true">⊘ </span>No camera. This printer cannot be watched.
                      </div>
                    )}
                  </div>
                  <Btn
                    variant={selected ? 'primary' : 'secondary'}
                    disabled={!profile || !p.online || offline || action.pending}
                    onClick={() => profile && void action.run(() => api.exports.setProfile(project.id, profile.id))}
                  >
                    {selected ? 'Chosen' : 'Use this one'}
                  </Btn>
                </div>
              </article>
            )
          })}
        </div>

        {manual ? (
          <Notice title="Adding a printer by hand">
            <p style={{ margin: '0 0 var(--space-2)' }}>
              You need its address on your network. This path exists for machines nova3D cannot find by
              itself.
            </p>
            <input className="input" placeholder="Address on your network" />
          </Notice>
        ) : (
          <Btn variant="ghost" onClick={() => setManual(true)} style={{ alignSelf: 'flex-start' }}>
            My printer is not listed — add it by hand
          </Btn>
        )}

        <Notice>
          Which controls a printer actually offers depends on its vendor integration, and that contract is
          not settled yet (AD-8). Where a machine cannot do something, nova3D says so rather than showing a
          control that does nothing.
        </Notice>
      </StepShell>
    </div>
  )
}

export function Prepare() {
  const { projectId } = useParams()
  const { project, version } = useGate(projectId)
  const navigate = useNavigate()
  const action = useAction()

  if (!project || !version) return <NotFound />

  const openCollisions = project.collisions.filter((c) => !c.resolved)

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Print', to: `/projects/${project.id}/print` }, { label: 'Prepare' }]} />
      <StepShell
        steps={steps(2)}
        question="Getting it ready to print"
        intro="nova3D fixed the printing-only problems. Each one is listed, and each one can be undone."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/print`)}
            consequence="None of these changed the reconstruction."
            primary={openCollisions.length ? 'Answer the question first' : 'Continue to the plate'}
            onPrimary={() =>
              navigate(openCollisions.length ? `/projects/${project.id}/print/decision` : `/projects/${project.id}/print/plate`)
            }
          />
        }
      >
        <section className="stack gap-2">
          <div className="rail-label">Fixed automatically</div>
          {project.printingOnlyFixes.map((f) => (
            <div key={f.id} className="list-row">
              <span className="stack gap-1 grow">
                <span style={{ textDecoration: f.undone ? 'line-through' : undefined }}>{f.what}</span>
                <span className="caption muted">{f.why}</span>
              </span>
              <Btn
                variant={f.undone ? 'secondary' : 'ghost'}
                disabled={action.pending}
                onClick={() => void action.run(() => api.prints.toggleFix(project.id, f.id))}
              >
                {f.undone ? 'Redo' : 'Undo'}
              </Btn>
            </div>
          ))}
        </section>

        <Notice tone="accent" title="What nova3D left alone">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            Nothing above touches the object itself. Orientation, supports, the brim and the position on
            the plate are all about the machine, and all reversible.
          </p>
          <p style={{ margin: 0 }}>
            No dimension, no Model Feature and no proportion was altered. nova3D does not have permission to
            do that automatically, and it asks instead.
          </p>
        </Notice>

        <section className="stack gap-2">
          <div className="rail-label">Left alone, and why</div>
          <table className="table">
            <tbody>
              {version.features.slice(0, 5).map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>
                    <StatusToken status={f.status} />
                  </td>
                  <td className="sm muted">Reconstruction geometry. Never altered automatically.</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {openCollisions.length > 0 && (
          <Notice tone="warn" glyph="▲" title="One thing needs your decision">
            Printing and the evidence disagree somewhere. nova3D will not choose.{' '}
            <Link to={`/projects/${project.id}/print/decision`}>Go to the decision</Link>.
          </Notice>
        )}
      </StepShell>
    </div>
  )
}

/** The third decision. Neither option is preselected, and nova3D will not pick. */
export function CollisionDecision() {
  const { projectId } = useParams()
  const { project } = useGate(projectId)
  const navigate = useNavigate()
  const action = useAction()

  if (!project) return <NotFound />

  const collision = project.collisions[0]
  if (!collision) {
    return (
      <div className="page page-wide">
        <Breadcrumbs project={project} trail={[{ label: 'Print', to: `/projects/${project.id}/print` }, { label: 'Decision' }]} />
        <h1 className="page-title">Nothing to decide</h1>
        <p className="sm muted">Printing and the evidence do not disagree on this model at this size.</p>
        <Link to={`/projects/${project.id}/print/plate`} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
          Continue to the plate
        </Link>
      </div>
    )
  }

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Print', to: `/projects/${project.id}/print` }, { label: 'Decision' }]} />
      <StepShell
        steps={steps(2)}
        question="Printing and the evidence disagree here"
        intro="This one nova3D will not decide for you."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/print/prepare`)}
            consequence="Your choice is recorded in the Source Record either way."
            primary="Continue"
            blockedReason={
              collision.resolved
                ? undefined
                : 'Choose one of the two options. Neither is preselected and nova3D will not pick for you.'
            }
            onPrimary={() => navigate(`/projects/${project.id}/print/plate`)}
          />
        }
      >
        <EvidenceCollisionPrompt
          collision={collision}
          chosen={collision.resolved}
          pending={action.pending}
          onChoose={(c) => void action.run(() => api.prints.resolveCollision(project.id, collision.id, c))}
        />
      </StepShell>
    </div>
  )
}

export function BuildPlate() {
  const { projectId } = useParams()
  const { project } = useGate(projectId)
  const { profiles } = useWorkspace()
  const navigate = useNavigate()
  const action = useAction()

  if (!project) return <NotFound />
  const profile = profiles.find((p) => p.id === project.targetProfileId)

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Print', to: `/projects/${project.id}/print` }, { label: 'Plate' }]} />
      <StepShell
        steps={steps(3)}
        question="Where it sits on the plate"
        intro="Placement and orientation, with what each one costs."
        aside={
          <Notice title="Why orientation matters">
            The way an object stands decides which surfaces print over air, which need support, and which
            come out smooth. It does not change the object.
          </Notice>
        }
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/print/prepare`)}
            consequence="Nothing here changes the object."
            primary={action.pending ? 'Slicing…' : 'Slice it'}
            onPrimary={async () => {
              const ok = await action.run(() => api.prints.slice(project.id))
              if (ok) navigate(`/projects/${project.id}/print/slice`)
            }}
          />
        }
      >
        <ViewportPlaceholder label="Build plate" note="The model on the plate. Placement only." />
        <KeyValue
          rows={[
            { k: 'Orientation', v: 'Ramp along the plate, altar upright' },
            { k: 'Consequence', v: 'The ramp underside needs support. The visible faces come out smooth.' },
            { k: 'Position', v: 'Centred' },
            { k: 'Physical size', v: <Value of={profile?.physicalSize ?? api.PENDING} as="span" /> },
          ]}
        />
        {project.imageDerived && (
          <Notice tone="warn" glyph="▲">
            This model is image-derived and not historically verified. That stays true of the printed
            object.
          </Notice>
        )}
        {action.error && (
          <p className="blocker" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">▲</span>
            <span>{action.error}</span>
          </p>
        )}
      </StepShell>
    </div>
  )
}

export function SliceView() {
  const { projectId } = useParams()
  const { project } = useGate(projectId)
  const { slices, printers, profiles } = useWorkspace()
  const jobs = useProjectJobs(projectId)
  const navigate = useNavigate()
  const running = jobs.find((j) => j.kind === 'slice' && j.state === 'running')

  if (!project) return <NotFound />

  const slice = slices.find((s) => s.id === project.sliceId)
  const profile = profiles.find((p) => p.id === project.targetProfileId)
  const printer = printers.find((p) => p.id === profile?.printerId)
  const unreadableSpool = printer?.spools.some((s) => !s.readable)

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Print', to: `/projects/${project.id}/print` }, { label: 'Slice' }]} />
      <StepShell
        steps={steps(4)}
        question={running ? 'Slicing' : 'The slice'}
        intro={running ? 'This runs on your device and does not need a connection.' : undefined}
        actionBar={
          running ? undefined : (
            <ActionBar
              back="Back"
              onBack={() => navigate(`/projects/${project.id}/print/plate`)}
              consequence="Slicing does not send anything to the printer."
              primary="Continue to send"
              blockedReason={!slice ? 'Slice the model before sending it.' : undefined}
              onPrimary={() => navigate(`/projects/${project.id}/print/send`)}
            />
          )
        }
      >
        {running ? (
          <>
            <StepBlocks done={running.progress?.done} total={running.progress?.total} />
            <p className="sm muted">You can leave. A Notification arrives when it finishes.</p>
          </>
        ) : slice ? (
          <>
            <KeyValue
              rows={[
                { k: 'Layers', v: <Value of={slice.layers} as="span" /> },
                { k: 'Time', v: <Value of={slice.duration} as="span" /> },
                { k: 'Material', v: <Value of={slice.material} as="span" /> },
                { k: 'Profile', v: profile?.printerName ?? '—' },
              ]}
            />
            <Notice glyph="◷">
              <Wording
                ordinary="These are the slicer's estimates, not nova3D's own measurement. A real print varies with the machine and the room."
                technical="Slicer estimates. Actual duration and consumption vary with machine state and ambient conditions."
              />
            </Notice>
          </>
        ) : (
          <p className="sm muted">Not sliced yet.</p>
        )}

        {printer && (
          <section className="stack gap-2">
            <div className="rail-label">What is loaded on {printer.name}</div>
            {printer.spools.map((s) => (
              <SpoolRow key={s.slot} spool={s} />
            ))}
            {unreadableSpool && (
              <Notice tone="warn" glyph="▲" title="One spool could not be read">
                nova3D will not guess what is loaded in that slot, so it will not check it against the
                slice. Load a readable spool, or assign that part to a different slot.
              </Notice>
            )}
          </section>
        )}

        <Notice>
          The slicing engine decision — owned, embedded or wrapped — is not settled yet (AD-10), and it
          determines whether these layer and time figures are real.
        </Notice>
      </StepShell>
    </div>
  )
}

export function SendPrint() {
  const { projectId } = useParams()
  const { project, version, blocked } = useGate(projectId)
  const { slices, printers, profiles } = useWorkspace()
  const navigate = useNavigate()
  const action = useAction()

  if (!project || !version) return <NotFound />

  const slice = slices.find((s) => s.id === project.sliceId)
  const profile = profiles.find((p) => p.id === project.targetProfileId)
  const printer = printers.find((p) => p.id === profile?.printerId)
  const upkeepDue = printer?.upkeep.filter((u) => u.due === 'now' || u.due === 'soon') ?? []

  return (
    <div className="page page-wide">
      <Breadcrumbs project={project} trail={[{ label: 'Print', to: `/projects/${project.id}/print` }, { label: 'Send' }]} />
      <StepShell
        steps={steps(5)}
        question="Send this to the printer"
        intro="One confirmation before the machine starts."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(`/projects/${project.id}/print/slice`)}
            consequence="The printer starts as soon as you confirm."
            primary={action.pending ? 'Sending…' : 'Send it'}
            blockedReason={blocked ?? (!slice ? 'Slice the model first.' : !printer?.online ? 'That printer is not reachable.' : undefined)}
            onPrimary={async () => {
              if (!printer) return
              const ok = await action.run(() => api.prints.send(project.id, printer.id))
              if (ok) navigate('/printers')
            }}
          />
        }
      >
        <KeyValue
          rows={[
            { k: 'Model', v: <>{project.name}, <Ltr>Version {version.number}</Ltr></> },
            {
              k: 'Approved',
              v:
                version.approval.state === 'approved'
                  ? '✓ Model Approval is bound to this exact Version'
                  : '▲ Not approved — printing is blocked',
            },
            { k: 'Printer', v: printer?.name ?? '—' },
            { k: 'Time', v: <Value of={slice?.duration ?? api.PENDING} as="span" /> },
            { k: 'Material', v: <Value of={slice?.material ?? api.PENDING} as="span" /> },
          ]}
        />

        {upkeepDue.length > 0 && (
          <Notice glyph="◷" title={`${upkeepDue.length} upkeep item${upkeepDue.length === 1 ? '' : 's'} due`}>
            <ul style={{ margin: '0 0 var(--space-2)', paddingInlineStart: '1.2em' }}>
              {upkeepDue.map((u) => (
                <li key={u.item}>
                  <strong>{u.item}</strong> — {u.why}
                </li>
              ))}
            </ul>
            <p style={{ margin: 0 }}>
              These are raised now because you are about to print, not to stop you. Upkeep never blocks a
              print.
            </p>
          </Notice>
        )}

        <Notice tone="accent" title="What nova3D is not saying">
          It is not saying this print will work. It is saying the file is ready, the material matches what
          the slice expects, and the machine accepted it.
        </Notice>

        {action.error && (
          <p className="blocker" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">▲</span>
            <span>{action.error}</span>
          </p>
        )}
      </StepShell>
    </div>
  )
}
