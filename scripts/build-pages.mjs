import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
const basePath = process.env.PAGES_BASE_PATH ?? "/dudada";
if (basePath && !/^\/[A-Za-z0-9_.-]+$/.test(basePath))
  throw new Error(
    "PAGES_BASE_PATH must be empty or a single /repository path.",
  );
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  {
    stdio: "inherit",
    env: { ...process.env, GITHUB_PAGES: "1", NEXT_PUBLIC_BASE_PATH: basePath },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
await writeFile("out/.nojekyll", "");
console.log(`GitHub Pages files: out/ (site path: ${basePath || "/"})`);
