import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", "--project=chromium"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      E2E_STATIC: "1",
      E2E_PORT: process.env.E2E_PORT || "3102",
    },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
