import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
if (
  process.env.CLOUD_REQUIRED === "1" &&
  (!process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
)
  throw new Error(
    "Supabase 공개 연결값 2개를 GitHub Actions Variables에 먼저 등록하세요. docs/CLOUD_SETUP.md 참고.",
  );
if (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_secret_"))
  throw new Error(
    "서버 secret key를 브라우저에 넣을 수 없습니다. publishable key를 사용하세요.",
  );
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
