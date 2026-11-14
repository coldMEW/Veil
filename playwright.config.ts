import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'provenance.spec.ts',
  workers: 1,
  reporter: 'list',
  outputDir: 'node_modules/.cache/provenance-results',
  projects: [{ name: 'chromium', use: { browserName: 'chromium', headless: true } }],
  webServer: {
    command: 'npx vite --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: false,
  },
});
