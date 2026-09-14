/**
 * The API surface. Features import from here and from nowhere else under
 * `src/api/`.
 *
 * Every function is async and returns domain types from `./types`. Reads return
 * snapshots; writes return void or the created entity and the store refetches.
 * That is deliberately how a real client behaves, so swapping the mock backend
 * for HTTP does not change a single call site.
 *
 * `needsConnection` marks the calls that genuinely require the network, from
 * the offline capability table (NFR-19). Reading, inspection, both approval
 * gates and slicing work offline. Research, sending a print, watching and sync
 * do not, and say so.
 */

import * as be from './mock/backend'
import { request } from './client'
import type {
  AccountSettings,
  AppNotification,
  AuditEvent,
  Claim,
  ID,
  InvitationCode,
  Job,
  PrintJob,
  PrintRecord,
  Printer,
  ProblemDetection,
  Project,
  Provider,
  Session,
  Slice,
  Source,
  TargetPrintProfile,
  UsageLimit,
} from './types'

export * from './types'
export { setForcedOffline, isOffline } from './client'
export { subscribe, getVersion } from './mock/backend'

// ── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  session: () => request<Session | null>(() => be.db.session),
  signIn: (email: string, password: string) =>
    request<Session>(() => be.signIn(email, password), { needsConnection: true, delayMs: 420 }),
  signOut: () => request<void>(() => be.signOut()),
  register: (code: string, email: string) =>
    request<Session>(() => be.register(code, email), { needsConnection: true, delayMs: 520 }),
  reauthenticate: (password: string) =>
    request<void>(() => be.reauthenticate(password), { needsConnection: true, delayMs: 380 }),
  hasFreshAuth: () => be.hasFreshAuth(),
  /** Never confirms whether an address has an Account here (A-02). */
  requestPasswordReset: (_email: string) => request<void>(() => undefined, { needsConnection: true, delayMs: 500 }),
  requestAdminRecovery: () => request<void>(() => undefined, { needsConnection: true, delayMs: 500 }),
}

// ── Workspace reads ─────────────────────────────────────────────────────────

export const workspace = {
  projects: () => request<Project[]>(() => be.db.projects),
  project: (id: ID) => request<Project | undefined>(() => be.db.projects.find((p) => p.id === id)),
  claims: () => request<Claim[]>(() => be.db.claims),
  sources: () => request<Source[]>(() => be.db.sources),
  jobs: () => request<Job[]>(() => be.db.jobs),
  printers: () => request<Printer[]>(() => be.db.printers),
  profiles: () => request<TargetPrintProfile[]>(() => be.db.profiles),
  slices: () => request<Slice[]>(() => be.db.slices),
  printJobs: () => request<PrintJob[]>(() => be.db.printJobs),
  printRecords: () => request<PrintRecord[]>(() => be.db.printRecords),
  detections: () => request<ProblemDetection[]>(() => be.db.detections),
  notifications: () => request<AppNotification[]>(() => be.db.notifications),
  settings: () => request<AccountSettings>(() => be.db.settings),
  usage: () => request<UsageLimit>(() => be.db.usage),
  providers: () => request<Provider[]>(() => be.db.providers),
  invitationCodes: () => request<InvitationCode[]>(() => be.db.invitationCodes),
  auditEvents: () => request<AuditEvent[]>(() => be.db.auditEvents),
  accounts: () => request(() => be.db.accounts),
}

// ── Projects ────────────────────────────────────────────────────────────────

export const projects = {
  create: (input: Parameters<typeof be.createProject>[0]) =>
    request<Project>(() => be.createProject(input), { delayMs: 320 }),
  remove: (id: ID) => request<void>(() => be.deleteProject(id), { delayMs: 400 }),
  resolveSyncConflict: (id: ID, keep: 'device' | 'account') =>
    request<void>(() => be.resolveSyncConflict(id, keep), { needsConnection: true }),
}

// ── The Research Plan ───────────────────────────────────────────────────────

export const plans = {
  /** Why the gate is closed, in the user's words. Empty means it is open. */
  blockers: (p: Project) => be.planBlockers(p),
  chooseOption: (projectId: ID, claimId: ID, optionId: ID) =>
    request<void>(() => be.chooseClaimOption(projectId, claimId, optionId), { delayMs: 300 }),
  rejectSource: (projectId: ID, sourceId: ID, reason: string) =>
    request<void>(() => be.rejectProjectSource(projectId, sourceId, reason), { delayMs: 300 }),
  approve: (projectId: ID) => request<void>(() => be.approvePlan(projectId), { delayMs: 380 }),
  reject: (projectId: ID, reason: string) => request<void>(() => be.rejectPlan(projectId, reason), { delayMs: 320 }),
}

// ── The model ───────────────────────────────────────────────────────────────

