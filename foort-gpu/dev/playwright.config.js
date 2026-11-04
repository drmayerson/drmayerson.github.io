import { defineConfig } from '@playwright/test';

const PORT = 8765;

// GPU tests run in installed Chrome (channel 'chrome') so that the real GPU is used;
// headless Chromium may fall back to a software adapter, which is fine for correctness
// but not for timing.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: process.env.PW_HEADED ? false : true,
    launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    // a Node static server: Python's http.server occasionally stalled ES-module requests of parallel test browsers
    command: `node scripts/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
  },
});
