import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
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
