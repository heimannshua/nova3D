/**
 * Seed data for the mock backend.
 *
 * DELETE THIS DIRECTORY when the real backend lands. Nothing outside
 * `src/api/` imports from it.
 *
 * Two rules held throughout:
 *
 * 1. No invented evidence. Every Source passage, citation, translation,
 *    dimension, provider name, retention period, charge, layer count, duration
 *    and file size is PENDING. Structural names — Model Features, completeness
 *    areas, printer capabilities, check names — are not evidence and are named
 *    normally.
 *
 * 2. No invented certainty. Printer readings are marked as reported by the
 *    machine, slice figures as slicer estimates, detections as possibly wrong.
 *
 * The seed deliberately starts the altar Project mid-flow, with one disputed
 * reading still undecided, so the gates can actually be driven: decide the
 * reading → the Plan becomes approvable → approve it → generation runs → a
 * Version appears → approve that → Export and printing unlock.
 */

import {
  PENDING,
  type Account,
  type AccountSettings,
  type AuditEvent,
  type Claim,
  type EvidenceCollision,
  type InvitationCode,
  type Job,
  type PrintJob,
  type PrintRecord,
  type Printer,
  type PrintingOnlyFix,
  type ProblemDetection,
  type Project,
  type Provider,
  type Slice,
  type Source,
  type TargetPrintProfile,
  type UsageLimit,
} from '../types'

export const NOW = '2026-09-14T09:00:00Z'

export const accounts: Account[] = [
  { id: 'acc-josh', email: 'josh@nova3d.local', displayName: 'Josh', isAdministrator: true, disabled: false },
  { id: 'acc-second', email: 'second@nova3d.local', displayName: 'Second Account', isAdministrator: false, disabled: false },
]

/** Any password is accepted except this one, which demonstrates the failure. */
export const WRONG_PASSWORD = 'wrong'

export const sources: Source[] = [
  { id: 'src-mid', title: PENDING, edition: PENDING, retrieved: '2026-06-12', role: 'accepted', authority: PENDING, language: 'he' },
  { id: 'src-comm-a', title: PENDING, edition: PENDING, retrieved: '2026-06-12', role: 'accepted', authority: PENDING, language: 'he' },
  { id: 'src-comm-b', title: PENDING, edition: PENDING, retrieved: '2026-06-13', role: 'accepted', authority: PENDING, language: 'he' },
  { id: 'src-survey', title: PENDING, edition: PENDING, retrieved: '2026-08-29', role: 'lead', authority: PENDING, language: 'en' },
  { id: 'src-secondary', title: PENDING, edition: PENDING, retrieved: '2026-08-30', role: 'lead', authority: PENDING, language: 'en' },
  { id: 'src-disabled', title: PENDING, edition: PENDING, retrieved: '2026-05-02', role: 'accepted', authority: PENDING, language: 'en' },
]

const passage = (lang: 'he' | 'en') => ({
  original: PENDING,
  translation: PENDING,
  explanation: PENDING,
  citation: PENDING,
  lang,
  dir: lang === 'he' ? ('rtl' as const) : ('ltr' as const),
})

