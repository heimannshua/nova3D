/**
 * Domain types.
 *
 * Names follow the PRD glossary exactly (prd.md §3). Where a term is capitalised
 * in the PRD it is capitalised here, because the interface copy uses the same
 * words and a rename here becomes a rename in front of the user.
 *
 * These types are the contract between the UI and the backend. They are meant to
 * survive the mock backend being replaced — nothing in this file is fixture
 * scaffolding.
 *
 * ── The honesty rule that shapes these types ────────────────────────────────
 * nova3D must never present invented evidence as researched. Anything that must
 * come from a real Source, provider, slicer or machine is typed `Verified<T>` and
 * may be `PENDING`. Rendering a PENDING prints "verified content pending" /
 * "value pending"; it cannot silently print a plausible number.
 *
 * When the real backend lands it will return PENDING for anything it has not
 * actually established. That is not a placeholder for later — it is the wire
 * format for "not known", and the UI must keep handling it.
 */

export const PENDING = Symbol.for('nova3d.pending') as symbol
export type Pending = typeof PENDING
export type Verified<T> = T | Pending
export const isPending = (v: unknown): v is Pending => v === PENDING

export type ID = string
export type ISODate = string

// ── Account and session ─────────────────────────────────────────────────────

export interface Account {
  id: ID
  email: string
  displayName: string
  isAdministrator: boolean
  disabled: boolean
}

export interface Session {
  account: Account
  /** Sensitive Administrator actions require re-authentication (D-2, NFR-2). */
  freshAuthUntil: ISODate | null
}

// ── Evidence ────────────────────────────────────────────────────────────────

export type DetailStatus = 'sourced' | 'inferred' | 'disputed' | 'unknown' | 'user-added'
export type SourceRole = 'lead' | 'accepted'

export interface Source {
  id: ID
  title: Verified<string>
  edition: Verified<string>
  retrieved: ISODate
  role: SourceRole
  authority: Verified<string>
  language: 'he' | 'en'
}

/** Per-Project exclusion (FR-43). Distinct from the Account-wide switch. */
export interface ProjectSource {
  sourceId: ID
  rejected: boolean
  rejectionReason?: string
}

export interface Passage {
  original: Verified<string>
  translation: Verified<string>
  explanation: Verified<string>
  citation: Verified<string>
  lang: 'he' | 'en'
  dir: 'rtl' | 'ltr'
}

export interface DefensibleOption {
  id: ID
  reading: string
  supportedBy: ID[]
  consequence: string
}

export interface Claim {
  id: ID
  statement: string
  status: DetailStatus
  sourceIds: ID[]
  passages: Passage[]
  /** Present only for 'inferred'. Shown in full, never summarised away. */
  reasoning?: string
  /** Present only for 'disputed'. nova3D never resolves these itself (FR-11). */
  options?: DefensibleOption[]
  /** Set when the user decides. Undefined means undecided — never a default. */
  chosenOptionId?: ID
  governingRevision: number
  consequential: boolean
  /** True while a Claim is being rechecked after losing a Source (FR-43). */
  invalidated?: boolean
}

export interface CompletenessArea {
  id: ID
  name: string
  claimIds: ID[]
  state: 'complete' | 'in-progress' | 'unknown-declared'
  declaredUnknowns: string[]
}

export interface PlanRevision {
  revision: number
  createdAt: ISODate
  /** What produced this revision, for the comparison view (R-04). */
  cause: string
  changes: { claimId: ID; was: string; now: string }[]
}

export interface ResearchPlan {
  revision: number
  areas: CompletenessArea[]
  cachedRevision?: { recorded: ISODate; identity: string }
  gapReviewPassed: boolean
  history: PlanRevision[]
}

// ── Approval ────────────────────────────────────────────────────────────────

export type ApprovalState = 'not-requested' | 'pending' | 'approved' | 'rejected' | 'withdrawn'

export interface Approval {
  kind: 'plan' | 'model'
  state: ApprovalState
  /** The exact revision or Version this is bound to (FR-13, FR-23). */
  boundTo: string
  at?: ISODate
  reason?: string
  withdrawnBecause?: string
  mustRedo?: string[]
}

// ── Geometry ────────────────────────────────────────────────────────────────

export interface ModelFeature {
  id: ID
  name: string
  status: DetailStatus
  claimIds: ID[]
  dimensions: { label: string; value: Verified<string> }[]
  governingRevision: number
}

