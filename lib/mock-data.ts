// The health endpoint's summary (/api/health, scripts/test-health.mjs). It reports that the application still runs as a synthetic
// shell with no provider call: the dashboard's sample projects, the sample account and the sample notification are gone (Story
// 1.7: the pages read the signed-in Account's real Projects), and the design kit's sample cards come from lib/project-fixtures.ts.
// `healthSummary` stays as it was.
export const healthSummary = {
  appMode: 'synthetic-shell',
  providerCall: false,
  authConfigured: false,
  syntheticData: true,
} as const;