export const claims: Claim[] = [
  {
    id: 'cl-base-width',
    statement: 'The base of the altar is square, and its width is stated in cubits.',
    status: 'sourced',
    sourceIds: ['src-mid', 'src-comm-a'],
    passages: [passage('he')],
    governingRevision: 4,
    consequential: true,
  },
  {
    id: 'cl-ramp-slope',
    statement: 'The ramp rises to the altar over a stated length, without steps.',
    status: 'sourced',
    sourceIds: ['src-mid'],
    passages: [passage('he')],
    governingRevision: 4,
    consequential: true,
  },
  {
    id: 'cl-horn-form',
    statement: 'The form of the horns at the four corners.',
    status: 'disputed',
    sourceIds: ['src-comm-a', 'src-comm-b'],
    passages: [passage('he'), passage('he')],
    governingRevision: 4,
    consequential: true,
    options: [
      {
        id: 'opt-hollow',
        reading: 'Hollow, continuous with the altar body.',
        supportedBy: ['src-comm-a'],
        consequence:
          'The corner blocks become part of one surface. Wall thickness at the corners follows the altar wall, and no separate join is modelled.',
      },
      {
        id: 'opt-solid',
        reading: 'Solid, set upon the corners.',
        supportedBy: ['src-comm-b'],
        consequence:
          'The corner blocks become separate masses with their own dimensions, and the join to the altar body becomes a described feature rather than an inferred one.',
      },
    ],
  },
  {
    id: 'cl-surround-height',
    statement: 'The height of the surrounding ledge above the base.',
    status: 'inferred',
    sourceIds: ['src-mid'],
    passages: [passage('he')],
    reasoning:
      'No Source states this height directly. It follows from the stated total height and the stated heights of the courses below it: the remainder is the ledge. The subtraction is shown because the result is only as firm as the two figures it came from, and either changing would change it.',
    governingRevision: 4,
    consequential: true,
  },
  {
    id: 'cl-surface-finish',
    statement: 'The surface treatment of the stones.',
    status: 'unknown',
    sourceIds: [],
    passages: [],
    governingRevision: 4,
    consequential: false,
  },
  {
    id: 'cl-drainage',
    statement: 'The channels that carried liquid away from the base.',
    status: 'sourced',
    sourceIds: ['src-mid', 'src-survey'],
    passages: [passage('he')],
    governingRevision: 4,
    consequential: true,
  },
  {
    id: 'cl-user-plinth',
    statement: 'A display plinth beneath the object.',
    status: 'user-added',
    sourceIds: [],
    passages: [],
    governingRevision: 4,
    consequential: false,
  },
]

