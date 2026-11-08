import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
export type Glyph = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
// Cluster at line-start gaps, then order columns from left to right. Wide headings
// remain separate; newspaper layouts still require the editor's manual review.
export function readingOrder(items: Glyph[], columns = 1): string {
  const usable = items.filter((i) => i.str.trim());
  if (!usable.length) return "";
  const min = Math.min(...usable.map((i) => i.x)),
    max = Math.max(...usable.map((i) => i.x + i.width));
  const bins: Glyph[][] = Array.from({ length: columns }, () => []);
  for (const i of usable)
    bins[
      Math.min(
        columns - 1,
        Math.max(
          0,
          Math.floor(((i.x - min) / Math.max(1, max - min)) * columns),
        ),
      )
    ].push(i);
  return bins
    .map((bin) => {
      const lines: { y: number; height: number; items: Glyph[] }[] = [];
      for (const item of bin.sort((a, b) => b.y - a.y || a.x - b.x)) {
        const line = lines.find(
          (l) =>
            Math.abs(l.y - item.y) <
            Math.max(2, Math.min(l.height, item.height) * 0.45),
        );
        if (line) line.items.push(item);
        else lines.push({ y: item.y, height: item.height, items: [item] });
      }
      return lines
        .sort((a, b) => b.y - a.y)
        .map((l) =>
          l.items
            .sort((a, b) => a.x - b.x)
            .map((i, n, arr) => {
              const prev = arr[n - 1];
              return (
                (prev &&
                i.x - (prev.x + prev.width) > Math.max(1, i.height * 0.15)
                  ? " "
                  : "") + i.str
              );
            })
            .join(""),
        )
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}
export async function openPdf(
  file: File,
  password: string,
  onProgress: (n: number) => void,
  onTask?: (task: PDFDocumentLoadingTask) => void,
): Promise<{ task: PDFDocumentLoadingTask; document: PDFDocumentProxy }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const url = URL.createObjectURL(file);
  const task = pdfjs.getDocument({
    url,
    password,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    rangeChunkSize: 1024 * 1024,
  });
  onTask?.(task);
  task.onProgress = (p: { loaded: number; total: number }) => {
    if (p.total)
      onProgress(Math.min(99, Math.round((p.loaded / p.total) * 100)));
  };
  try {
    const document = await task.promise;
    return { task, document };
  } catch (e) {
    await task.destroy();
    throw e;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function extractPage(
  doc: PDFDocumentProxy,
  number: number,
  columns: number,
): Promise<{ text: string; glyphs: Glyph[] }> {
  const page = await doc.getPage(number);
  try {
    const content = await page.getTextContent();
    const glyphs = content.items.flatMap((i) =>
      "str" in i
        ? [
            {
              str: i.str,
              x: i.transform[4],
              y: i.transform[5],
              width: i.width,
              height: i.height || 10,
            },
          ]
        : [],
    );
    return { text: readingOrder(glyphs, columns), glyphs };
  } finally {
    page.cleanup();
  }
}
export function pdfError(error: unknown) {
  const e = error as { name?: string; message?: string };
  if (e.name === "PasswordException")
    return "암호가 필요하거나 올바르지 않습니다. 암호를 입력하고 다시 불러와 주세요.";
  if (e.name === "InvalidPDFException")
    return "손상되었거나 PDF 형식이 아닌 파일입니다. 원본을 다시 다운로드해 주세요.";
  return (
    "PDF를 처리하지 못했습니다. 다른 탭을 닫고 재시도하거나 PDF를 작은 페이지 묶음으로 나눠 주세요. " +
    (e.message || "메모리가 부족할 수 있습니다.")
  );
}
