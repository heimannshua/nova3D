# Screen inventory → routes

The UX spine numbers screens (`R-05`, `M-09`, `X-06`). The application uses its own
vocabulary in the address bar, because a URL is user-facing and `/screen/R-05` is not
a place anyone would describe themselves as being.

This table keeps the two checkable against each other. Source of truth for the IDs:
`_bmad-output/planning-artifacts/ux-designs/ux-nova3D-2026-08-27/SCREEN-INVENTORY.md`
(80 screens: 64 from the Claude Design mockups, 16 added by the reconciliation
appendix and marked **added** below — this application is their first visual).

| ID | Screen | Route |
| --- | --- | --- |
| C-01 | Choose how to start | `/create` |
| C-02 | Describe the subject | `/create/describe` |
| C-03 | Upload pictures | `/create/pictures` |
| C-04 | What the pictures show | `/create/coverage` |
| C-05 | Picture path choice | `/create/picture-path` |
| C-06 | Confirm the scope | `/create/scope` |
| C-07 | Research and cache choices | `/create/research` |
| C-08 | Research started | `/create/start` |
| R-01 | The Plan, area by area | `/projects/:id/plan` |
| R-02 | A Claim and its Sources | `/projects/:id/plan/claims/:claimId` |
| R-03 | A disputed reading | `/projects/:id/plan/claims/:claimId` (disputed state) |
| R-04 | Revision comparison | `/projects/:id/plan/revisions` |
| R-05 | **Plan Approval** | `/projects/:id/plan/approve` |
| M-01 | Model workspace | `/projects/:id/model` |
| M-02 | Feature evidence | `/projects/:id/model/features/:featureId` |
| M-03 | Versions | `/projects/:id/model/versions` |
| M-04 | Inspection tools | `/projects/:id/model` (viewport controls) |
| M-05 | Detail Status legend | `/projects/:id/model/legend` |
| M-06 | Report a problem | `/projects/:id/model/correct` |
| M-07 | Repair | `/projects/:id/export/repair` |
| M-08 | Sources in this Project | `/projects/:id/sources` |
| M-09 | **Model Approval** | `/projects/:id/model/approve` |
| V-01 | Choose the printer | `/projects/:id/print` |
| V-02 | Prepare the model | `/projects/:id/print/prepare` |
| V-03 | **Evidence vs printability** | `/projects/:id/print/decision` |
| V-04 | Arrange the build plate | `/projects/:id/print/plate` |
| V-05 | Slice | `/projects/:id/print/slice` |
| V-06 | Send and print | `/projects/:id/print/send` |
| V-07 | Printer control and camera | `/printers/:printerId` (Print and camera) |
| V-08 | Problem found | `/prints/:printJobId` (detection raised) |
| V-09 | Full printer control | `/printers/:printerId` (Machine) |
| V-10 | Printers and queue | `/printers` |
| V-11 | Colours across the model | `/projects/:id/print/slice` (spool assignment) |
| V-12 | What this print will cost | `/projects/:id/print/slice` |
| V-13 | Print history and reprinting | `/prints/history` |
| V-14 | Timelapse | `/prints/:printJobId` (Timelapse) |
| V-15 | Recovering a failed print | `/prints/:printJobId` (failed state) |
| V-16 | Machine upkeep | `/printers/:printerId` (Upkeep) |
| V-17 | Print finished | `/prints/:printJobId` (finished state) |
| X-01 | Target Print Profile — **added** | `/projects/:id/export` |
| X-02 | Validation results — **added** | `/projects/:id/export/validate` |
| X-03 | Automatic repair — **added** | `/projects/:id/export/repair` |
| X-04 | Full regeneration fallback — **added** | `/projects/:id/export/regenerate` |
| X-05 | Export readiness — **added** | `/projects/:id/export/download` (blocked state) |
| X-06 | Export download — **added** | `/projects/:id/export/download` |
| H-01 | Home | `/` |
| H-02 | My Projects | `/projects` |
| H-03 | Project overview | `/projects/:id` |
| H-04 | Search | `/search` |
| J-01 | In Progress | `/jobs` |
| J-02 | Job detail | `/jobs/:jobId` |
| J-03 | Job failure | `/jobs/:jobId` (failed state) |
| J-04 | Notifications | `/notifications` |
| J-05 | Offline and sync | `/projects/:id` (conflict) + the Offline control in the top bar |
| J-06 | Sources during a running Job — **added** | `/jobs/:jobId` (running research) |
| A-01 | Sign in | `/signin` |
| A-02 | Password reset | `/reset` |
| A-03 | Session ended | `/signed-out` |
| A-04 | Invitation registration — **added** | `/register` |
| A-05 | Administrator recovery — **added** | `/recover` |
| G-01 | Application shell — dark mode | any route, `/settings/appearance` → Dark |
| G-02 | Application shell — RTL | any route, `/settings/language` → Right to left |
| G-03 | Errors and empty states | any unknown route; `RequireAdmin` refusal; router error boundary |
| G-04 | First-use guidance — **added** | `/help` |
| S-01 | Settings overview | `/settings` |
| S-02 | Language, direction, wording | `/settings/language` |
| S-03 | Sources available to new Projects | `/settings/sources` |
| S-04 | Watching prints | `/settings/watching` |
| S-05 | Usage Limit and spending | `/settings/usage` |
| S-06 | Notification categories — **added** | `/settings/notifications` |
| S-07 | Delete a Project or this Account — **added** | `/settings/delete` |
| S-08 | Appearance and accessibility — **added** | `/settings/appearance` |
| AD-01 | Administrator overview | `/admin` |
| AD-02 | Paid research providers | `/admin/providers` |
| AD-03 | Printers and links | `/admin/printers` |
| AD-04 | Data export | `/admin/export` |
| AD-05 | Delete the Workspace | `/admin/delete` |
| AD-06 | Invitation Codes — **added** | `/admin/codes` |
| AD-07 | Sensitive actions and audit — **added** | `/admin/security` |
| AD-08 | Accounts and limits — **added** | `/admin/accounts` |

## Where several IDs share a route

The inventory numbers *states* as well as screens. Where an ID is a state of another
screen rather than a separate destination, it shares that route and the state is
reached by doing the thing that causes it — a failed Job, a raised detection, a
superseded Version. That is deliberate: a state you can only reach by typing a URL is
a state nobody will ever see in the product.