export const projects: Project[] = [
  {
    id: 'p-altar',
    name: 'Outer altar and ramp',
    origin: 'described',
    createdAt: '2026-08-18T08:00:00Z',
    imageDerived: false,
    stage: 'plan-review',
    scope: {
      subject: 'The outer altar and its ramp, as described in Middot chapter 3.',
      scope: 'The altar and the ramp as one object. Not the courtyard, and not the other vessels.',
      outcome: 'A model to inspect, approve, validate and print at desk size.',
      personalization: 'A display plinth beneath the object, marked user-added.',
    },
    plan: {
      revision: 4,
      gapReviewPassed: true,
      cachedRevision: { recorded: '2026-06-12', identity: 'revision 2' },
      history: [
        {
          revision: 4,
          createdAt: '2026-08-30T11:00:00Z',
          cause: 'Research found a second reading for the corner horns.',
          changes: [
            { claimId: 'cl-horn-form', was: 'unknown', now: 'disputed' },
            { claimId: 'cl-surround-height', was: 'unknown', now: 'inferred' },
          ],
        },
        {
          revision: 3,
          createdAt: '2026-08-24T09:00:00Z',
          cause: 'Fresh research over the drainage area.',
          changes: [{ claimId: 'cl-drainage', was: 'unknown', now: 'sourced' }],
        },
      ],
      areas: [
        { id: 'ar-base', name: 'Base and footprint', claimIds: ['cl-base-width'], state: 'complete', declaredUnknowns: [] },
        { id: 'ar-courses', name: 'Courses and heights', claimIds: ['cl-surround-height'], state: 'complete', declaredUnknowns: [] },
        { id: 'ar-horns', name: 'Corners and horns', claimIds: ['cl-horn-form'], state: 'complete', declaredUnknowns: [] },
        { id: 'ar-ramp', name: 'Ramp', claimIds: ['cl-ramp-slope'], state: 'complete', declaredUnknowns: [] },
        { id: 'ar-drainage', name: 'Drainage and channels', claimIds: ['cl-drainage'], state: 'complete', declaredUnknowns: [] },
        {
          id: 'ar-surface',
          name: 'Surface and material',
          claimIds: ['cl-surface-finish'],
          state: 'unknown-declared',
          declaredUnknowns: [
            'No Source examined describes the surface treatment. nova3D has left it unknown rather than choosing one.',
          ],
        },
        {
          id: 'ar-context',
          name: 'Position in the courtyard',
          claimIds: [],
          state: 'unknown-declared',
          declaredUnknowns: ['Out of scope for this Project: the Project is the altar and its ramp.'],
        },
      ],
    },
    planApproval: { kind: 'plan', state: 'pending', boundTo: 'Revision 4' },
    versions: [],
    sources: [
      { sourceId: 'src-mid', rejected: false },
      { sourceId: 'src-comm-a', rejected: false },
      { sourceId: 'src-comm-b', rejected: false },
      { sourceId: 'src-survey', rejected: false },
      {
        sourceId: 'src-secondary',
        rejected: true,
        rejectionReason: 'Not a primary description of the structure.',
      },
    ],
    sync: 'synced',
    repairs: [],
    collisions: [],
    printingOnlyFixes: [],
  },
  {
    id: 'p-laver',
    name: 'Laver',
    origin: 'described',
    createdAt: '2026-09-05T08:00:00Z',
    imageDerived: false,
    stage: 'plan-review',
    scope: {
      subject: 'The laver and its base.',
      scope: 'The vessel and its stand.',
      outcome: 'A model to inspect and print.',
    },
    plan: {
      revision: 1,
      gapReviewPassed: false,
      history: [],
      areas: [
        { id: 'lv-form', name: 'Form and capacity', claimIds: [], state: 'in-progress', declaredUnknowns: [] },
        { id: 'lv-stand', name: 'Stand', claimIds: [], state: 'in-progress', declaredUnknowns: [] },
      ],
    },
    planApproval: {
      kind: 'plan',
      state: 'rejected',
      boundTo: 'Revision 1',
      reason: 'Two consequential details had no evidence and no declared unknown.',
    },
    versions: [],
    sources: [{ sourceId: 'src-mid', rejected: false }],
    sync: 'synced',
    repairs: [],
    collisions: [],
    printingOnlyFixes: [],
  },
  {
    id: 'p-vessel',
    name: 'Vessel from photographs',
    origin: 'picture-direct',
    createdAt: '2026-09-10T19:30:00Z',
    imageDerived: true,
    stage: 'model-review',
    planApproval: { kind: 'plan', state: 'not-requested', boundTo: '—' },
    versions: [
      {
        id: 'pv1',
        number: 1,
        createdAt: '2026-09-10T19:34:00Z',
        origin: 'generation',
        summary: 'Converted directly from four photographs.',
        approval: { kind: 'model', state: 'pending', boundTo: 'Version 1' },
        imageDerived: true,
        fromPlanRevision: 0,
        features: [
          { id: 'pf-body', name: 'Body', status: 'user-added', claimIds: [], dimensions: [{ label: 'Height', value: PENDING }], governingRevision: 0 },
          { id: 'pf-rim', name: 'Rim', status: 'user-added', claimIds: [], dimensions: [], governingRevision: 0 },
        ],
      },
    ],
    sources: [],
    sync: 'device-only',
    repairs: [],
    collisions: [],
    printingOnlyFixes: [],
  },
  {
    id: 'p-shovel',
    name: 'Shovel from photographs',
    origin: 'picture-direct',
    createdAt: '2026-09-11T07:15:00Z',
    imageDerived: true,
    stage: 'model-review',
    planApproval: { kind: 'plan', state: 'not-requested', boundTo: '—' },
    versions: [],
    sources: [],
    sync: 'conflict',
    repairs: [],
    collisions: [],
    printingOnlyFixes: [],
  },
]

export const jobs: Job[] = [
  {
    id: 'j-research-altar',
    kind: 'research',
    state: 'completed',
    projectId: 'p-altar',
    stage: 'Independent gap review recorded',
    progress: { done: 7, total: 7 },
    startedAt: '2026-08-30T08:00:00Z',
    finishedAt: '2026-08-30T11:00:00Z',
    cancellable: false,
    cost: { reserved: PENDING, settled: PENDING },
  },
  {
    id: 'j-research-laver',
    kind: 'research',
    state: 'running',
    projectId: 'p-laver',
    stage: 'Reading Sources for form and capacity',
    progress: { done: 2, total: 6 },
    startedAt: '2026-09-14T08:02:00Z',
    cost: { reserved: PENDING },
    cancellable: true,
    liveSourceIds: ['src-mid', 'src-survey', 'src-comm-b'],
  },
  {
    id: 'j-repair-failed',
    kind: 'repair',
    state: 'failed',
    projectId: 'p-vessel',
    stage: 'Repair',
    startedAt: '2026-09-12T12:00:00Z',
    finishedAt: '2026-09-12T12:04:00Z',
    cancellable: false,
    cost: { reserved: PENDING, released: true },
    failure: {
      failedStage: 'Automatic repair of a self-intersection at the rim',
      knownCause: 'The intersection spans two Model Features, so no local repair applies.',
      preserved: 'Every Version and the Source Record are unchanged.',
      costImpact: 'The reservation was released. Nothing was charged.',
      needsReapproval: 'Nothing. No geometry changed.',
      retries: false,
    },
  },
]

