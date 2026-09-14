/**
 * Create — a real six-step flow.
 *
 * State lives in one reducer at the top and each step is a route under
 * `/create`, so Back works, a step can be linked to, and leaving does not lose
 * what has been typed. The last step calls `api.projects.create`, which starts a
 * research or conversion Job and returns a Project the rest of the app can open.
 *
 * Sequencing is load-bearing, not cosmetic: scope is confirmed BEFORE the
 * research choices, so nobody agrees to spend money on work whose subject has
 * not been settled (FR-5 then FR-14).
 */

import { createContext, useContext, useMemo, useReducer, useState } from 'react'
import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom'
import * as api from '@/api'
import { useWorkspace } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { StepShell } from '@/components/layout/shells'
import { ActionBar } from '@/components/nova3d/flow'
import { Btn, Dialog, Field, Notice, RadioCard, StatedAbsence, Value, ViewportPlaceholder } from '@/components/ui/primitives'

type Route = 'describe' | 'pictures'

interface State {
  route: Route | null
  text: string
  pictures: string[]
  coverageAccepted: boolean
  pictureMode: 'direct' | 'researched'
  scopeConfirmed: boolean
  paidResearch: boolean
  useCache: boolean
}

type Action =
  | { t: 'route'; v: Route }
  | { t: 'text'; v: string }
  | { t: 'pictures'; v: string[] }
  | { t: 'coverage' }
  | { t: 'pictureMode'; v: 'direct' | 'researched' }
  | { t: 'scope' }
  | { t: 'paid'; v: boolean }
  | { t: 'cache'; v: boolean }

const initial: State = {
  route: null,
  text: '',
  pictures: [],
  coverageAccepted: false,
  pictureMode: 'direct',
  scopeConfirmed: false,
  paidResearch: false,
  useCache: true,
}

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'route':
      return { ...s, route: a.v }
    case 'text':
      return { ...s, text: a.v }
    case 'pictures':
      return { ...s, pictures: a.v }
    case 'coverage':
      return { ...s, coverageAccepted: true }
    case 'pictureMode':
      return { ...s, pictureMode: a.v }
    case 'scope':
      return { ...s, scopeConfirmed: true }
    case 'paid':
      return { ...s, paidResearch: a.v }
    case 'cache':
      return { ...s, useCache: a.v }
  }
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null)
const useCreate = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('Create steps must render inside CreateLayout')
  return c
}

const STEP_NAMES = ['How to start', 'Describe', 'Scope', 'Research', 'Confirm']

function steps(current: number) {
  return STEP_NAMES.map((label, i) => ({
    n: i + 1,
    label,
    state: i + 1 < current ? ('passed' as const) : i + 1 === current ? ('current' as const) : ('ahead' as const),
  }))
}

export function CreateLayout() {
  const [state, dispatch] = useReducer(reducer, initial)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return (
    <Ctx.Provider value={value}>
      <Outlet />
    </Ctx.Provider>
  )
}

// ── Step 1 · how to start ───────────────────────────────────────────────────

export function ChooseStart() {
  const { state, dispatch } = useCreate()
  const navigate = useNavigate()
  const { offline } = useWorkspace()
  const choice = state.route ?? 'describe'

  const blocked = offline && choice === 'describe'

  return (
    <div className="page">
      <StepShell
        steps={steps(1)}
        question="How would you like to start?"
        intro="Both routes end in a model you can inspect and print. They make different claims about how accurate it is, and that difference is permanent."
        aside={
          offline ? (
            <StatedAbsence>
              <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>You are offline right now.</strong>
              Converting pictures directly works without an internet connection. Research does not, so
              the described route is unavailable until you reconnect.
            </StatedAbsence>
          ) : undefined
        }
        actionBar={
          <ActionBar
            back="Leave"
            onBack={() => navigate('/')}
            consequence="Nothing is charged and nothing is built on this step."
            primary="Continue"
            blockedReason={
              blocked
                ? 'Describing a subject needs research, and research needs an internet connection. Photographing works offline.'
                : undefined
            }
            onPrimary={() => navigate(choice === 'describe' ? '/create/describe' : '/create/pictures')}
          />
        }
      >
        <div className="stack gap-3">
          <RadioCard name="route" checked={choice === 'describe'} onChange={() => dispatch({ t: 'route', v: 'describe' })} title="Describe what you want">
            nova3D researches the subject, builds a Research Plan from Sources, and waits for your
            approval before any geometry exists. Every decision ends up traceable to a Source.
            {offline && (
              <>
                {' '}
                <strong>Needs an internet connection.</strong>
              </>
            )}
          </RadioCard>
          <RadioCard name="route" checked={choice === 'pictures'} onChange={() => dispatch({ t: 'route', v: 'pictures' })} title="Start from pictures">
            Photograph the object, or choose pictures you already have. Faster, works offline, and you
            will be asked next whether to convert them directly or research the subject first.
          </RadioCard>
        </div>
      </StepShell>
    </div>
  )
}

