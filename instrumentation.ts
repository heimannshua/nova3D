// Runs once per server instance, before the first request. The identity check lives in a
// Node-only module so the Edge bundle never sees Node APIs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `next build` must stay credential-free; the Vercel deployment build runs `check-env --deployment`.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const {verifyStartupIdentity} = await import('./instrumentation-node');
  await verifyStartupIdentity();
}
