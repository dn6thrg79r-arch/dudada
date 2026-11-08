import { cp, mkdir } from "node:fs/promises";
await mkdir("public/pdfjs", { recursive: true });
for (const name of [
  "build/pdf.worker.min.mjs",
  "cmaps",
  "standard_fonts",
  "wasm",
]) {
  await cp(
    `node_modules/pdfjs-dist/${name}`,
    `public/pdfjs/${name.split("/").at(-1)}`,
    { recursive: true },
  );
}