// ── Step 2a · describe ──────────────────────────────────────────────────────

export function Describe() {
  const { state, dispatch } = useCreate()
  const navigate = useNavigate()
  const tooVague = state.text.trim().length > 0 && state.text.trim().length < 12

  return (
    <div className="page">
      <StepShell
        steps={steps(2)}
        question="What would you like nova3D to build?"
        intro="Ordinary language is fine. nova3D will say what it understood before anything runs."
        aside={
          tooVague ? (
            <Notice tone="warn" glyph="▲" title="One thing is unclear">
              <p style={{ margin: '0 0 var(--space-2)' }}>
                nova3D cannot tell what to research from this yet. Which object do you mean?
              </p>
              <div className="stack gap-2">
                <Btn
                  variant="secondary"
                  onClick={() => dispatch({ t: 'text', v: 'The outer altar and its ramp, as described in Middot chapter 3.' })}
                >
                  The outer altar, in the courtyard
                </Btn>
                <Btn variant="secondary" onClick={() => dispatch({ t: 'text', v: 'The inner altar.' })}>
                  The inner altar
                </Btn>
              </div>
            </Notice>
          ) : (
            <Notice tone="accent" title="What helps">
              Say what the object is, and where you have read about it if you know. You do not need to
              know any dimensions — finding those is what the research is for.
            </Notice>
          )
        }
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate('/create')}
            consequence="Nothing is charged on this step."
            primary="Continue"
            blockedReason={
              !state.text.trim()
                ? 'Say what you would like nova3D to build.'
                : tooVague
                  ? 'nova3D cannot tell what to research from this yet. Add a sentence about what the object is.'
                  : undefined
            }
            onPrimary={() => navigate('/create/scope')}
          />
        }
      >
        <Field label="What should nova3D build?" hint="You can change this on the next step after nova3D restates it.">
          <textarea
            className="input"
            value={state.text}
            onChange={(e) => dispatch({ t: 'text', v: e.target.value })}
            placeholder="For example: the outer altar and its ramp, as described in Middot chapter 3. Put it on a small plinth so it stands on a shelf."
          />
        </Field>

        {/personalis|personaliz|plinth|stand|base for|shelf/i.test(state.text) && (
          <Notice tone="accent" glyph="+" title="nova3D spotted a Personalization">
            Something in that sentence is what you want rather than what the Sources describe. It will
            be built and marked <strong>user-added</strong>, so it never reads as part of the
            historical object.
          </Notice>
        )}
      </StepShell>
    </div>
  )
}

// ── Step 2b · pictures ──────────────────────────────────────────────────────