export interface ModelVersion {
  id: ID
  number: number
  createdAt: ISODate
  origin: 'generation' | 'correction' | 'repair' | 'regeneration'
  summary: string
  supersededBy?: ID
  approval: Approval
  /** Permanent once set. No user action removes it (FR-40, SM-16). */
  imageDerived: boolean
  personalization?: string
  features: ModelFeature[]
  fromPlanRevision: number
}

// ── Projects ────────────────────────────────────────────────────────────────

export type ProjectOrigin = 'described' | 'picture-direct' | 'picture-researched'
export type SyncState = 'synced' | 'device-only' | 'pending' | 'failed' | 'conflict'

/** The stage a Project has reached. Drives what the shell offers. */
export type ProjectStage =
  | 'researching'
  | 'plan-review'
  | 'generating'
  | 'model-review'
  | 'approved'
  | 'printing'

export interface Project {
  id: ID
  name: string
  origin: ProjectOrigin
  createdAt: ISODate
  imageDerived: boolean
  stage: ProjectStage
  plan?: ResearchPlan
  planApproval: Approval
  versions: ModelVersion[]
  sources: ProjectSource[]
  sync: SyncState
  /** Set by Create. Shown back before anything runs (FR-5). */
  scope?: { subject: string; scope: string; outcome: string; personalization?: string }
  validation?: ValidationResult
  repairs: RepairRecord[]
  targetProfileId?: ID
  sliceId?: ID
  collisions: EvidenceCollision[]
  printingOnlyFixes: PrintingOnlyFix[]
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export type JobKind = 'research' | 'generation' | 'validation' | 'repair' | 'slice' | 'print'
export type JobState = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export interface Job {
  id: ID
  kind: JobKind
  state: JobState
  projectId: ID
  stage: string
  progress?: { done: number; total: number }
  startedAt: ISODate
  finishedAt?: ISODate
  cost?: { reserved: Verified<string>; settled?: Verified<string>; released?: boolean }
  cancellable: boolean
  /** The six answers every failure gives, in the same order (NFR-8). */
  failure?: {
    failedStage: string
    knownCause: string
    preserved: string
    costImpact: string
    needsReapproval: string
    retries: false
  }
  /** Sources being examined right now, with their current role (FR-8). */
  liveSourceIds?: ID[]
}

// ── Print ───────────────────────────────────────────────────────────────────

export interface TargetPrintProfile {
  id: ID
  printerId: ID
  printerName: string
  material: Verified<string>
  physicalSize: Verified<string>
  ruleSet: Verified<string>
}

export type ValidationOutcome = 'passing' | 'warning' | 'blocking' | 'unknown'

export interface ValidationResult {
  outcome: ValidationOutcome
  profileId: ID
  versionId: ID
  lastValidated: ISODate
  checks: { name: string; outcome: ValidationOutcome; detail: string }[]
}

export interface RepairRecord {
  id: ID
  detected: string
  repaired: string
  before: Verified<string>
  after: Verified<string>
  /** A substantive repair creates a Version and re-gates it (FR-27). */
  substantive: boolean
  failed?: string
}

export interface Spool {
  slot: number
  material: Verified<string>
  colorName: Verified<string>
  colorHex: Verified<string>
  /** An unreadable tag is stated, never guessed (AD-11). */
  readable: boolean
}

export interface Printer {
  id: ID
  name: string
  discovery: 'network' | 'maker-account' | 'manual'
  /** Unlinking removes nova3D's access. The machine itself is unaffected, and a
   *  print already running on it carries on without nova3D (AD-03). */
  linked: boolean
  online: boolean
  /** Two separate facts. Never conflated (NFR-14). */
  hasCamera: boolean
  watching: boolean
  controlLevel: 'full' | 'cloud-limited' | 'none'
  state: 'idle' | 'printing' | 'paused' | 'offline'
  spools: Spool[]
  upkeep: { item: string; due: 'now' | 'soon' | 'not-yet'; why: string }[]
}

export type PrintState = 'printing' | 'queued' | 'finished' | 'failed' | 'stopped' | 'paused'

export interface PrintJob {
  id: ID
  printerId: ID
  projectId: ID
  versionId: ID
  state: PrintState
  /** As reported by the printer, never as nova3D's own certainty (NFR-11). */
  reportedLayer?: { done: number; total: number }
  reportedRemaining: Verified<string>
  startedAt: ISODate
  detectionId?: ID
  failure?: {
    printerReportedReason: string
    stoppedAtLayer: Verified<string>
    materialUsed: Verified<string>
    modelUnchanged: true
    printFileKept: true
    retries: false
  }
}

export interface Slice {
  id: ID
  versionId: ID
  profileId: ID
  /** Slicer estimates, labelled as such. AD-10 decides if they are real. */
  layers: Verified<string>
  duration: Verified<string>
  material: Verified<string>
}

export interface PrintingOnlyFix {
  id: ID
  what: string
  why: string
  undone: boolean
}

/** Always a user decision. Neither option preselected (NFR-13, D-4). */
export interface EvidenceCollision {
  id: ID
  description: string
  evidenceOption: { label: string; costToReconstruction: string; costToPrint: string }
  printabilityOption: { label: string; costToReconstruction: string; costToPrint: string }
  resolved?: 'evidence' | 'printability'
}

export type DetectedCondition =
  | 'corner-lifting'
  | 'print-detached'
  | 'layer-shift'
  | 'material-stopped'
  | 'stray-material'

export interface ProblemDetection {
  id: ID
  printJobId: ID
  condition: DetectedCondition
  whatWeSaw: string
  whyItHappens: string
  howToFixNow: string
  whatWouldPreventIt: string
  frames: { id: ID; caption: string }[]
  atLayer: Verified<string>
  resolution?: 'resumed' | 'stopped' | 'false-alarm'
}

export interface PrintRecord {
  id: ID
  printJobId: ID
  projectId: ID
  versionId: ID
  profileId: ID
  outcome: 'finished' | 'failed' | 'stopped'
  materialUsed: Verified<string>
  pauses: { at: ISODate; reason: string; resumedBy: string }[]
  cameraFindings: string[]
  /** Only the user can judge this. nova3D asks rather than assuming (V-17). */
  userJudgement?: 'good' | 'not-good' | 'not-said'
}

// ── Account settings and administration ─────────────────────────────────────

export interface UsageLimit {
  limit: Verified<string>
  reserved: Verified<string>
  spent: Verified<string>
  reached: boolean
}

export interface Provider {
  id: ID
  name: Verified<string>
  purpose: string
  dataSent: string
  dataNeverSent: string
  /** A provider that cannot state retention cannot be enabled (C-07). */
  retention: Verified<string>
  maxCharge: Verified<string>
  enabled: boolean
  blockedReason?: string
}

export type NotificationCategory = 'research' | 'generation' | 'validation' | 'export' | 'print'

export interface AppNotification {
  id: ID
  category: NotificationCategory
  /** Grouped by whether a decision is needed, not by recency (J-04). */
  needsDecision: boolean
  title: string
  at: ISODate
  read: boolean
  /** An in-app route. Selecting it opens the exact item (FR-7). */
  href: string
}

export interface InvitationCode {
  id: ID
  code: Verified<string>
  state: 'unused' | 'used' | 'revoked'
  issued: ISODate
  usedBy?: string
}

export interface AuditEvent {
  id: ID
  at: ISODate
  action: string
  actor: string
}

/** Account-wide Source availability (FR-44). Distinct from per-Project rejection. */
export interface AccountSourceSetting {
  sourceId: ID
  availableToNewProjects: boolean
}

export interface AccountSettings {
  theme: 'light' | 'dark'
  textSize: 'normal' | 'large'
  contrast: 'normal' | 'high'
  motion: 'normal' | 'reduced'
  wording: 'ordinary' | 'technical'
  locale: 'en' | 'he'
  dir: 'ltr' | 'rtl'
  showFirstUseGuidance: boolean
  showDisabledSourceWarning: boolean
  watchMode: 'pause' | 'notify' | 'off'
  pushCategories: Record<NotificationCategory, boolean>
  pushPermission: 'granted' | 'denied' | 'unset'
  accountSources: AccountSourceSetting[]
}

// ── Transport ───────────────────────────────────────────────────────────────

/** Thrown by the api layer. Carries enough for NFR-8 failure copy. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unauthenticated'
      | 'forbidden'
      | 'not-found'
      | 'conflict'
      | 'offline'
      | 'rate-limited'
      | 'invalid'
      | 'server',
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