export const profiles: TargetPrintProfile[] = [
  {
    id: 'pr-a1mini',
    printerId: 'pt-a1',
    printerName: 'A1 mini — workshop',
    material: PENDING,
    physicalSize: PENDING,
    ruleSet: PENDING,
  },
]

export const printers: Printer[] = [
  {
    id: 'pt-a1',
    name: 'A1 mini — workshop',
    discovery: 'network',
    linked: true,
    online: true,
    hasCamera: true,
    watching: true,
    controlLevel: 'full',
    state: 'printing',
    spools: [
      { slot: 1, material: PENDING, colorName: PENDING, colorHex: PENDING, readable: true },
      { slot: 2, material: PENDING, colorName: PENDING, colorHex: PENDING, readable: true },
      { slot: 3, material: PENDING, colorName: PENDING, colorHex: PENDING, readable: false },
      { slot: 4, material: PENDING, colorName: PENDING, colorHex: PENDING, readable: true },
    ],
    upkeep: [
      { item: 'Clean the plate', due: 'now', why: 'A dirty plate is the most common reason a first layer lets go.' },
      { item: 'Check the nozzle', due: 'soon', why: 'A worn nozzle changes how much material comes out.' },
      { item: 'Lubricate the rods', due: 'not-yet', why: 'Based on how far the axes have travelled.' },
    ],
  },
  {
    id: 'pt-nocam',
    name: 'Second printer — study',
    discovery: 'maker-account',
    linked: true,
    online: true,
    hasCamera: false,
    watching: false,
    controlLevel: 'cloud-limited',
    state: 'idle',
    spools: [{ slot: 1, material: PENDING, colorName: PENDING, colorHex: PENDING, readable: true }],
    upkeep: [],
  },
  {
    id: 'pt-offline',
    name: 'Older printer — garage',
    discovery: 'manual',
    linked: true,
    online: false,
    hasCamera: false,
    watching: false,
    controlLevel: 'none',
    state: 'offline',
    spools: [],
    upkeep: [],
  },
]

export const slices: Slice[] = [
  { id: 'sl-1', versionId: 'pv1', profileId: 'pr-a1mini', layers: PENDING, duration: PENDING, material: PENDING },
]

export const printJobs: PrintJob[] = [
  {
    id: 'pj-running',
    printerId: 'pt-a1',
    projectId: 'p-vessel',
    versionId: 'pv1',
    state: 'printing',
    reportedLayer: { done: 3, total: 6 },
    reportedRemaining: PENDING,
    startedAt: '2026-09-14T07:22:00Z',
  },
  {
    id: 'pj-failed',
    printerId: 'pt-a1',
    projectId: 'p-vessel',
    versionId: 'pv1',
    state: 'failed',
    reportedRemaining: PENDING,
    startedAt: '2026-09-08T14:00:00Z',
    failure: {
      printerReportedReason: 'The printer reported that the print came loose from the plate.',
      stoppedAtLayer: PENDING,
      materialUsed: PENDING,
      modelUnchanged: true,
      printFileKept: true,
      retries: false,
    },
  },
]

export const printRecords: PrintRecord[] = [
  {
    id: 'prc-1',
    printJobId: 'pj-failed',
    projectId: 'p-vessel',
    versionId: 'pv1',
    profileId: 'pr-a1mini',
    outcome: 'failed',
    materialUsed: PENDING,
    pauses: [{ at: '2026-09-08T15:12:00Z', reason: 'nova3D detected a corner lifting.', resumedBy: 'Josh' }],
    cameraFindings: ['A corner appeared to lift. The print was paused and resumed after inspection.'],
  },
]

