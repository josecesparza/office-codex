import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

const fixtureHome = resolve(process.cwd(), "tests/fixtures/codex-home");

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3210",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "node --import tsx apps/cli/src/index.ts dashboard",
    env: {
      ...process.env,
      OFFICE_CODEX_CODEX_HOME: fixtureHome,
      LOG_LEVEL: "warn",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3210",
  },
});
