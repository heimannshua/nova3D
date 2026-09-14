/**
 * Flow check — drives the application's own API through the evidence-to-print
 * spine and asserts the gates actually hold.
 *
 *   npm run flow
 *
 * This is not a UI test. It exercises `src/api`, which is the layer the real
 * backend replaces, so every assertion here is a statement about the contract
 * that must survive that swap. If a gate is ever reduced to a `disabled`
 * attribute in a component, this file fails.
 */

import * as api from '../src/api'
import { isPending } from '../src/api'

let failures = 0
let checks = 0

function ok(label: string, condition: boolean, detail = '') {
  checks++
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
  }
}

async function throws(label: string, fn: () => Promise<unknown>, expectCode?: string) {
  checks++
  try {
    await fn()
    failures++
    console.error(`  ✗ ${label}\n      expected it to be refused, but it succeeded`)
  } catch (err) {
    const e = err as api.ApiError
    const codeOk = !expectCode || e.code === expectCode
    if (codeOk) console.log(`  ✓ ${label} — "${e.message}"`)
    else {
      failures++
      console.error(`  ✗ ${label}\n      expected code ${expectCode}, got ${e.code}`)
    }
  }
}

/** Waits for a Job of `kind` on `projectId` to leave the running state. */
async function settle(projectId: string, kind: api.JobKind, timeoutMs = 20_000) {
  const started = Date.now()
  for (;;) {
    const jobs = await api.workspace.jobs()
    const job = jobs.find((j) => j.projectId === projectId && j.kind === kind)
    if (job && job.state !== 'running') return job
    if (Date.now() - started > timeoutMs) throw new Error(`${kind} Job did not settle in time`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

const project = async (id: string) => {
  const p = await api.workspace.project(id)
  if (!p) throw new Error(`no Project ${id}`)
  return p
}

async function main() {
  console.log('\nAuthentication')
  await throws('a workspace write is refused while signed out', () => api.plans.approve('p-altar'), 'unauthenticated')
  await throws('the wrong password is refused', () => api.auth.signIn('josh@nova3d.local', 'wrong'), 'invalid')
  await throws(
    'an unknown address is refused with the same message, not a different one',
    () => api.auth.signIn('nobody@example.com', 'anything'),
    'invalid',
  )
  const session = await api.auth.signIn('josh@nova3d.local', 'anything')
  ok('signing in returns a session', session.account.email === 'josh@nova3d.local')

  console.log('\nThe first gate — Plan Approval')
  let p = await project('p-altar')
  const blockers = api.plans.blockers(p)
  ok('the Plan reports a blocker while a disputed reading is undecided', blockers.length > 0, blockers.join(' '))
  ok(
    'the blocker says nova3D will not choose between defensible readings',
    blockers[0]?.includes('will not choose'),
    blockers[0],
  )
  await throws('approving the Plan is refused while it is blocked', () => api.plans.approve('p-altar'), 'conflict')

  const disputed = (await api.workspace.claims()).find((c) => c.status === 'disputed')!
  ok('the disputed Claim has two defensible options', disputed.options?.length === 2)
  ok('neither option is preselected', disputed.chosenOptionId === undefined)

  const revisionBefore = p.plan!.revision
  await api.plans.chooseOption('p-altar', disputed.id, disputed.options![0].id)
  p = await project('p-altar')
  ok('deciding it creates a new Plan revision', p.plan!.revision === revisionBefore + 1)
  ok('the Plan is now approvable', api.plans.blockers(p).length === 0)

  await api.plans.approve('p-altar')
  p = await project('p-altar')
  ok('Plan Approval is bound to the exact revision', p.planApproval.boundTo === `Revision ${p.plan!.revision}`)
  ok('approving starts generation', p.stage === 'generating')

  console.log('\nGeneration')
  const genJob = await settle('p-altar', 'generation')
  ok('the generation Job completed', genJob.state === 'completed')
  p = await project('p-altar')
  const version = api.models.current(p)!
  ok('a Version now exists', Boolean(version))
  ok('it records which Plan revision it came from', version.fromPlanRevision === p.plan!.revision)
  ok('it is not approved yet', version.approval.state === 'pending')

  console.log('\nExport and printing are gated on Model Approval')
  ok('Export reports a blocker before Model Approval', api.exports.blockers(p).length > 0)
  await api.exports.setProfile('p-altar', 'pr-a1mini')
  await throws(
    'sending a print is refused before Model Approval',
    () => api.prints.send('p-altar', 'pt-a1'),
    'conflict',
  )

  console.log('\nThe second gate — Model Approval')
  await api.models.approve('p-altar')
  p = await project('p-altar')
  ok('Model Approval is bound to the exact Version', api.models.current(p)!.approval.boundTo === `Version ${version.number}`)

  console.log('\nValidation is honest about what it does not know')
  await api.exports.validate('p-altar')
  await settle('p-altar', 'validation')
  p = await project('p-altar')
  const v = p.validation!
  ok('validation names the profile it ran against', v.profileId === 'pr-a1mini')
  ok(
    'a check that needs the unratified AD-3 rule set reports unknown, not passing',
    v.checks.some((c) => c.outcome === 'unknown'),
  )
  ok('Export is no longer blocked', api.exports.blockers(p).length === 0)

  console.log('\nThe third decision — evidence versus printability')
  await api.prints.prepare('p-altar')
  p = await project('p-altar')
  ok('preparation lists printing-only fixes', p.printingOnlyFixes.length > 0)
  ok('every printing-only fix is reversible', p.printingOnlyFixes.every((f) => 'undone' in f))
  const collision = p.collisions[0]
  ok('a collision is raised, not resolved', Boolean(collision) && collision.resolved === undefined)
  await throws('slicing is refused while the collision is open', () => api.prints.slice('p-altar'), 'conflict')

  await api.prints.resolveCollision('p-altar', collision.id, 'evidence')
  p = await project('p-altar')
  ok('the decision is recorded on the Project', p.collisions[0].resolved === 'evidence')

  await api.prints.slice('p-altar')
  await settle('p-altar', 'slice')
  p = await project('p-altar')
  const slice = (await api.workspace.slices()).find((s) => s.id === p.sliceId)!
  ok('a slice exists', Boolean(slice))
  ok('its layer count is PENDING rather than invented', isPending(slice.layers))
  ok('its duration is PENDING rather than invented', isPending(slice.duration))

  console.log('\nSending, watching, and being wrong')
  const printJob = await api.prints.send('p-altar', 'pt-a1')
  ok('the print is running', printJob.state === 'printing')
  ok('remaining time is reported as PENDING, not guessed', isPending(printJob.reportedRemaining))

  await api.prints.simulateProblem(printJob.id)
  let detections = await api.workspace.detections()
  const detection = detections.find((d) => d.printJobId === printJob.id)!
  ok('a detection pauses the print', Boolean(detection))
  ok('it carries the frames it acted on', detection.frames.length > 0)
  ok('its layer is PENDING rather than invented', isPending(detection.atLayer))

  await api.prints.resolveDetection(detection.id, 'false-alarm')
  detections = await api.workspace.detections()
  const resolved = detections.find((d) => d.id === detection.id)!
  ok('a false alarm deletes the kept frames', resolved.frames.length === 0)
  ok('a false alarm resumes the print', (await api.workspace.printJobs()).find((j) => j.id === printJob.id)?.state === 'printing')

  console.log('\nA Source rejection invalidates what leaned on it')
  const before = (await project('p-altar')).plan!.revision
  await api.plans.rejectSource('p-altar', 'src-comm-a', 'Not a primary description.')
  p = await project('p-altar')
  ok('the Source is rejected for this Project only', p.sources.find((s) => s.sourceId === 'src-comm-a')?.rejected === true)
  ok('a new Plan revision is created', p.plan!.revision > before)
  ok('Plan Approval bound to the old revision is withdrawn', p.planApproval.state === 'withdrawn')
  ok('the panel states what must be done again', (p.planApproval.mustRedo?.length ?? 0) > 0)
  ok('replacement research started automatically', (await api.workspace.jobs()).some((j) => j.kind === 'research' && j.state === 'running'))
  await settle('p-altar', 'research')

  console.log('\nThe Account-wide control is a different control')
  const settings = await api.workspace.settings()
  ok('Account-wide availability is tracked separately from per-Project rejection', settings.accountSources.length > 0)
  const stillAvailable = settings.accountSources.find((s) => s.sourceId === 'src-comm-a')?.availableToNewProjects
  ok('rejecting for a Project did not switch the Source off Account-wide', stillAvailable === true)

  console.log('\nOffline states what it cannot do')
  api.setForcedOffline(true)
  await throws('sending a print offline is refused', () => api.prints.send('p-altar', 'pt-a1'), 'offline')
  const readWorks = await api.workspace.projects()
  ok('reading still works offline', readWorks.length > 0)
  api.setForcedOffline(false)

  console.log('\nNothing invents evidence')
  const claims = await api.workspace.claims()
  const passages = claims.flatMap((c) => c.passages)
  ok('no Source passage is invented', passages.every((x) => isPending(x.original)))
  ok('no translation is invented', passages.every((x) => isPending(x.translation)))
  ok('no citation is invented', passages.every((x) => isPending(x.citation)))
  const providers = await api.workspace.providers()
  ok('no provider name is invented', providers.every((x) => isPending(x.name)))
  ok('no retention period is invented', providers.every((x) => isPending(x.retention)))
  const usage = await api.workspace.usage()
  ok('no spending figure is invented', isPending(usage.limit) && isPending(usage.spent))
  const codes = await api.workspace.invitationCodes()
  ok('no Invitation Code is ever materialised', codes.every((c) => isPending(c.code)))
  const versionFeatures = api.models.current(await project('p-altar'))!.features
  ok('no dimension is invented', versionFeatures.flatMap((f) => f.dimensions).every((d) => isPending(d.value)))

  console.log('\nUnlinking a printer loses control without stopping the machine')
  // The earlier print has finished by now, so start a fresh one — the point of
  // this check is what unlinking does to a print that is genuinely mid-run.
  const midRun = await api.prints.send('p-altar', 'pt-a1')
  ok('a print is running before the unlink', midRun.state === 'printing')
  await api.admin.unlinkPrinter('pt-a1')
  const unlinked = (await api.workspace.printers()).find((x) => x.id === 'pt-a1')!
  ok('the printer is no longer linked', unlinked.linked === false)
  ok('nova3D stopped watching it', unlinked.watching === false)
  ok('nova3D has no control over it', unlinked.controlLevel === 'none')
  const records = await api.workspace.printRecords()
  ok(
    'a Print Record states nova3D stopped knowing how the print finished',
    records.some((r) => r.cameraFindings.some((c) => c.includes('does not know how it finished'))),
  )

  console.log('\nDeleting the Workspace')
  await throws('deleting is refused while a print is running', () => api.admin.deleteWorkspace(), 'conflict')

  console.log('\nSigning out')
  await api.auth.signOut()
  ok('the session is gone', (await api.auth.session()) === null)
  await throws('writes are refused again', () => api.plans.approve('p-altar'), 'unauthenticated')

  console.log(`\n${checks - failures}/${checks} checks passed\n`)
  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error('\nflow-check crashed:', err)
  process.exit(1)
})
