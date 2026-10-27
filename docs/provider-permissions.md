# Provider permissions and operator setup

Story 2.5 permissions are bound to one Account, Project, Job, paid category, provider, purpose, outbound-data set, and disclosed maximum. They lapse after seven days, when the Job reaches a terminal attempt state, or when a retry starts a new attempt, and can be revoked. The persistence API is service-role only; it must only be called by authenticated Project actions after checking live Account authority and Project ownership.

The current application does not yet create paid Jobs or show a verified rate quote. The reusable disclosure panel is not mounted on the generic Project page because there is no Job identity or calculated maximum to display. Its Grant control remains disabled until the paid start flow can present a calculated bound and bind the permission to the Job being admitted. Do not create permission rows or dispatch adapters before then.

## How a permission is used and when it ends

A grant is read only by the permissioned `api.reserve_cost`, whose steps are in `docs/authority-contract.md` ("Reserving under a provider permission"). In short: the Account's authority is judged first, then that the operation is the named Job's and Project's own, then a replay (a command ID that already reserved, or an operation that already holds a reservation, is answered with the original receipt even after the grant was revoked or lapsed, so a lost answer is never turned into a refusal), then that a live grant matches the request exactly (the outbound data as a set, the purpose, category and provider), then the quote against the disclosed maximum.

- **A grant lapses with its attempt.** It is made under the Job's highest attempt and is live only while that attempt is still the highest and has not finished. A retry creates a new attempt, so the earlier grant does not come back: the person is shown the disclosure again and grants again.
- **The disclosed maximum is per operation.** It bounds the price of ONE provider request (an operation), as the calculator quotes it, and is never above the $1 operation cap; the panel calls it "Highest charge for one request". It is not a total for the Job: the $5 Job cap across all attempts and the Account's allowance bound what the operations cost together. A quote that is not a price (the bound is unavailable, say) is refused for its own reason, not as exceeding the maximum.
- **Revoking is not releasing.** A revoke stops later admissions. A reservation already made stays until it is settled, and the dispatch of that operation must check the live grant again (Story 2.7).

## Required human setup

- Verify Anthropic account terms and applicable data retention/deletion terms; provide credentials through the deployment secret manager.
- Record an approved, current rate schedule for Anthropic `claude-sonnet-5-5` and Brave Web Search v1 in the controlled usage rate-schedule provisioning process.
- Review Brave terms and record the evidence in the Story 1.10 provisioning ledger before enabling Brave. The repository ledger currently has no such evidence, so Brave remains disabled.
- Confirm deployment credentials are available without exposing them to clients or logs.

No provider terms, rates, credentials, or vendor-console configuration have been verified by this implementation. Adapters must remain disabled until the evidence is supplied and checked.
