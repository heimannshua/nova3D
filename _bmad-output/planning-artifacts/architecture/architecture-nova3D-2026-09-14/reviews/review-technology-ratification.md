# Technology freshness and fit — ratification review

**Verdict: PASS with qualification gates; no overclaimed offline capability found.** R-3–R-9 consistently mark fixture values, device targets, provider terms, edition rights, regions and recovery as acceptance/qualification work. G-8 explicitly says no suitable multi-view phone model is proven, and G-9 says plans, restore drills and topology remain unverified.

## Actionable findings

1. **Closed — R-6 request behavior.** Parent ratification now binds the immutable model/options/rate snapshot, component token accounting, and fail-closed unsupported parameters. The current Sonnet 5 defaults to adaptive thinking with default effort `high`; non-default `temperature`, `top_p`, and `top_k` return 400, and `max_tokens` covers thinking plus response text. No additional product default is needed beyond recording the chosen request options and rejecting unsupported ones. [Anthropic model overview](https://platform.claude.com/docs/en/models/overview), [Sonnet 5 migration notes](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide), [Sonnet 5 behavior notes](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5).

2. **Medium — R-6's Brave retention statement is current but must be treated as a provider term, not a deletion guarantee.** Brave's API privacy notice says query records are retained for a maximum of 90 days and offers zero-data-retention only for Enterprise customers, subject to legal obligations. G-6 must capture the actual account arrangement before enabling paid search and keep the existing “outside controlled-backup deletion” disclosure. [Brave API privacy notice](https://api-dashboard.search.brave.com/privacy-policy).

3. **Low — R-3 manufacturer inheritance does not validate the adopted engineering thresholds.** The Bambu profile can seed slicer settings, but the 1.2 mm wall, 0.8 mm feature, 0.4 mm clearance, 0.6 mm relief, 45° overhang and 5 mm bridge values remain product acceptance targets. The record says this correctly; G-3 must retain fixture prints/slicing evidence and must not label these manufacturer guarantees.

## Checks passed

- Vercel documents `iad1` as the Washington, D.C. compute region and maps it to `us-east-1`; the R-9 Vercel/Supabase alignment is plausible, pending actual plan and deployment acceptance. [Vercel regions](https://vercel.com/docs/regions)
- ONNX Runtime Web 1.29.0 is selected as a backend only; R-8 does not claim suitable weights, phone performance, or qualification. G-8 remains release-blocking.
- Playwright 1.63.0, JSON Schema Draft 2020-12 and the Sefaria editions are treated as pinned/rights-verification inputs with G-4/G-7 evidence requirements, not as completed proof.
- R-9 explicitly avoids a global residency promise and requires actual Upstash topology and provider settings at bootstrap.

Experiments and deployments were not run; no spine or ratification edits were made.