export function Pictures() {
  const { state, dispatch } = useCreate()
  const navigate = useNavigate()
  const [permission, setPermission] = useState<'unset' | 'asking' | 'denied' | 'granted'>('unset')

  const add = () => dispatch({ t: 'pictures', v: [...state.pictures, `View ${state.pictures.length + 1}`] })

  return (
    <div className="page">
      <StepShell
        steps={steps(2)}
        question="Add pictures of the object"
        intro="Several angles of the same object. They stay grouped as one request — this is one model, not one per picture."
        aside={
          permission === 'denied' ? (
            <StatedAbsence>
              <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>nova3D cannot open the camera.</strong>
              Camera access was declined, so Take a photo is unavailable. Choosing pictures you already
              have still works. You can change this in your device settings.
            </StatedAbsence>
          ) : (
            <Notice tone="accent" title="What makes a better model">
              Pictures from several sides, in even light, with the whole object in frame. nova3D will
              tell you on the next step which views are missing.
            </Notice>
          )
        }
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate('/create')}
            consequence="Pictures stay on this device until you choose what to do with them."
            primary="Continue"
            blockedReason={state.pictures.length === 0 ? 'Add at least one picture of the object.' : undefined}
            onPrimary={() => navigate('/create/coverage')}
          />
        }
      >
        <div className="row gap-2 wrap">
          <Btn variant="secondary" onClick={add}>
            Choose pictures
          </Btn>
          <Btn variant="secondary" disabled={permission === 'denied'} onClick={() => setPermission('asking')}>
            Take a photo
          </Btn>
        </div>

        {state.pictures.length > 0 && (
          <div className="cards">
            {state.pictures.map((v, i) => (
              <figure key={v} className="stack gap-1">
                <ViewportPlaceholder label={v} note="uploaded picture" height={104} />
                <figcaption className="caption muted row gap-2">
                  <span className="grow">{v}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ minHeight: 28, padding: 0 }}
                    onClick={() => dispatch({ t: 'pictures', v: state.pictures.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        <p className="caption muted" style={{ margin: 0 }}>
          Add, preview, replace, reorder and remove — all before anything is converted.
        </p>

        {permission === 'asking' && (
          <Dialog
            title="nova3D would like to use the camera"
            actions={
              <>
                <Btn variant="secondary" onClick={() => setPermission('denied')}>
                  Not now
                </Btn>
                <Btn
                  variant="primary"
                  onClick={() => {
                    setPermission('granted')
                    add()
                  }}
                >
                  Allow
                </Btn>
              </>
            }
          >
            This is asked now because you chose Take a photo. Pictures stay on this device unless you
            choose the researched route, which sends the subject — not the pictures — to a provider.
          </Dialog>
        )}
      </StepShell>
    </div>
  )
}

// ── Step 3a · coverage ──────────────────────────────────────────────────────

export function Coverage() {
  const { state, dispatch } = useCreate()
  const navigate = useNavigate()
  const [warning, setWarning] = useState(false)
  const sufficient = state.pictures.length >= 4

  if (state.pictures.length === 0) return <Navigate to="/create/pictures" replace />

  return (
    <div className="page">
      <StepShell
        steps={steps(3)}
        question="What these pictures show"
        intro="nova3D checked the pictures for clarity and for how much of the object they cover."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate('/create/pictures')}
            consequence={
              sufficient
                ? 'Coverage is good. Nothing will need to be guessed from a missing side.'
                : 'You can add the missing views, or continue and accept that some geometry will be guessed.'
            }
            primary={sufficient ? 'Continue' : 'Generate anyway'}
            extra={
              !sufficient ? (
                <Btn variant="secondary" onClick={() => navigate('/create/pictures')}>
                  Add the missing views
                </Btn>
              ) : undefined
            }
            onPrimary={() => {
              if (sufficient) navigate('/create/picture-path')
              else setWarning(true)
            }}
          />
        }
      >
        <table className="table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sharpness</td>
              <td>Every picture is sharp enough.</td>
            </tr>
            <tr>
              <td>Lighting</td>
              <td>Even. No deep shadow hiding a surface.</td>
            </tr>
            <tr>
              <td>Angle coverage</td>
              <td>
                {sufficient ? (
                  'All sides are covered.'
                ) : (
                  <span style={{ color: 'var(--color-accent-2-strong)' }}>
                    <span aria-hidden="true">▲ </span>
                    The back and the underside are not shown in any picture.
                  </span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {!sufficient && (
          <Notice tone="warn" glyph="▲" title="Two views would improve this">
            <p style={{ margin: '0 0 var(--space-2)' }}>
              nova3D cannot see the back or the underside. If you continue without them, it will invent
              that geometry — it will look finished, but it will not be derived from anything.
            </p>
            <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
              <li>One picture from directly behind the object.</li>
              <li>One picture of the underside, or of the object tipped forward.</li>
            </ul>
          </Notice>
        )}

        {warning && (
          <Dialog
            title="Some of this model will be invented"
            actions={
              <>
                <Btn variant="secondary" onClick={() => setWarning(false)}>
                  Add the views instead
                </Btn>
                <Btn
                  variant="primary"
                  onClick={() => {
                    dispatch({ t: 'coverage' })
                    navigate('/create/picture-path')
                  }}
                >
                  Generate anyway
                </Btn>
              </>
            }
          >
            <p style={{ margin: '0 0 var(--space-2)' }}>
              Two sides of this object are not in any picture. nova3D will fill them in with geometry
              that is a guess, and there is no way to tell from the finished model which parts those
              were.
            </p>
            <p style={{ margin: 0 }}>
              The Project stays marked <strong>image-derived — not historically verified</strong> either
              way. This warning is about accuracy to the object in your pictures, which is a separate
              thing.
            </p>
          </Dialog>
        )}
      </StepShell>
    </div>
  )
}

// ── Step 3b · the two accuracy claims, side by side ─────────────────────────

export function PicturePath() {
  const { state, dispatch } = useCreate()
  const navigate = useNavigate()
  const { offline } = useWorkspace()

  return (
    <div className="page">
      <StepShell
        steps={steps(3)}
        question="What should nova3D do with these pictures?"
        intro="These two routes make different claims. The difference is recorded on the Project and in the Source Record, and it cannot be changed afterwards without a new Version."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate('/create/coverage')}
            consequence="Next: nova3D shows what it understood before anything runs."
            primary="Continue"
            blockedReason={
              offline && state.pictureMode === 'researched'
                ? 'Researching the subject needs an internet connection. Direct conversion works offline.'
                : undefined
            }
            onPrimary={() => navigate('/create/scope')}
          />
        }
      >
        <div className="stack gap-3">
          <RadioCard
            name="picture-mode"
            checked={state.pictureMode === 'direct'}
            onChange={() => dispatch({ t: 'pictureMode', v: 'direct' })}
            title="Convert the pictures directly"
          >
            Builds a likeness of the object in the pictures. Minutes, not hours. Works offline.
            <br />
            <strong>Claim: image-derived, not historically verified.</strong> There is no Research Plan,
            no Sources and no Plan Approval, because nothing was researched. You still inspect and
            approve the Version before validation and Export.
          </RadioCard>
          <RadioCard
            name="picture-mode"
            checked={state.pictureMode === 'researched'}
            onChange={() => dispatch({ t: 'pictureMode', v: 'researched' })}
            title="Identify and research the subject"
          >
            nova3D works out what the object is, researches it, and builds a complete Research Plan for
            your approval before any geometry.
            <br />
            <strong>Claim: evidence-backed, with every decision traceable to a Source.</strong> Longer,
            needs an internet connection, and may involve the free or paid research choices. The
            pictures become evidence about your object, not the only evidence.
          </RadioCard>
        </div>

        {offline && (
          <StatedAbsence>
            <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>
              Researching the subject is unavailable while you are offline.
            </strong>
            Direct conversion works now and syncs into My Projects when you reconnect. The researched
            route needs a connection and will be available then.
          </StatedAbsence>
        )}
      </StepShell>
    </div>
  )
}

// ── Step 4 · confirm the scope, before any money question ───────────────────

export function Scope() {
  const { state, dispatch } = useCreate()
  const navigate = useNavigate()
  const fromPictures = state.route === 'pictures'
  const direct = fromPictures && state.pictureMode === 'direct'

  const subject = fromPictures
    ? 'The object in the pictures you added.'
    : state.text.trim() || 'The outer altar and its ramp, as described in Middot chapter 3.'

  return (
    <div className="page">
      <StepShell
        steps={steps(3)}
        question="This is what nova3D understood"
        intro="Correct anything that is wrong. Nothing has been researched or built yet."
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(fromPictures ? '/create/picture-path' : '/create/describe')}
            consequence={
              direct
                ? 'Confirming costs nothing. Conversion starts on the next step.'
                : 'Confirming costs nothing. The research choices come next.'
            }
            primary="That is right — continue"
            extra={
              <Btn variant="secondary" onClick={() => navigate(fromPictures ? '/create/pictures' : '/create/describe')}>
                Something is wrong
              </Btn>
            }
            onPrimary={() => {
              dispatch({ t: 'scope' })
              navigate(direct ? '/create/start' : '/create/research')
            }}
          />
        }
      >
        <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-3)' }}>
          {[
            ['Subject', subject],
            [
              'Scope',
              fromPictures
                ? 'One object, from the pictures you added. Nothing around it.'
                : 'The object as described. Not its surroundings, and not related objects.',
            ],
            ['Intended outcome', 'A model you can inspect, approve, validate and print at desk size.'],
            ...(/plinth|stand|shelf/i.test(state.text)
              ? [['Personalization', 'A display plinth beneath the object. This is yours, not the Sources — it will be built and marked user-added.']]
              : []),
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="rail-label">{k}</dt>
              <dd style={{ margin: 'var(--space-1) 0 0' }}>{v}</dd>
            </div>
          ))}
        </dl>

        {direct && (
          <Notice tone="warn" glyph="▲">
            This Project will be permanently marked <strong>image-derived — not historically verified</strong>.
            That label follows it everywhere and no action removes it.
          </Notice>
        )}
      </StepShell>
    </div>
  )
}

