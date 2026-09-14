/**
 * Workspace store.
 *
 * Holds everything the signed-in Account can see, refetched whenever the backend
 * reports a change. Features read through the hooks at the bottom and never
 * import from `src/api/mock/`.
 *
 * The refetch-on-change shape is deliberate: it is what a real client does with
 * a websocket or a poll, so replacing the mock backend does not change this file
 * beyond removing the `subscribe` import.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import * as api from '@/api'
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
} from '@/api'

interface WorkspaceData {
  session: Session | null
  projects: Project[]
  claims: Claim[]
  sources: Source[]
  jobs: Job[]
  printers: Printer[]
  profiles: TargetPrintProfile[]
  slices: Slice[]
  printJobs: PrintJob[]
  printRecords: PrintRecord[]
  detections: ProblemDetection[]
  notifications: AppNotification[]
  settings: AccountSettings
  usage: UsageLimit
  providers: Provider[]
  invitationCodes: InvitationCode[]
  auditEvents: AuditEvent[]
  accounts: { id: ID; email: string; displayName: string; isAdministrator: boolean; disabled: boolean }[]
}

interface Ctx extends WorkspaceData {
  loading: boolean
  offline: boolean
  setOffline: (v: boolean) => void
  reload: () => Promise<void>
}

const WorkspaceContext = createContext<Ctx | null>(null)

const EMPTY: WorkspaceData = {
  session: null,
  projects: [],
  claims: [],
  sources: [],
  jobs: [],
  printers: [],
  profiles: [],
  slices: [],
  printJobs: [],
  printRecords: [],
  detections: [],
  notifications: [],
  settings: {
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
    pushCategories: { research: true, generation: true, validation: true, export: true, print: true },
    pushPermission: 'granted',
    accountSources: [],
  },
  usage: { limit: api.PENDING, reserved: api.PENDING, spent: api.PENDING, reached: false },
  providers: [],
  invitationCodes: [],
  auditEvents: [],
  accounts: [],
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<WorkspaceData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [offline, setOfflineState] = useState(false)

  const reload = useCallback(async () => {
    const [
      session,
      projects,
      claims,
      sources,
      jobs,
      printers,
      profiles,
      slices,
      printJobs,
      printRecords,
      detections,
      notifications,
      settings,
      usage,
      providers,
      invitationCodes,
      auditEvents,
      accounts,
    ] = await Promise.all([
      api.auth.session(),
      api.workspace.projects(),
      api.workspace.claims(),
      api.workspace.sources(),
      api.workspace.jobs(),
      api.workspace.printers(),
      api.workspace.profiles(),
      api.workspace.slices(),
      api.workspace.printJobs(),
      api.workspace.printRecords(),
      api.workspace.detections(),
      api.workspace.notifications(),
      api.workspace.settings(),
      api.workspace.usage(),
      api.workspace.providers(),
      api.workspace.invitationCodes(),
      api.workspace.auditEvents(),
      api.workspace.accounts(),
    ])
    setData({
      session,
      projects,
      claims,
      sources,
      jobs,
      printers,
      profiles,
      slices,
      printJobs,
      printRecords,
      detections,
      notifications,
      settings,
      usage,
      providers,
      invitationCodes,
      auditEvents,
      accounts,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
    // Backend change notifications. With a real backend this is a socket.
    const unsubscribe = api.subscribe(() => {
      void reload()
    })
    return () => {
      unsubscribe()
    }
  }, [reload])

  const setOffline = useCallback(
    (v: boolean) => {
      api.setForcedOffline(v)
      setOfflineState(v)
    },
    [],
  )

  // Account Settings drive the document: theme, direction, language and the
  // three accessibility preferences (FR-45, FR-47, NFR-18).
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', data.settings.theme)
    root.setAttribute('data-text-size', data.settings.textSize)
    root.setAttribute('data-contrast', data.settings.contrast)
    root.setAttribute('data-motion', data.settings.motion)
    root.setAttribute('dir', data.settings.dir)
    root.setAttribute('lang', data.settings.locale)
  }, [data.settings])

  const value = useMemo<Ctx>(
    () => ({ ...data, loading, offline, setOffline, reload }),
    [data, loading, offline, setOffline, reload],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}

// ── Selectors ───────────────────────────────────────────────────────────────

export function useSession() {
  return useWorkspace().session
}

export function useSettings() {
  return useWorkspace().settings
}

export function useProject(id: ID | undefined) {
  const { projects } = useWorkspace()
  return projects.find((p) => p.id === id)
}

export function useClaim(id: ID | undefined) {
  const { claims } = useWorkspace()
  return claims.find((c) => c.id === id)
}

export function useClaims(ids: ID[]) {
  const { claims } = useWorkspace()
  return ids.map((id) => claims.find((c) => c.id === id)).filter((c): c is Claim => Boolean(c))
}

export function useSource(id: ID | undefined) {
  const { sources } = useWorkspace()
  return sources.find((s) => s.id === id)
}

export function useProjectJobs(projectId: ID | undefined) {
  const { jobs } = useWorkspace()
  return jobs.filter((j) => j.projectId === projectId)
}

export function useActiveJobs() {
  const { jobs } = useWorkspace()
  return jobs.filter((j) => j.state === 'running' || j.state === 'waiting')
}

export function useUnreadCount() {
  const { notifications } = useWorkspace()
  return notifications.filter((n) => !n.read).length
}

export function usePrinter(id: ID | undefined) {
  const { printers } = useWorkspace()
  return printers.find((p) => p.id === id)
}

export function usePrintJob(id: ID | undefined) {
  const { printJobs } = useWorkspace()
  return printJobs.find((p) => p.id === id)
}

export function useLivePrints() {
  const { printJobs } = useWorkspace()
  return printJobs.filter((p) => p.state === 'printing' || p.state === 'paused' || p.state === 'queued')
}

/** The current Version of a Project, or undefined before generation. */
export function useCurrentVersion(project: Project | undefined) {
  return project ? api.models.current(project) : undefined
}
