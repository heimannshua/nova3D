# Epic 1 Context: Enter and use a private workspace

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Invited users can sign in with Google and use a responsive, private workspace, while the Administrator (Josh) controls and recovers access without ever seeing private content. The epic also lays the foundations every later epic relies on: environment identity, live authorization, tombstones, scheduled jobs, alarms, the file gateway, and external-account provisioning.

## Stories

- Story 1.1: Adopt and harden the qualified application seed
- Story 1.10: Provision external accounts, credentials and spend limits
- Story 1.2: Establish accessible localized navigation and preferences
- Story 1.3: Create invitation-only accounts
- Story 1.4: Authenticate with live workspace isolation
- Story 1.11: Manage invitations with fresh authentication
- Story 1.5: Disable and re-enable account access
- Story 1.6: Recover the sole Administrator securely
- Story 1.8: Define tombstones and the hidden-state contract
- Story 1.9: Provision staging and run periodic jobs
- Story 1.12: Transfer private files through the authorized gateway
- Story 1.13: Raise operational alarms
- Story 1.7: Navigate My Projects and project state

(Build order is the order listed, not numeric.)

## Requirements & Constraints

- Private, invite-only access: Google is the only sign-in credential, there is no public registration, and a signed-in Google identity alone is never authorization. Every private request needs a live active Account and a non-revoked session grant.
- The Administrator is one verified Google email held in server-only configuration; this role cannot impersonate users, browse Workspaces or grant more administrators. Sensitive actions need a fresh server-controlled step-up and leave append-only audit events.
- Disabling an Account revokes sessions and worker authority immediately and cancels its Jobs, but keeps its Workspace.
- Deleted or disabled targets must become unreachable at once (tombstone first, then revoke, cancel and purge).
- Infrastructure outages fail authorization closed. Rate limits count by network origin plus a global budget, never by Auth identity alone.
- Every first-version screen works on phone and desktop, in English and Hebrew (right-to-left), light and dark, to WCAG 2.2 AA.

## Technical Decisions

- Stack is pinned: Next.js 16.3.5 App Router, React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3, Supabase SSR, Node 24 (CI pins 24.21.0; `engines` allows Node 24).
- Three environments (local, staging, production) with separate Supabase projects, queues, secrets, Google OAuth clients and callback domains. Local uses the Supabase CLI stack and `APP_ENV=local` is valid only against a loopback Supabase URL. Each environment has one `instance_identity` row mirrored by `APP_ENV` and `INSTANCE_ID`, verified at startup, in CI and on every queue message.
- Auth settings (Google only, sign-ups enabled, redirect URLs, session limits) are declared in `supabase/config.toml`, pushed with the Supabase CLI, and diffed against live settings in CI. Supabase's sign-up setting stays on, because turning it off blocks all first-time Google sign-ins; the live-Account check is the gate.
- Registration, invitation, recovery and step-up run only in server routes with the service role; no such database object is executable by `anon` or `authenticated`. Codes have at least 128 bits of entropy and only their hashes are stored.
- Periodic work runs from QStash schedules or Railway cron, never Vercel cron. Large files go through a Railway gateway with live per-chunk authorization, never through a Vercel function.
- Previews hold no Supabase or Stripe credentials and have paid adapters disabled.

## UX & Interaction Patterns

- Shared shell with accessible focus, status, empty, error and confirmation patterns; every later screen inherits them. Guidance is dismissible and reopenable.
- Home offers My Projects, Create and In Progress. Project states (including conflict and locked-by-disable) are owned by the My Projects story and fed by later stories.

## Cross-Story Dependencies

- Story 1.1 comes first and creates the `instance_identity` table, the environment check and the test runners that every later story uses.
- Story 1.10 holds the Josh-only account tasks; each is tagged with the story that first needs it, so check it before starting 1.3, 1.4, 1.6 and 1.9.
- Story 1.3 owns the audit-event family and the allowlist replacement; 1.4 owns session grants and step-up; 1.5, 1.6 and 1.11 build on them.
- Stories 1.8, 1.9 and 1.12 supply the tombstone guard, the scheduler and the gateway that Epics 2 to 8 reuse.
