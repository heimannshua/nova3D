# Provider permissions and operator setup

Story 2.5 permissions are bound to one Account, Project, Job, paid category, provider, purpose, outbound-data set, and disclosed maximum. They lapse after seven days or when the Job reaches a terminal attempt state, and can be revoked. The persistence API is service-role only; it must only be called by authenticated Project actions after checking live Account authority and Project ownership.

The current application does not yet create paid Jobs or show a verified rate quote. The reusable disclosure panel is not mounted on the generic Project page because there is no Job identity or calculated maximum to display. Its Grant control remains disabled until the paid start flow can present a calculated bound and bind the permission to the Job being admitted. Do not create permission rows or dispatch adapters before then.

## Required human setup

- Verify Anthropic account terms and applicable data retention/deletion terms; provide credentials through the deployment secret manager.
- Record an approved, current rate schedule for Anthropic `claude-sonnet-5-5` and Brave Web Search v1 in the controlled usage rate-schedule provisioning process.
- Review Brave terms and record the evidence in the Story 1.10 provisioning ledger before enabling Brave. The repository ledger currently has no such evidence, so Brave remains disabled.
- Confirm deployment credentials are available without exposing them to clients or logs.

No provider terms, rates, credentials, or vendor-console configuration have been verified by this implementation. Adapters must remain disabled until the evidence is supplied and checked.
