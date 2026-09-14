# nova3D stack compatibility qualification

Date: 2026-09-14 UTC
Status: **PASS** for the clean exact-version stack probe. An earlier manually
symlinked/copy-staged harness failed; that failure is retained separately as a
non-clean staging result. The exact cause of that difference is not established.

This is a minimal framework compatibility probe, not nova3D application,
authentication, job, persistence, provider, deployment, or production-service
qualification. No credentials, provider calls, or external services were used.

## Exact versions and setup

Pinned versions exercised:

```text
Node v24.21.0
next 16.3.5
react 19.3.0
react-dom 19.3.0
typescript 5.9.3
tailwindcss 4.3.3
@tailwindcss/postcss 4.3.3
@supabase/supabase-js 2.116.0
@supabase/ssr 0.12.7
@upstash/workflow 1.3.3
@upstash/redis 1.38.4
```

Reproducible setup:

```text
cd /home/josh/repos/nova3D
NOVA3D_STACK_CACHE=/home/josh/.cache/nova3d-qualification-20260914/stack \
  ./tools/qualification/stack/setup-stack.sh
```

One-command verifier (fresh run root, `npm ci`, typecheck, production build,
loopback production smoke and cleanup):

```text
NOVA3D_STACK_CACHE=/home/josh/.cache/nova3d-qualification-20260914/stack \
  ./tools/qualification/stack/verify-stack.sh
```

The script stages the checked-in source into the isolated cache and installs
dependencies there. The preserved lockfile is
[`package-lock.json`](package-lock.json). The source and setup script are under
[`tools/qualification/stack`](../../../../tools/qualification/stack).

Production checks used `NODE_ENV=production NEXT_TELEMETRY_DISABLED=1`. The
runtime log records only relevant framework variable names and package/path
identity, never environment values or secrets. The clean project had one local
React/React-DOM resolution and no parent lockfile/module tree.

## Results

| Check | Command / input | Result | Status |
| --- | --- | --- | --- |
| Exact dependency install | `setup-stack.sh` uses checked-in `package-lock.json` with `npm ci` in a fresh isolated run root | All requested versions installed; no secrets/provider calls | PASS |
| Real package imports | Full App Router page imports Supabase client/SSR, Upstash Redis and Workflow `serve` bindings | TypeScript resolved all imports; rendered route reported `workflowBinding: "function"` | PASS |
| TypeScript | `node .../typescript/bin/tsc --noEmit -p tsconfig.json` | Exit 0, TypeScript 5.9.3 | PASS |
| Tailwind/PostCSS | `@import "tailwindcss"` processed during Next compilation | Compilation succeeded in both builders | PASS |
| Clean minimal production build, default | `NODE_ENV=production ... next build` | Bare App Router page/layout compiled, typechecked and prerendered successfully | PASS |
| Clean minimal production build, Webpack | `NODE_ENV=production ... next build --webpack` | Same exact package set passed | PASS |
| Clean intended production build, default | Full checked-in page with Supabase/SSR, Redis and Workflow imports | Compiled, typechecked and prerendered successfully | PASS |
| Clean intended production build, Webpack | Same full source with `next build --webpack` | Compiled, typechecked and prerendered successfully | PASS |
| Loopback development HTTP smoke | `next dev --hostname 127.0.0.1 --port <ephemeral>`; `GET /`, `GET /api/workflow` | Both HTTP 200; marker present; route returned `{"workflowBinding":"function","providerCall":false}` | PASS |
| Loopback production HTTP smoke | `next start --hostname 127.0.0.1 --port <ephemeral>`; `GET /`, `GET /api/workflow` | Both retained response headers report HTTP 200; bodies and assertions are preserved; workflow body was `{"workflowBinding":"function","providerCall":false}` | PASS |
| Verifier assertions | `verify-stack.sh` | Setup, typecheck, production build, both route checks and overall assertion all logged PASS | PASS |
| Earlier symlinked/copy-staged harness | Project-local `node_modules` symlink pointed outside Turbopack root; copied-parent staging differed from the clean run | Original logs retain `Expected workStore` prerender failure; clean baseline does not reproduce it; exact cause is not established | FAIL (non-clean staging) |

The bounded compatibility attempt included the same-version Webpack builder and
a minimal checked-in `app/global-error.tsx` boundary. The non-clean staging
failed, while the fresh clean baseline and full intended source both pass; no
ratified dependency was silently changed.

Raw logs:

- [`install.log`](install.log)
- [`typecheck.log`](typecheck.log)
- [`clean-runtime.log`](clean-runtime.log)
- [`clean-minimal-build-turbopack.log`](clean-minimal-build-turbopack.log)
- [`clean-minimal-build-webpack.log`](clean-minimal-build-webpack.log)
- [`clean-intended-build-turbopack.log`](clean-intended-build-turbopack.log)
- [`clean-intended-build-webpack.log`](clean-intended-build-webpack.log)
- [`clean-production-server.log`](clean-production-server.log)
- [`clean-production-workflow.json`](clean-production-workflow.json)
- [`verify-stack.log`](verify-stack.log)
- [`verify-production-home.headers`](verify-production-home.headers)
- [`verify-production-home.html`](verify-production-home.html)
- [`verify-production-workflow.headers`](verify-production-workflow.headers)
- [`verify-production-workflow.json`](verify-production-workflow.json)
- [`staged-build-turbopack-failure.log`](staged-build-turbopack-failure.log)
- [`staged-build-webpack-failure.log`](staged-build-webpack-failure.log)
- [`dev-server.log`](dev-server.log)
- [`dev-workflow.json`](dev-workflow.json)
- [`source-input-sha256.txt`](source-input-sha256.txt)

## Qualification conclusion

The ratified package imports, production builds, and loopback production server
are compatible in a fresh project with one local dependency tree. The earlier
non-clean staging failure is retained as a reproducibility pitfall; its exact
cause is not established by this probe. This evidence does not qualify
authentication, jobs, providers, deployment, or production infrastructure.

Parent verification also passed from a previously absent isolated cache after adding cache-directory creation to the verifier. [Parent log](parent-verification.log), [home headers](parent-home.headers), [home body](parent-home.html), [workflow headers](parent-workflow.headers) and [workflow body](parent-workflow.json) retain that run.
