# Qualification review disposition

The independent Luna review raised 28 findings in [BLIND-REVIEW.md](BLIND-REVIEW.md). Numbers below follow that file's order. **26 findings were addressed by probe or evidence corrections; two pre-existing application-validation gaps were deferred.** No finding was rejected. These dispositions close this local evidence review, not the application gates.

| Finding | Classification | Disposition |
| --- | --- | --- |
| 1 | patch | Check generated final bounds and one valid solid; added translated ramp/plaque envelope negatives. |
| 2 | patch | Negative parameters pass through an actual rejecting fixture build boundary. |
| 3 | patch | Scale/unit results explicitly establish parameter rejection, not normalization or certified transform equivalence. |
| 4 | patch | Cancellation requires a live child before signalling, exact SIGTERM exit and enforced readiness/cancellation budgets. |
| 5 | patch | Compare recipe digests and every feature's coarse metrics; name the result coarse repeatability. Exact semantic geometry equivalence remains G-2 work. |
| 6 | patch | Validate the corrected final union and its expected 1,960 mm³ volume change. Boolean semantic correspondence remains unqualified. |
| 7 | patch | Added finite-number and translated-feature negatives. Production operation-graph/disconnected-geometry corpus remains explicitly deferred under G-1/G-2. |
| 8 | patch | Threshold fixtures require the expected component arrangement before positional measurements; malformed layouts fail predictably. |
| 9 | patch | Positive fixtures require both valid mesh and analytic acceptance; malformed-positive mutations are rejected. |
| 10 | defer | General support/overhang/bridge and negative slicing qualification does not exist in the application. The one positive slice is explicitly scoped. |
| 11 | patch | Stack setup consumes a checked-in lockfile using npm ci in a fresh project. |
| 12 | patch | Source manifest includes application/minimal fixtures, scripts, configuration and lockfile. |
| 13 | patch | Removed duplicate result rows and retained HTTP headers, bodies and explicit response assertions. |
| 14 | patch | Offline fetched and cached artifact bytes must match the fixture, not merely its size. |
| 15 | patch | Aggregate evidence separates local probe PASS from G-5/G-8 BLOCKED and offline inference NOT RUN. |
| 16 | patch | Renamed viewport modes to API emulation; no layout acceptance claim. |
| 17 | patch | Narrowed callback result to post-deletion update rejection; live authorization-epoch fencing remains NOT RUN. |
| 18 | patch | Atomic ledger replacement fsyncs file and parent directory. Power-loss qualification remains explicitly unrun. |
| 19 | defer | Full application cross-store crash/resume windows remain unimplemented; rollback injection is not presented as that proof. |
| 20 | patch | Validate persisted backup digests before restore/extraction and reject corrupted input. |
| 21 | patch | Added simultaneous same-key import calls requiring one import and one duplicate result. Distinct-key/conflict-sync acceptance remains G-8 work. |
| 22 | patch | Added active-Account and Account/Project/Job ownership guards with negative assertions; no production authorization claim. |
| 23 | patch | Duplicate reservation checks bind operation, Account, Project, Job and amount; changed amount is rejected. Concurrent ambiguous settlement remains G-6 work. |
| 24 | patch | Use structured booleans, command exits and expected results for every recorded concurrency verdict. |
| 25 | patch | Assert removal and absence of the probe container; cleanup failure fails the run. |
| 26 | patch | Pin CAD base digest and resolved Python closure; distinguish observed apt packages from immutable repository locking. |
| 27 | patch | Retain source capture time, immutable repository/model revisions and README hashes. Model files were not executed. |
| 28 | patch | Final SHA256SUMS covers probe source, reports, locks, fixtures and retained outputs; area manifests retain source bindings. |

Parent review also added locked browser installation, installed-version assertions, original IndexedDB payload bytes, browser cleanup on launch failure, and creation of a missing stack cache directory. The corresponding local probes were rerun. [PARENT-CHECKS.json](PARENT-CHECKS.json) records the final results and scope.

No production migration, provider deployment, target-device benchmark or offline reconstruction implementation is introduced by these fixes.
