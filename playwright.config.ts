import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
const port = process.env.E2E_PORT || "3000";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command:
      process.env.E2E_DEV === "1"
        ? `npm run dev -- --port ${port}`
        : `npm run start -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath:
            process.env.CHROMIUM_PATH ||
            (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
          args: ["--no-sandbox"],
        },
      },
    },
    {
      name: "webkit",
      use: { ...devices["iPad (gen 7)"], browserName: "webkit" },
    },
  ],
});