export const models = {
  blockers: (p: Project) => be.modelBlockers(p),
  current: (p: Project) => be.currentVersion(p),
  approve: (projectId: ID) => request<void>(() => be.approveModel(projectId), { delayMs: 380 }),
  reject: (projectId: ID, reason: string) => request<void>(() => be.rejectModel(projectId, reason), { delayMs: 320 }),
  requestCorrection: (projectId: ID, featureId: ID, description: string) =>
    request<void>(() => be.requestCorrection(projectId, featureId, description), { needsConnection: true, delayMs: 320 }),
  restoreVersion: (projectId: ID, versionId: ID) =>
    request<void>(() => be.restoreVersion(projectId, versionId), { delayMs: 400 }),
}

// ── Validation and Export ───────────────────────────────────────────────────

export const exports = {
  blockers: (p: Project) => be.exportBlockers(p),
  setProfile: (projectId: ID, profileId: ID) => request<void>(() => be.setTargetProfile(projectId, profileId)),
  validate: (projectId: ID) => request<void>(() => be.runValidation(projectId), { delayMs: 300 }),
  repair: (projectId: ID) => request<void>(() => be.runRepair(projectId), { delayMs: 300 }),
}

// ── Print ───────────────────────────────────────────────────────────────────

export const prints = {
  prepare: (projectId: ID) => request<void>(() => be.preparePrint(projectId)),
  toggleFix: (projectId: ID, fixId: ID) => request<void>(() => be.toggleFix(projectId, fixId), { delayMs: 120 }),
  resolveCollision: (projectId: ID, collisionId: ID, choice: 'evidence' | 'printability') =>
    request<void>(() => be.resolveCollision(projectId, collisionId, choice), { delayMs: 260 }),
  slice: (projectId: ID) => request<void>(() => be.sliceModel(projectId), { delayMs: 300 }),
  send: (projectId: ID, printerId: ID) =>
    request<PrintJob>(() => be.sendPrint(projectId, printerId), { needsConnection: true, delayMs: 500 }),
  control: (printJobId: ID, action: 'pause' | 'resume' | 'stop') =>
    request<void>(() => be.controlPrint(printJobId, action), { needsConnection: true, delayMs: 260 }),
  /** Stands in for the detector until AD-9 exists. Demonstrates the alert path. */
  simulateProblem: (printJobId: ID) => request<void>(() => be.raiseDetection(printJobId), { delayMs: 200 }),
  resolveDetection: (detectionId: ID, resolution: 'resumed' | 'stopped' | 'false-alarm') =>
    request<void>(() => be.resolveDetection(detectionId, resolution), { needsConnection: true, delayMs: 300 }),
  setJudgement: (printRecordId: ID, judgement: PrintRecord['userJudgement']) =>
    request<void>(() => be.setPrintJudgement(printRecordId, judgement)),
  setWatching: (printerId: ID, watching: boolean) =>
    request<void>(() => be.setWatching(printerId, watching), { needsConnection: true }),
}

// ── Jobs and notifications ──────────────────────────────────────────────────

export const jobs = {
  cancel: (id: ID) => request<void>(() => be.cancelJob(id), { delayMs: 260 }),
}

export const notifications = {
  markRead: (id: ID) => request<void>(() => be.markNotificationRead(id), { delayMs: 80 }),
  markAllRead: () => request<void>(() => be.markAllNotificationsRead(), { delayMs: 120 }),
}

// ── Settings and administration ─────────────────────────────────────────────

export const settings = {
  update: (patch: Partial<AccountSettings>) => request<void>(() => be.updateSettings(patch), { delayMs: 80 }),
  setSourceAvailable: (sourceId: ID, available: boolean) =>
    request<void>(() => be.setAccountSourceAvailable(sourceId, available), { delayMs: 220 }),
}

export const admin = {
  issueCode: () => request<InvitationCode>(() => be.issueInvitationCode(), { needsConnection: true, delayMs: 320 }),
  revokeCode: (id: ID) => request<void>(() => be.revokeInvitationCode(id), { needsConnection: true, delayMs: 280 }),
  setProviderEnabled: (id: ID, enabled: boolean) =>
    request<void>(() => be.setProviderEnabled(id, enabled), { needsConnection: true, delayMs: 280 }),
  setAccountDisabled: (accountId: ID, disabled: boolean) =>
    request<void>(() => be.setAccountDisabled(accountId, disabled), { needsConnection: true, delayMs: 320 }),
  revokeAllSessions: () => request<void>(() => be.revokeAllAdminSessions(), { needsConnection: true, delayMs: 380 }),
  unlinkPrinter: (printerId: ID) =>
    request<void>(() => be.unlinkPrinter(printerId), { needsConnection: true, delayMs: 340 }),
  deleteWorkspace: () => request<void>(() => be.deleteWorkspace(), { needsConnection: true, delayMs: 520 }),
}

/** Mock-backend only. Remove with `src/api/mock/`. */
export const devtools = {
  reset: () => be.resetDb(),
}
