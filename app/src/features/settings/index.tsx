/**
 * Account Settings.
 *
 * Every sub-page is a route component reached from `SettingsOverview`. Two
 * pairs of controls in this file are deliberately kept apart rather than
 * merged into one toggle, because they are different decisions with
 * different consequences:
 *
 *   · interface language (locale) and reading direction (dir) — set
 *     separately so RTL is genuinely tested, not assumed to follow the
 *     language (FR-47).
 *   · Source availability here, Account-wide and about future Projects
 *     (FR-44), versus "Do not use in this Project" on a Project's own
 *     Sources screen, which is per-Project and changes nothing here
 *     (FR-43).
 *
 * Nothing on these screens invents a number. Anything that must come from a
 * real provider, backend or device renders through `Value`, which prints
 * "value pending" rather than a plausible substitute.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '@/api'
import type { NotificationCategory } from '@/api'
import { useWorkspace, useSettings } from '@/store/workspace'
import { useAction } from '@/lib/useAction'
import { PageHeader } from '@/components/layout/shells'
import { Btn, Field, KeyValue, Ltr, Notice, RadioCard, Seg, StatedAbsence, Value, Wording } from '@/components/ui/primitives'
import { SourceRow } from '@/components/nova3d/evidence'

function SettingsBreadcrumb({ label }: { label: string }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link to="/settings">Settings</Link>
      <span aria-hidden="true">/</span>
      <span className="muted">{label}</span>
    </nav>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p className="blocker" role="status" style={{ margin: 0 }}>
      <span aria-hidden="true">▲</span>
      <span>{error}</span>
    </p>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────

const SUB_PAGES = [
  { to: '/settings/language', label: 'Language and wording', hint: 'Interface language, reading direction, and how explanations are worded.' },
  { to: '/settings/sources', label: 'Sources', hint: 'What new Projects are allowed to use as evidence.' },
  { to: '/settings/watching', label: 'Watching', hint: 'What happens when a printer with a camera sees a possible problem.' },
  { to: '/settings/usage', label: 'Usage', hint: 'Your spending limit, and how a charge actually happens.' },
  { to: '/settings/notifications', label: 'Notifications', hint: 'What reaches your phone as a push notification, category by category.' },
  { to: '/settings/delete', label: 'Delete', hint: 'Delete a Project, or the whole Account.' },
  { to: '/settings/appearance', label: 'Appearance', hint: 'Theme, text size, contrast, motion, and what is never optional.' },
]

export function SettingsOverview() {
  const { session } = useWorkspace()

  return (
    <div className="page page-wide">
      <PageHeader title="Settings" meta="Account-wide. Nothing here changes a Project that is already approved." />
      <div className="list">
        {SUB_PAGES.map((p) => (
          <Link key={p.to} to={p.to} className="list-row list-row-link">
            <span className="stack gap-1 grow">
              <strong>{p.label}</strong>
              <span className="sm muted">{p.hint}</span>
            </span>
          </Link>
        ))}
        {session?.account.isAdministrator && (
          <Link to="/admin" className="list-row list-row-link">
            <span className="stack gap-1 grow">
              <span className="row gap-2 wrap" style={{ alignItems: 'center' }}>
                <strong>Administration</strong>
                <span className="tag tag-accent-2">Administrator</span>
              </span>
              <span className="sm muted">Invitation codes, providers, and Accounts. Kept apart from your own Settings.</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Language and wording ────────────────────────────────────────────────

export function LanguageSettings() {
  const settings = useSettings()
  const action = useAction()

  return (
    <div className="page page-wide">
      <SettingsBreadcrumb label="Language and wording" />
      <PageHeader title="Language and wording" />

      <section className="stack gap-2">
        <div className="rail-label">Interface language</div>
        <Seg<'en' | 'he'>
          label="Interface language"
          value={settings.locale}
          onChange={(v) => void action.run(() => api.settings.update({ locale: v }))}
          options={[
            { value: 'en', label: 'English' },
            { value: 'he', label: 'עברית' },
          ]}
        />
      </section>

      <section className="stack gap-2">
        <div className="rail-label">Reading direction</div>
        <Seg<'ltr' | 'rtl'>
          label="Reading direction"
          value={settings.dir}
          onChange={(v) => void action.run(() => api.settings.update({ dir: v }))}
          options={[
            { value: 'ltr', label: 'Left to right' },
            { value: 'rtl', label: 'Right to left' },
          ]}
        />
        <p className="sm muted" style={{ margin: 0 }}>
          Language and direction are set separately on purpose. That is how right-to-left actually gets
          tested, rather than assumed to follow whichever language is chosen.
        </p>
      </section>

      <section className="stack gap-2">
        <div className="rail-label">Wording</div>
        <Seg<'ordinary' | 'technical'>
          label="Wording"
          value={settings.wording}
          onChange={(v) => void action.run(() => api.settings.update({ wording: v }))}
          options={[
            { value: 'ordinary', label: 'Ordinary' },
            { value: 'technical', label: 'Technical' },
          ]}
        />
        <div className="card" style={{ alignItems: 'flex-start' }}>
          <div className="card-kicker">Same fact, said two ways</div>
          <p className="sm" style={{ margin: 0 }}>
            <Wording
              ordinary="Sources sometimes disagree. When that happens, nova3D shows both readings and asks you to choose — it never picks for you."
              technical="Where Sources conflict on a Consequential Detail, nova3D records the Claim as disputed and surfaces both Defensible Options for you to resolve."
            />
          </p>
        </div>
        <p className="sm muted" style={{ margin: 0 }}>
          Changing wording never changes the evidence, the decisions already made, or what nova3D is
          allowed to do. It only changes how the same thing is said.
        </p>
      </section>

      <ErrorLine error={action.error} />

      <Notice title="Source text is never affected">
        Original language, translation and explanation stay three separate blocks, each with its own
        <Ltr> lang</Ltr> and <Ltr>dir</Ltr>, no matter what is set here. This screen changes nova3D&rsquo;s
        own chrome, never a Source&rsquo;s words.
      </Notice>
    </div>
  )
}

// ── Sources ──────────────────────────────────────────────────────────────

export function SourceSettings() {
  const { sources, settings } = useWorkspace()
  const action = useAction()

  const availability = (sourceId: string) =>
    settings.accountSources.find((s) => s.sourceId === sourceId)?.availableToNewProjects ?? true

  return (
    <div className="page page-wide">
      <SettingsBreadcrumb label="Sources" />
      <PageHeader title="Sources available to new Projects" />

      <Notice title="Account-wide, and about future Projects only">
        <p style={{ margin: '0 0 var(--space-2)' }}>
          Switching a Source off here means new Projects will not use it. A Job running right now loses it
          immediately, and any Claim that depended on it is visibly marked and rechecked with replacement
          research.
        </p>
        <p style={{ margin: '0 0 var(--space-2)' }}>
          Completed, approved Projects are never changed by this. They keep their provenance, their
          approvals and their Source Record exactly as they were.
        </p>
        <p style={{ margin: 0 }}>
          &ldquo;Do not use in this Project&rdquo; is a different control, found on that Project&rsquo;s own
          Sources screen. It affects one Project only. nova3D keeps the two apart because they are
          different decisions.
        </p>
      </Notice>

      <section className="stack gap-2">
        {sources.length === 0 && <p className="sm muted">No Sources recorded yet.</p>}
        {sources.map((s) => {
          const available = availability(s.id)
          return (
            <div key={s.id} className="row gap-3 wrap" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <SourceRow source={s} disabledAccountWide={!available} />
              </div>
              <Btn
                variant={available ? 'primary' : 'secondary'}
                role="switch"
                aria-checked={available}
                aria-label={`Available to new Projects: ${s.id}`}
                disabled={action.pending}
                onClick={() => void action.run(() => api.settings.setSourceAvailable(s.id, !available))}
              >
                {available ? 'Available to new Projects' : 'Not available to new Projects'}
              </Btn>
            </div>
          )
        })}
      </section>

      <ErrorLine error={action.error} />

      <section className="row gap-3 wrap" style={{ alignItems: 'center' }}>
        <span className="stack gap-1 grow">
          <strong>Warn when a disabled Source would have been used</strong>
          <span className="sm muted">
            Hiding this warning changes nothing about the record itself — only whether nova3D mentions it
            to you.
          </span>
        </span>
        <Btn
          variant={settings.showDisabledSourceWarning ? 'primary' : 'secondary'}
          role="switch"
          aria-checked={settings.showDisabledSourceWarning}
          aria-label="Warn when a disabled Source would have been used"
          disabled={action.pending}
          onClick={() => void action.run(() => api.settings.update({ showDisabledSourceWarning: !settings.showDisabledSourceWarning }))}
        >
          {settings.showDisabledSourceWarning ? 'On' : 'Off'}
        </Btn>
      </section>
    </div>
  )
}

// ── Watching ─────────────────────────────────────────────────────────────

const WATCH_OPTIONS: { value: 'pause' | 'notify' | 'off'; title: string; body: string }[] = [
  { value: 'pause', title: 'Pause and notify', body: 'A likely problem pauses the print and sends a Notification. The default.' },
  { value: 'notify', title: 'Notify only', body: 'A likely problem sends a Notification, but the print keeps running.' },
  { value: 'off', title: 'Do not watch', body: 'The camera is not used to watch for problems, even on a printer that has one.' },
]

export function WatchingSettings() {
  const { settings, printers } = useWorkspace()
  const action = useAction()

  return (
    <div className="page page-wide">
      <SettingsBreadcrumb label="Watching" />
      <PageHeader title="Watching" />

      <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {WATCH_OPTIONS.map((o) => (
          <RadioCard
            key={o.value}
            name="watchMode"
            checked={settings.watchMode === o.value}
            onChange={() => void action.run(() => api.settings.update({ watchMode: o.value }))}
            title={o.title}
          >
            {o.body}
          </RadioCard>
        ))}
      </div>

      <ErrorLine error={action.error} />

      <section className="stack gap-2">
        <div className="rail-label">Per-printer watching</div>
        {printers.length === 0 && <p className="sm muted">No printers connected yet.</p>}
        {printers.map((p) =>
          p.hasCamera ? (
            <div key={p.id} className="row gap-3 wrap" style={{ alignItems: 'center' }}>
              <span className="grow">{p.name}</span>
              <Btn
                variant={p.watching ? 'primary' : 'secondary'}
                role="switch"
                aria-checked={p.watching}
                aria-label={`Watch ${p.name}`}
                disabled={action.pending}
                onClick={() => void action.run(() => api.prints.setWatching(p.id, !p.watching))}
              >
                {p.watching ? 'Watching' : 'Not watching'}
              </Btn>
            </div>
          ) : (
            <div key={p.id} className="row gap-3 wrap" style={{ alignItems: 'center' }}>
              <span className="grow">{p.name}</span>
              <StatedAbsence>This machine has no camera. It cannot be watched, whatever this setting says.</StatedAbsence>
            </div>
          ),
        )}
      </section>

      <Notice tone="warn" glyph="▲" title="Detection can be wrong in both directions">
        It can raise an alert on a print that was fine, and it can miss a print that was actually failing.
        A lower alert count is not the same as better watching — it can just as easily mean real failures
        are being missed rather than caught.
      </Notice>
    </div>
  )
}

// ── Usage ────────────────────────────────────────────────────────────────

export function UsageSettings() {
  const { usage, jobs, projects } = useWorkspace()
  const spendingRows = jobs.filter((j) => j.cost)

  return (
    <div className="page page-wide">
      <SettingsBreadcrumb label="Usage" />
      <PageHeader title="Usage" />

      <KeyValue
        rows={[
          { k: 'Limit', v: <Value of={usage.limit} as="span" /> },
          { k: 'Reserved right now', v: <Value of={usage.reserved} as="span" /> },
          { k: 'Spent', v: <Value of={usage.spent} as="span" /> },
          { k: 'Limit reached', v: usage.reached ? 'Yes — paid work will not start until this changes.' : 'No' },
        ]}
      />

      <Notice title="How a charge actually happens">
        <ol style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          <li>You permit paid work per Job, having seen the maximum it could charge.</li>
          <li>nova3D reserves up to that maximum before the Job starts.</li>
          <li>When the Job finishes, the reservation is settled to what it actually cost.</li>
          <li>If the Job fails, the reservation is released and nothing is charged.</li>
        </ol>
      </Notice>

      <section className="stack gap-2">
        <div className="rail-label">Spending history</div>
        {spendingRows.length === 0 ? (
          <p className="sm muted" style={{ margin: 0 }}>
            No paid Job has run yet.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Kind</th>
                <th>Started</th>
                <th>Reserved</th>
                <th>Settled</th>
              </tr>
            </thead>
            <tbody>
              {spendingRows.map((j) => (
                <tr key={j.id}>
                  <td>{projects.find((p) => p.id === j.projectId)?.name ?? j.projectId}</td>
                  <td className="sm">{j.kind}</td>
                  <td className="sm muted">
                    <Ltr>{j.startedAt.slice(0, 10)}</Ltr>
                  </td>
                  {/* A reservation and a settlement are different facts. A released
                      reservation charged nothing, and says so rather than showing a zero. */}
                  <td className="sm">
                    <Value of={j.cost!.reserved} as="span" />
                  </td>
                  <td className="sm">
                    {j.cost!.released ? (
                      <span className="muted">released — nothing was charged</span>
                    ) : j.cost!.settled !== undefined ? (
                      <Value of={j.cost!.settled} as="span" />
                    ) : (
                      <span className="muted">not settled yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

// ── Notifications ────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  research: 'Research',
  generation: 'Generation',
  validation: 'Validation',
  export: 'Export',
  print: 'Print',
}

export function NotificationSettings() {
  const settings = useSettings()
  const action = useAction()

  return (
    <div className="page page-wide">
      <SettingsBreadcrumb label="Notifications" />
      <PageHeader title="Notifications" />

      {settings.pushPermission === 'denied' && (
        <StatedAbsence>
          This device is not allowing push notifications. Nothing below will reach your phone no matter
          how it is set here — nova3D says this plainly rather than leaving you to infer it from alerts
          that never arrive.
        </StatedAbsence>
      )}

      <section className="stack gap-2">
        {(Object.keys(CATEGORY_LABEL) as NotificationCategory[]).map((cat) => (
          <div key={cat} className="row gap-3 wrap" style={{ alignItems: 'center' }}>
            <span className="grow">{CATEGORY_LABEL[cat]}</span>
            <Btn
              variant={settings.pushCategories[cat] ? 'primary' : 'secondary'}
              role="switch"
              aria-checked={settings.pushCategories[cat]}
              aria-label={`Push notifications for ${CATEGORY_LABEL[cat]}`}
              disabled={action.pending}
              onClick={() =>
                void action.run(() =>
                  api.settings.update({ pushCategories: { ...settings.pushCategories, [cat]: !settings.pushCategories[cat] } }),
                )
              }
            >
              {settings.pushCategories[cat] ? 'On' : 'Off'}
            </Btn>
          </div>
        ))}
      </section>

      <ErrorLine error={action.error} />

      <Notice title="What a push carries, and what it never carries">
        <p style={{ margin: '0 0 var(--space-2)' }}>
          Enough to identify the item and open it: a category, a short title, and a link into nova3D.
        </p>
        <p style={{ margin: 0 }}>
          It never carries a Source passage, a Claim, a decision, or anything else that lives inside a
          Project. That stays behind sign-in, inside the app.
        </p>
      </Notice>

      <Notice title="The record does not depend on this">
        Your in-app Notifications history stays complete whatever is set here. Switching push off changes
        how you find out — it does not change whether there is a record.
      </Notice>

      <Notice glyph="▲">
        Exactly what push delivery looks like on each platform is not settled yet (AD-14).
      </Notice>
    </div>
  )
}

// ── Delete ───────────────────────────────────────────────────────────────

export function DeleteSettings() {
  const { projects, printJobs, session } = useWorkspace()
  const action = useAction()
  const [scope, setScope] = useState<'project' | 'account'>('project')
  const [projectId, setProjectId] = useState('')
  const [typed, setTyped] = useState('')

  const project = projects.find((p) => p.id === projectId)
  const blocked = printJobs.some((p) => p.state === 'printing' || p.state === 'paused')
  const confirmTarget = scope === 'project' ? project?.name ?? '' : session?.account.email ?? ''
  const canConfirm = Boolean(confirmTarget) && typed === confirmTarget && !blocked && !action.pending

  return (
    <div className="page page-wide">
      <SettingsBreadcrumb label="Delete" />
      <PageHeader title="Delete" />

      <Seg<'project' | 'account'>
        label="What to delete"
        value={scope}
        onChange={(v) => {
          setScope(v)
          setTyped('')
        }}
        options={[
          { value: 'project', label: 'A Project' },
          { value: 'account', label: 'My whole Account' },
        ]}
      />

      {scope === 'project' && (
        <Field label="Which Project">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose a Project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {projects.length === 0 && <p className="sm muted" style={{ margin: 'var(--space-1) 0 0' }}>You have no Projects to delete.</p>}
        </Field>
      )}

      <section className="stack gap-2">
        <strong>What is removed</strong>
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          {scope === 'project' ? (
            <>
              <li>This Project, its Plan, every Version and its Source Record.</li>
              <li>Its approvals, decisions, corrections and validation history.</li>
              <li>Its Print Records.</li>
            </>
          ) : (
            <>
              <li>Every Project you own, with its Plan, every Version and its Source Record.</li>
              <li>Every approval, decision, correction and validation history you produced.</li>
              <li>Every Print Record, and the Account itself.</li>
            </>
          )}
        </ul>
      </section>

      <section className="stack gap-2">
        <strong>What is retained, and why</strong>
        <p className="sm" style={{ margin: 0 }}>
          Research derived from public Sources may remain in a shared cache — a retrieval date, a passage
          identity, a Source edition. It is reproducible from those Sources by anyone, and it contains
          nothing of yours: not your identity, not a Project name, not an input, not a decision.
        </p>
      </section>

      <section className="stack gap-2">
        <strong>How long it takes</strong>
        <KeyValue
          rows={[
            { k: 'Immediately', v: 'Blocked from every read. No Job can write to it again.' },
            { k: 'Promptly', v: 'Active private data is removed.' },
            { k: 'Within 30 days', v: 'Removed from operational backups.' },
            { k: 'After a restore', v: 'The deletion still holds.' },
          ]}
        />
      </section>

      {blocked && (
        <p className="blocker" role="status">
          <span aria-hidden="true">▲</span>
          <span>
            A print is running right now. Deleting now would leave a machine finishing a job with no
            record left behind it once this is gone.
          </span>
        </p>
      )}

      <ErrorLine error={action.error} />

      <Field
        label={scope === 'project' ? 'Type the Project name to confirm' : 'Type your Account email to confirm'}
        hint={confirmTarget ? undefined : scope === 'project' ? 'Choose a Project above first.' : undefined}
      >
        <input
          className="input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={confirmTarget || undefined}
          disabled={!confirmTarget}
        />
      </Field>

      <Btn
        variant="danger"
        disabled={!canConfirm}
        onClick={() => {
          if (scope === 'project' && project) {
            void action.run(() => api.projects.remove(project.id))
          }
          // Account deletion makes no API call yet — this is confirmation UI only.
        }}
        style={{ alignSelf: 'flex-start' }}
      >
        {scope === 'project' ? 'Delete this Project' : 'Delete my Account'}
      </Btn>
    </div>
  )
}

// ── Appearance ───────────────────────────────────────────────────────────

export function AppearanceSettings() {
  const settings = useSettings()
  const action = useAction()

  return (
    <div className="page page-wide">
      <SettingsBreadcrumb label="Appearance" />
      <PageHeader title="Appearance" />

      <section className="stack gap-2">
        <div className="rail-label">Theme</div>
        <Seg<'light' | 'dark'>
          label="Theme"
          value={settings.theme}
          onChange={(v) => void action.run(() => api.settings.update({ theme: v }))}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <p className="sm muted" style={{ margin: 0 }}>
          Light is the default on every device. Dark preserves every status distinction — nothing is
          collapsed into one colour just because the background changed.
        </p>
      </section>

      <section className="stack gap-2">
        <div className="rail-label">Text size</div>
        <Seg<'normal' | 'large'>
          label="Text size"
          value={settings.textSize}
          onChange={(v) => void action.run(() => api.settings.update({ textSize: v }))}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'large', label: 'Large' },
          ]}
        />
        <p className="sm muted" style={{ margin: 0 }}>
          Enlarges text without changing the spacing the layout depends on.
        </p>
      </section>

      <section className="stack gap-2">
        <div className="rail-label">Contrast</div>
        <Seg<'normal' | 'high'>
          label="Contrast"
          value={settings.contrast}
          onChange={(v) => void action.run(() => api.settings.update({ contrast: v }))}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
          ]}
        />
      </section>

      <section className="stack gap-2">
        <div className="rail-label">Motion</div>
        <Seg<'normal' | 'reduced'>
          label="Motion"
          value={settings.motion}
          onChange={(v) => void action.run(() => api.settings.update({ motion: v }))}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'reduced', label: 'Reduced' },
          ]}
        />
        <p className="sm muted" style={{ margin: 0 }}>
          Stops every animation, including the plate treatments — they stop drifting rather than merely
          slowing down.
        </p>
      </section>

      <section className="stack gap-2">
        <div className="rail-label">Wording</div>
        <Seg<'ordinary' | 'technical'>
          label="Wording"
          value={settings.wording}
          onChange={(v) => void action.run(() => api.settings.update({ wording: v }))}
          options={[
            { value: 'ordinary', label: 'Ordinary' },
            { value: 'technical', label: 'Technical' },
          ]}
        />
      </section>

      <ErrorLine error={action.error} />

      <section className="row gap-3 wrap" style={{ alignItems: 'center' }}>
        <span className="stack gap-1 grow">
          <strong>First-use guidance</strong>
          <span className="sm muted">The short walkthroughs shown the first time a screen is opened.</span>
        </span>
        <Btn
          variant="secondary"
          disabled={action.pending}
          onClick={() => void action.run(() => api.settings.update({ showFirstUseGuidance: true }))}
        >
          Show it again
        </Btn>
      </section>

      <Notice title="What is always on">
        <p style={{ margin: '0 0 var(--space-2)' }}>
          Every state carries a glyph and a word, so nothing depends on seeing colour. Everything is
          keyboard reachable in a sensible order with a visible focus ring. Both approval gates and every
          print control work without a pointing device. Touch targets are at least 44px, and 48px on a
          gate.
        </p>
        <p style={{ margin: 0 }}>These are not preferences, so they are not switches.</p>
      </Notice>

      <Notice glyph="▲">
        The audit tooling and the assistive-technology test matrix that define an accepted WCAG 2.2 AA
        pass are not settled yet (AD-16).
      </Notice>
    </div>
  )
}
