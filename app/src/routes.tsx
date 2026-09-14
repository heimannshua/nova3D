/**
 * The route table.
 *
 * Routes are the product's own vocabulary, not screen IDs: `/projects/:id/plan/approve`
 * rather than `/screen/R-05`. The mapping back to `SCREEN-INVENTORY.md` is kept in
 * `docs/screen-map.md` so the inventory stays checkable without leaking IDs into
 * the address bar.
 *
 * Everything under `RequireAuth` is behind the sign-in gate. Administrator tools
 * are additionally behind `RequireAdmin`.
 */

import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/layout/AppShell'
import { AdminRecovery, PasswordReset, Register, RequireAdmin, RequireAuth, SessionEnded, SignIn } from '@/features/auth'
import { Help, Home } from '@/features/home'
import { ProjectOverview, ProjectsList, Search } from '@/features/projects'
import {
  ChooseStart,
  Coverage,
  CreateLayout,
  Describe,
  PicturePath,
  Pictures,
  ResearchChoices,
  Scope,
  StartWork,
} from '@/features/create'
import { ClaimDetail, PlanApproval, PlanRevisions, PlanWorkspace, ProjectSources } from '@/features/research'
import { CorrectionRequest, DetailStatusLegend, ModelApproval, ModelWorkspace, Versions } from '@/features/model'
import { Download, ExportOverview, RegenerationFallback, RepairView, ValidationResults } from '@/features/export'
import { BuildPlate, ChoosePrinter, CollisionDecision, Prepare, SendPrint, SliceView } from '@/features/print'
import { PrintDetail, PrintHistory, PrinterDetail, PrintersList } from '@/features/printers'
import { JobDetail, JobsList } from '@/features/jobs'
import { NotificationsList } from '@/features/notifications'
import {
  AppearanceSettings,
  DeleteSettings,
  LanguageSettings,
  NotificationSettings,
  SettingsOverview,
  SourceSettings,
  UsageSettings,
  WatchingSettings,
} from '@/features/settings'
import {
  AccountsAndLimits,
  AdminOverview,
  DataExport,
  DeleteWorkspace,
  InvitationCodes,
  PrinterLinks,
  Providers,
  SensitiveActions,
} from '@/features/admin'
import { NotFound } from '@/features/errors'

export function AppRoutes() {
  return (
    <Routes>
      {/* Public — the gate, and the ways back through it. */}
      <Route path="/signin" element={<SignIn />} />
      <Route path="/register" element={<Register />} />
      <Route path="/reset" element={<PasswordReset />} />
      <Route path="/recover" element={<AdminRecovery />} />
      <Route path="/signed-out" element={<SessionEnded />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="help" element={<Help />} />
          <Route path="search" element={<Search />} />
          <Route path="notifications" element={<NotificationsList />} />

          {/* Create — one flow, one reducer, a route per step. */}
          <Route path="create" element={<CreateLayout />}>
            <Route index element={<ChooseStart />} />
            <Route path="describe" element={<Describe />} />
            <Route path="pictures" element={<Pictures />} />
            <Route path="coverage" element={<Coverage />} />
            <Route path="picture-path" element={<PicturePath />} />
            <Route path="scope" element={<Scope />} />
            <Route path="research" element={<ResearchChoices />} />
            <Route path="start" element={<StartWork />} />
          </Route>

          <Route path="projects">
            <Route index element={<ProjectsList />} />
            <Route path=":projectId">
              <Route index element={<ProjectOverview />} />
              <Route path="sources" element={<ProjectSources />} />

              {/* Evidence, and the first gate. */}
              <Route path="plan">
                <Route index element={<PlanWorkspace />} />
                <Route path="claims/:claimId" element={<ClaimDetail />} />
                <Route path="revisions" element={<PlanRevisions />} />
                <Route path="approve" element={<PlanApproval />} />
              </Route>

              {/* Geometry, and the second gate. */}
              <Route path="model">
                <Route index element={<ModelWorkspace />} />
                <Route path="features/:featureId" element={<ModelWorkspace />} />
                <Route path="legend" element={<DetailStatusLegend />} />
                <Route path="versions" element={<Versions />} />
                <Route path="correct" element={<CorrectionRequest />} />
                <Route path="approve" element={<ModelApproval />} />
              </Route>

              {/* Validation and Export — never blocked by printing existing. */}
              <Route path="export">
                <Route index element={<ExportOverview />} />
                <Route path="validate" element={<ValidationResults />} />
                <Route path="repair" element={<RepairView />} />
                <Route path="regenerate" element={<RegenerationFallback />} />
                <Route path="download" element={<Download />} />
              </Route>

              {/* The print pipeline. */}
              <Route path="print">
                <Route index element={<ChoosePrinter />} />
                <Route path="prepare" element={<Prepare />} />
                <Route path="decision" element={<CollisionDecision />} />
                <Route path="plate" element={<BuildPlate />} />
                <Route path="slice" element={<SliceView />} />
                <Route path="send" element={<SendPrint />} />
              </Route>
            </Route>
          </Route>

          <Route path="jobs">
            <Route index element={<JobsList />} />
            <Route path=":jobId" element={<JobDetail />} />
          </Route>

          <Route path="printers">
            <Route index element={<PrintersList />} />
            <Route path=":printerId" element={<PrinterDetail />} />
          </Route>

          <Route path="prints">
            <Route path="history" element={<PrintHistory />} />
            <Route path=":printJobId" element={<PrintDetail />} />
          </Route>

          <Route path="settings">
            <Route index element={<SettingsOverview />} />
            <Route path="language" element={<LanguageSettings />} />
            <Route path="sources" element={<SourceSettings />} />
            <Route path="watching" element={<WatchingSettings />} />
            <Route path="usage" element={<UsageSettings />} />
            <Route path="notifications" element={<NotificationSettings />} />
            <Route path="delete" element={<DeleteSettings />} />
            <Route path="appearance" element={<AppearanceSettings />} />
          </Route>

          <Route path="admin" element={<RequireAdmin />}>
            <Route index element={<AdminOverview />} />
            <Route path="providers" element={<Providers />} />
            <Route path="printers" element={<PrinterLinks />} />
            <Route path="export" element={<DataExport />} />
            <Route path="delete" element={<DeleteWorkspace />} />
            <Route path="codes" element={<InvitationCodes />} />
            <Route path="security" element={<SensitiveActions />} />
            <Route path="accounts" element={<AccountsAndLimits />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
