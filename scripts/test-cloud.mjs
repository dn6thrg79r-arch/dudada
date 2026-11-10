// Test-only service URL and public key. This build must never be deployed.
import { spawnSync } from "node:child_process";
const env = {
  ...process.env,
  CLOUD_REQUIRED: "0",
  NEXT_PUBLIC_SUPABASE_URL: "https://cloud-test.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_protocol_fixture",
  CLOUD_E2E: "1",
  E2E_STATIC: "1",
  E2E_PORT: process.env.E2E_PORT || "3103",
};
for (const args of [
  ["scripts/build-pages.mjs"],
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/cloud.spec.ts",
    "--project=chromium",
  ],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
