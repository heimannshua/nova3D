import { Link } from 'react-router-dom'
import * as api from '@/api'
import { useActiveJobs, useLivePrints, useWorkspace } from '@/store/workspace'
import { JobStrip } from '@/components/nova3d/work'
import { PrintJobStrip } from '@/components/nova3d/work'
import { Btn, Notice, PlateMark, StatedAbsence } from '@/components/ui/primitives'
import { useAction } from '@/lib/useAction'

const ACTIONS = [
  { n: '1', title: 'My Projects', to: '/projects', body: 'Everything you have made, and the evidence behind it.' },
  { n: '2', title: 'Create', to: '/create', body: 'Describe something, or start from pictures.' },
  { n: '3', title: 'In Progress', to: '/jobs', body: 'Research, generation, slicing and printing that is running now.' },
]

export function Home() {
  const { projects, printers, settings, offline } = useWorkspace()
  const running = useActiveJobs()
  const livePrints = useLivePrints()
  const action = useAction()
  const firstRun = projects.length === 0

  return (
    <div className="page page-wide">
      {settings.showFirstUseGuidance && (
        <Notice tone="accent" title="New here?">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            nova3D does not claim a reconstruction is correct. It claims every decision can be traced
            back to the evidence that produced it, or is marked as not being evidence at all.
          </p>
          <div className="row gap-2 wrap">
            <Link to="/help" className="btn btn-secondary">
              Show me how it works
            </Link>
            <Btn
              variant="ghost"
              onClick={() => void action.run(() => api.settings.update({ showFirstUseGuidance: false }))}
            >
              I have got it
            </Btn>
          </div>
        </Notice>
      )}

      {/* The plate numerals are one of exactly three places the plate treatment
          is allowed — never a status, never a gate, never a control label. */}
      <div className="home-actions">
        {ACTIONS.map((a) => (
          <Link key={a.n} to={a.to} className="home-action">
            <PlateMark size={44}>{a.n}</PlateMark>
            <span className="home-action-title">{a.title}</span>
            <span className="sm muted">{a.body}</span>
          </Link>
        ))}
      </div>

      {firstRun ? (
        <Notice tone="accent" title="Nothing here yet">
          <p style={{ margin: '0 0 var(--space-2)' }}>
            This is where running work and live prints appear. Start with <strong>Create</strong>.
          </p>
          <Link to="/create" className="btn btn-primary">
            Create something
          </Link>
        </Notice>
      ) : (
        <>
          <section className="stack gap-3">
            <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Prints in progress</h2>
            {offline ? (
              <StatedAbsence>
                nova3D cannot reach any printer while you are offline, so it does not know what these
                machines are doing right now. The last thing it saw is not shown here, because it
                would look current and it is not.
              </StatedAbsence>
            ) : livePrints.length === 0 ? (
              <p className="sm muted" style={{ margin: 0 }}>
                Nothing is printing.
              </p>
            ) : (
              livePrints.map((pj) => (
                <PrintJobStrip
                  key={pj.id}
                  printJob={pj}
                  printerName={printers.find((p) => p.id === pj.printerId)?.name ?? ''}
                  projectName={projects.find((p) => p.id === pj.projectId)?.name ?? ''}
                  versionLabel={`Version ${projects.find((p) => p.id === pj.projectId)?.versions.find((v) => v.id === pj.versionId)?.number ?? '—'}`}
                  href={`/prints/${pj.id}`}
                />
              ))
            )}
          </section>

          <section className="stack gap-3">
            <h2 style={{ margin: 0, fontSize: 'var(--text-h4)' }}>Running now</h2>
            {running.filter((j) => j.kind !== 'print').length === 0 ? (
              <p className="sm muted" style={{ margin: 0 }}>
                No research, generation, validation or slicing is running.
              </p>
            ) : (
              running
                .filter((j) => j.kind !== 'print')
                .map((j) => (
                  <JobStrip
                    key={j.id}
                    job={j}
                    projectName={projects.find((p) => p.id === j.projectId)?.name ?? ''}
                    href={`/jobs/${j.id}`}
                  />
                ))
            )}
          </section>
        </>
      )}
    </div>
  )
}

export function Help() {
  const stages: [string, string, string][] = [
    ['Create', '/create', 'You say what you want, in ordinary words. Nothing is charged and nothing is built yet.'],
    ['Research', '/jobs', 'nova3D finds and reads Sources. You can watch which ones, and tell it not to use one.'],
    ['The Plan', '/projects', 'Everything it found, area by area — including what it could not find, which it says rather than fills in.'],
    ['Plan Approval', '/projects', 'You read the Plan and approve it. The first of two gates. Nothing is built before it.'],
    ['The model', '/projects', 'Geometry built from the Plan. You can look from any angle but you cannot edit it — corrections go back through the evidence.'],
    ['Model Approval', '/projects', 'The second gate. Downloading and printing both unlock here, and both are blocked without it.'],
    ['Validate', '/projects', 'Checked against the exact printer and size you chose. A pass is about that, and nothing more.'],
    ['Print or download', '/printers', 'nova3D can print it for you, or hand you the files. Either way you get the Source Record.'],
  ]
  return (
    <div className="page page-wide">
      <h1 className="page-title">How nova3D works</h1>
      <p className="measure">Eight stages, once through.</p>
      <ol className="stack gap-3 measure" style={{ margin: 0, paddingInlineStart: '1.4em' }}>
        {stages.map(([name, to, body]) => (
          <li key={name}>
            <Link to={to} style={{ fontFamily: 'var(--font-heading)', fontWeight: 600 }}>
              {name}
            </Link>
            <div className="sm muted">{body}</div>
          </li>
        ))}
      </ol>
      <Notice title="The one idea underneath all of it">
        nova3D does not claim the reconstruction is correct. It claims every decision can be traced
        back to the evidence that produced it — or is marked as not being evidence at all. That is why
        there are two gates, and why nothing is ever filled in silently.
      </Notice>
    </div>
  )
}
