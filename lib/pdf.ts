import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
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
