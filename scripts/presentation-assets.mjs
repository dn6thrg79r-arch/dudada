import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
await mkdir("public/pptx", { recursive: true });
await build({
  entryPoints: ["presentation/frame.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "public/pptx/frame.js",
  legalComments: "eof",
});
const notice = await readFile("node_modules/pptx-preview/README.md", "utf8");
await writeFile(
  "public/pptx/NOTICE.md",
  `PPTX preview: pptx-preview (published npm package, license field: ISC).\nPackage use terms, unmodified:\n\n${notice}`,
);