export const detections: ProblemDetection[] = [
  {
    id: 'pd-1',
    printJobId: 'pj-running',
    condition: 'corner-lifting',
    whatWeSaw: 'Over the last few layers, a corner of the base appears to be rising away from the plate.',
    whyItHappens:
      'A corner lifts when the first layers cool and shrink faster than they can hold on to the plate. It is the most common way a print of this shape fails.',
    howToFixNow:
      'Look at the corner. If it has lifted, stop the print and start again with a wider brim and a cleaner plate. If it looks flat, this was a false alarm.',
    whatWouldPreventIt: 'A wider brim, a clean plate, and keeping the room free of draughts for the first layers.',
    frames: [
      { id: 'fr-1', caption: 'The corner as it was several layers earlier, flat against the plate.' },
      { id: 'fr-2', caption: 'The same corner now, which is what nova3D acted on.' },
    ],
    atLayer: PENDING,
  },
]

export const collisionTemplate: EvidenceCollision = {
  id: 'col-wall',
  description:
    'The altar wall at the corners is thinner than this printer can produce at the chosen physical size. One of the two has to give, and nova3D will not choose.',
  evidenceOption: {
    label: 'Keep the evidence-backed thickness',
    costToReconstruction: 'Nothing changes. The reconstruction stays exactly as approved.',
    costToPrint: 'The corners may print incompletely or not at all. The printer cannot produce a wall this thin at this size.',
  },
  printabilityOption: {
    label: 'Thicken the wall to what this printer can produce',
    costToReconstruction:
      'The corner wall stops matching the evidence-backed dimension. The change is recorded in the Source Record and the affected Model Feature is marked.',
    costToPrint: 'The corners print.',
  },
}

export const printingOnlyFixTemplate: PrintingOnlyFix[] = [
  { id: 'fx-orient', what: 'Turned the model so the ramp lies along the plate.', why: 'Reduces the overhang that would otherwise need support against a described surface.', undone: false },
  { id: 'fx-support', what: 'Added support beneath the ramp underside.', why: 'The underside prints over air. Support is removed after printing and is not part of the object.', undone: false },
  { id: 'fx-brim', what: 'Added a brim around the base.', why: 'Holds the first layer down. Trimmed off after printing.', undone: false },
  { id: 'fx-plate', what: 'Moved the model to the centre of the plate.', why: 'Placement only. Nothing about the object changes.', undone: false },
]

export const usage: UsageLimit = { limit: PENDING, reserved: PENDING, spent: PENDING, reached: false }

export const providers: Provider[] = [
  {
    id: 'pv-1',
    name: PENDING,
    purpose: 'Searching and retrieving Sources that are not openly available.',
    dataSent: 'The subject of the Project, and the question being researched.',
    dataNeverSent: 'Your Account identity, your Project names, your decisions, or any picture you uploaded.',
    retention: PENDING,
    maxCharge: PENDING,
    enabled: true,
  },
  {
    id: 'pv-2',
    name: PENDING,
    purpose: 'Translation of Source passages.',
    dataSent: 'The passage being translated.',
    dataNeverSent: 'Your Account identity or your Project names.',
    retention: PENDING,
    maxCharge: PENDING,
    enabled: false,
    blockedReason: 'This provider has not stated how long it keeps what it receives. It cannot be enabled until it does.',
  },
]

export const notifications = [
  {
    id: 'n-1',
    category: 'print' as const,
    needsDecision: true,
    title: 'A print was paused — nova3D thinks a corner is lifting',
    at: '2026-09-14T08:40:00Z',
    read: false,
    href: '/prints/pj-running',
  },
  {
    id: 'n-2',
    category: 'research' as const,
    needsDecision: true,
    title: 'A disputed reading needs your decision before the Plan can be approved',
    at: '2026-09-14T08:12:00Z',
    read: false,
    href: '/projects/p-altar/plan/claims/cl-horn-form',
  },
  {
    id: 'n-3',
    category: 'research' as const,
    needsDecision: false,
    title: 'Research finished for Outer altar and ramp',
    at: '2026-08-30T11:00:00Z',
    read: true,
    href: '/jobs/j-research-altar',
  },
]

