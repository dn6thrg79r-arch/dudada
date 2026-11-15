import { it, expect } from "vitest";
import JSZip from "jszip";
import { scanPptxArchive } from "../lib/presentation";
it("PPTX 압축 전에 형식·경로·매크로·확장 용량을 검사한다", async () => {
  expect(() => scanPptxArchive(new ArrayBuffer(0))).toThrow();
  expect(() =>
    scanPptxArchive(new TextEncoder().encode("not a pptx").buffer),
  ).toThrow();
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "x");
  zip.file("ppt/presentation.xml", "x");
  zip.file("ppt/slides/slide1.xml", "x");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  expect(scanPptxArchive(bytes).has("ppt/presentation.xml")).toBe(true);
  zip.file("ppt/vbaProject.bin", "x");
  await expect(
    zip.generateAsync({ type: "arraybuffer" }).then(scanPptxArchive),
  ).rejects.toThrow("매크로");
  const bad = bytes.slice(0);
  const view = new DataView(bad);
  for (let i = 0; i < bad.byteLength - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 0xffffffff, true);
      break;
    }
  }
  expect(() => scanPptxArchive(bad)).toThrow("너무 큽니다");
});
