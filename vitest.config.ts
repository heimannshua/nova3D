import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

const alias = {'@': fileURLToPath(new URL('.', import.meta.url))};

// Two projects: `unit` needs nothing running; `integration` needs the Supabase CLI stack
// (`supabase start`) and talks to its Postgres and REST endpoints. Browser flows live in
// tests/e2e and run under Playwright (`npm run test:e2e`).
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {alias},
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
        },
      },
      {
        resolve: {alias},
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