// ── Step 5 · research choices, kept apart from each other ───────────────────

export function ResearchChoices() {
  const { state, dispatch } = useCreate()
  const navigate = useNavigate()
  const { usage, providers } = useWorkspace()
  const provider = providers[0]

  return (
    <div className="page">
      <StepShell
        steps={steps(4)}
        question="Research choices"
        intro="Two separate decisions. Nothing is charged on this step."
        aside={
          <div className="card">
            <div className="card-kicker">Your allowance</div>
            <dl style={{ margin: 0, display: 'grid', gap: 'var(--space-1)' }}>
              {([['Usage Limit', usage.limit], ['Reserved', usage.reserved], ['Spent', usage.spent]] as const).map(([k, v]) => (
                <div key={k} className="row gap-2">
                  <dt className="caption muted grow">{k}</dt>
                  <dd className="caption" style={{ margin: 0 }}>
                    <Value of={v} as="span" />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        }
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate('/create/scope')}
            consequence={
              state.paidResearch
                ? 'A reservation is taken before the work and settled to the real amount afterwards.'
                : 'Free research only. Some details may stay unknown, and the Plan will say which.'
            }
            primary="Continue"
            blockedReason={
              state.paidResearch && usage.reached
                ? 'Paid research would exceed your Usage Limit. Raise the limit in Settings, or choose free research only.'
                : undefined
            }
            onPrimary={() => navigate('/create/start')}
          />
        }
      >
        <section className="stack gap-3">
          <h4 style={{ margin: 0 }}>1 · Free or paid research</h4>
          <RadioCard name="paid" checked={!state.paidResearch} onChange={() => dispatch({ t: 'paid', v: false })} title="Free research only">
            Openly available Sources. No charge. Some details may stay <strong>? unknown</strong>, and
            the Plan will say which.
          </RadioCard>
          <RadioCard name="paid" checked={state.paidResearch} onChange={() => dispatch({ t: 'paid', v: true })} title="Allow paid research">
            nova3D may use a paid provider when free Sources are not enough. Before anything is charged
            you will see and permit each of these:
            <ul style={{ margin: 'var(--space-2) 0 0', paddingInlineStart: '1.2em' }}>
              <li>
                the provider&rsquo;s name — <Value of={provider?.name ?? api.PENDING} kind="content" as="span" />
              </li>
              <li>{provider?.purpose}</li>
              <li>what data leaves nova3D — {provider?.dataSent}</li>
              <li>what never does — {provider?.dataNeverSent}</li>
              <li>
                how long that provider keeps it — <Value of={provider?.retention ?? api.PENDING} kind="content" as="span" />
              </li>
              <li>
                the maximum charge for the Job — <Value of={provider?.maxCharge ?? api.PENDING} as="span" />
              </li>
            </ul>
            <p style={{ margin: 'var(--space-2) 0 0' }}>Permission is per Job, not once for the Account.</p>
          </RadioCard>
        </section>

        <section className="stack gap-3">
          <h4 style={{ margin: 0 }}>2 · Cached or fresh research</h4>
          <RadioCard name="cache" checked={state.useCache} onChange={() => dispatch({ t: 'cache', v: true })} title="Reuse cached research">
            A Cached Research Revision exists for this subject. Faster, and usually free.
            <br />
            <strong>Recorded 12 June 2026.</strong> That date travels with the Plan, with every Claim
            taken from it, and with the PDF Source Record — so a reader can tell cached evidence from
            fresh. Reusing it is not the same as re-checking it.
          </RadioCard>
          <RadioCard name="cache" checked={!state.useCache} onChange={() => dispatch({ t: 'cache', v: false })} title="Run fresh research">
            Ignores the cache and searches again. Slower, and the paid choice above may apply.
          </RadioCard>
        </section>
      </StepShell>
    </div>
  )
}

// ── Step 6 · start ──────────────────────────────────────────────────────────

export function StartWork() {
  const { state } = useCreate()
  const navigate = useNavigate()
  const action = useAction()
  const { offline } = useWorkspace()
  const direct = state.route === 'pictures' && state.pictureMode === 'direct'

  const start = async () => {
    const name = direct
      ? 'New Project from pictures'
      : state.text.trim().split(/[.,]/)[0].slice(0, 60) || 'New Project'
    let created: api.Project | undefined
    const ok = await action.run(async () => {
      created = await api.projects.create({
        name,
        origin: direct ? 'picture-direct' : state.route === 'pictures' ? 'picture-researched' : 'described',
        scope: {
          subject: direct ? 'The object in the pictures you added.' : state.text.trim(),
          scope: 'The object as confirmed on the scope step.',
          outcome: 'A model to inspect, approve, validate and print.',
          ...(/plinth|stand|shelf/i.test(state.text) ? { personalization: 'A display plinth beneath the object.' } : {}),
        },
        paidResearch: state.paidResearch,
        useCache: state.useCache,
        offline,
      })
    })
    if (ok && created) navigate(`/projects/${created.id}`, { replace: true })
  }

  return (
    <div className="page">
      <StepShell
        steps={steps(5)}
        question={direct ? 'Ready to convert your pictures' : 'Ready to start researching'}
        intro={
          direct
            ? 'This runs on your device. It does not need an internet connection.'
            : 'You can leave once it starts. The work continues and a Notification arrives when it finishes.'
        }
        actionBar={
          <ActionBar
            back="Back"
            onBack={() => navigate(direct ? '/create/scope' : '/create/research')}
            consequence={direct ? 'Nothing is charged. This runs on this device.' : 'A Notification arrives when the Plan is ready to read.'}
            primary={action.pending ? 'Starting…' : direct ? 'Convert the pictures' : 'Start research'}
            onPrimary={start}
          />
        }
      >
        <Notice tone="accent" title="What happens next">
          {direct ? (
            <ol style={{ margin: 0, paddingInlineStart: '1.2em' }}>
              <li>nova3D builds a likeness of the object in your pictures.</li>
              <li>You inspect it and approve the Version.</li>
              <li>Validation and Export or printing follow, exactly as for a researched model.</li>
            </ol>
          ) : (
            <ol style={{ margin: 0, paddingInlineStart: '1.2em' }}>
              <li>nova3D finds and reads Sources, and you can watch which ones as it goes.</li>
              <li>It builds a Research Plan, area by area, declaring what it could not find.</li>
              <li>You read the Plan and approve it. Nothing is built before that.</li>
            </ol>
          )}
        </Notice>

        {direct && offline && (
          <StatedAbsence>
            This Project will be saved on this device only. It appears in My Projects here now, and
            syncs into your Account when you reconnect — without duplicating it and without overwriting
            a newer Version.
          </StatedAbsence>
        )}

        {action.error && (
          <p className="blocker" role="status" style={{ margin: 0 }}>
            <span aria-hidden="true">▲</span>
            <span>{action.error}</span>
          </p>
        )}

        <p className="caption muted" style={{ margin: 0 }}>
          Prefer to look around first? <Link to="/projects">My Projects</Link>
        </p>
      </StepShell>
    </div>
  )
}
