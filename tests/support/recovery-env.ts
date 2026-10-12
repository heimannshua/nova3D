// Story 1.6. The Administrator address the application servers under test are started with, and the one address the recovery
// browser flows (tests/e2e/recovery.spec.ts) make their Administrator with.
//
// Recovery serves the ONE Account that is the Administrator and whose Auth user's email equals the server's
// ADMINISTRATOR_EMAIL, so the servers must not be started with a developer's real address: the test Administrator would be
// a stranger to them, and a real Administrator in the same local database would be the one the server served.
// playwright.config.ts starts both servers with this address (the process environment beats `.env.local`), and the spec
// creates its Administrator under it. An application server that was already running (`reuseExistingServer` outside CI)
// was not started with it: stop that server first.
export const recoveryAdministratorEmail = 'recovery-admin@example.test';
