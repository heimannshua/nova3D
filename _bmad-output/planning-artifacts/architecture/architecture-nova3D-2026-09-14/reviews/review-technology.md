# Technology reviewer gate

**Final verdict: PASS with G-1/bootstrap gates retained.** Both findings from the prior pass are closed in the spine: CadQuery now selects Python 3.12 conservatively and documents the OCP metadata/documentation conflict; bootstrap now records the actual Vercel, Supabase and Railway capability configuration. These remain acceptance gates, not claims that deployment or generation has been proven.

## Previously actionable findings — disposition

1. **Closed — CadQuery runtime.** The spine now selects the Python 3.12 release line, calls out the primary-source conflict, and keeps exact patch/OCP/image closure in G-1.

2. **Closed — managed platform capabilities.** The spine now requires bootstrap acceptance to record Vercel plan/runtime/limits, Supabase database/Auth/Storage/backup settings, Railway image/runtime/resources/region, and staging callback/private-file exercises.

## Reality checks that passed

- Node `24.21.0` is published as an LTS release in the official Node index ([source](https://nodejs.org/dist/index.json)).
- Upstash Workflow retries failed steps by default and exposes configurable retry counts; the spine's explicit zero-retry policy is therefore necessary and technically plausible ([source](https://upstash.com/docs/workflow/features/retries)).
- CadQuery 2.8.0 exists, requires Python >=3.11, and describes Python recipes as the parametric model while supporting STEP/3MF exports ([metadata](https://pypi.org/pypi/cadquery/2.8.0/json), [import/export docs](https://cadquery.readthedocs.io/en/stable/importexport.html)).
- The Vercel 4.5 MB limit supports routing large artifacts through the proposed Railway gateway rather than Vercel functions.

No architecture-spine edits were made. Feasibility gates and unbenchmarked capabilities were treated as explicit gates, per the review request, rather than findings.