export const invitationCodes: InvitationCode[] = [
  { id: 'ic-1', code: PENDING, state: 'unused', issued: '2026-09-01' },
  { id: 'ic-2', code: PENDING, state: 'used', issued: '2026-08-12', usedBy: 'Josh' },
  { id: 'ic-3', code: PENDING, state: 'revoked', issued: '2026-07-30' },
]

export const auditEvents: AuditEvent[] = [
  { id: 'ae-1', at: '2026-09-14T08:40:00Z', action: 'A print was paused automatically after the camera detected a possible corner lift.', actor: 'nova3D' },
  { id: 'ae-2', at: '2026-08-30T11:00:00Z', action: 'Research finished for Outer altar and ramp, producing Plan revision 4.', actor: 'nova3D' },
  { id: 'ae-3', at: '2026-08-30T09:14:00Z', action: 'A Source was rejected for the Outer altar and ramp Project.', actor: 'Josh' },
]

export const defaultSettings: AccountSettings = {
  theme: 'light',
  textSize: 'normal',
  contrast: 'normal',
  motion: 'normal',
  wording: 'ordinary',
  locale: 'en',
  dir: 'ltr',
  showFirstUseGuidance: true,
  showDisabledSourceWarning: true,
  watchMode: 'pause',
  pushCategories: { research: true, generation: true, validation: false, export: true, print: true },
  pushPermission: 'granted',
  accountSources: sources.map((s) => ({ sourceId: s.id, availableToNewProjects: s.id !== 'src-disabled' })),
}

/** Model Features produced by generation, once a Plan is approved. */
export const generatedFeatures = [
  { id: 'ft-base', name: 'Base', status: 'sourced' as const, claimIds: ['cl-base-width'], dimensions: [{ label: 'Width', value: PENDING }, { label: 'Depth', value: PENDING }] },
  { id: 'ft-surround', name: 'Surrounding ledge', status: 'inferred' as const, claimIds: ['cl-surround-height'], dimensions: [{ label: 'Height above base', value: PENDING }] },
  { id: 'ft-horns', name: 'Horns', status: 'sourced' as const, claimIds: ['cl-horn-form'], dimensions: [{ label: 'Corner block', value: PENDING }] },
  { id: 'ft-ramp', name: 'Ramp', status: 'sourced' as const, claimIds: ['cl-ramp-slope'], dimensions: [{ label: 'Length', value: PENDING }, { label: 'Rise', value: PENDING }] },
  { id: 'ft-drainage', name: 'Drainage channels', status: 'sourced' as const, claimIds: ['cl-drainage'], dimensions: [] },
  { id: 'ft-surface', name: 'Stone surface', status: 'unknown' as const, claimIds: ['cl-surface-finish'], dimensions: [] },
  { id: 'ft-plinth', name: 'Display plinth', status: 'user-added' as const, claimIds: ['cl-user-plinth'], dimensions: [{ label: 'Height', value: PENDING }] },
]

export const validationChecks = [
  { name: 'Watertight geometry', outcome: 'passing' as const, detail: 'No holes found.' },
  { name: 'Self-intersection', outcome: 'passing' as const, detail: 'None found.' },
  {
    name: 'Minimum wall thickness for this profile',
    outcome: 'warning' as const,
    detail: 'The corner wall is below what this profile can produce. This is the collision nova3D asks about before printing.',
  },
  { name: 'Fits the build volume at the chosen physical size', outcome: 'passing' as const, detail: 'Fits.' },
  {
    name: 'Unsupported overhang',
    outcome: 'warning' as const,
    detail: 'The ramp underside prints over air. Support is a printing-only fix and does not change the object.',
  },
  {
    name: 'Feature-size floor',
    outcome: 'unknown' as const,
    detail:
      'This check needs the ratified rule set for this printer profile, which does not exist yet (AD-3). nova3D reports it as unknown rather than passing it.',
  },
]

export const repairTemplates = [
  { id: 'rp-1', detected: 'Two holes where the ramp meets the altar body.', repaired: 'Closed both, following the surrounding surface.', before: PENDING, after: PENDING, substantive: false },
]
