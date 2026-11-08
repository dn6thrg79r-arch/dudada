"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
export default function PdfPreview({
  document,
  number,
}: {
  document: PDFDocumentProxy;
  number: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    async function render() {
      try {
        const page = await document.getPage(number);
        if (cancelled || !canvas.current) return;
        const scale = Math.min(1.5, 750 / page.getViewport({ scale: 1 }).width);
        const viewport = page.getViewport({ scale });
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        task = page.render({ canvas: canvas.current, viewport });
        await task.promise;
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "원본 미리보기 실패");
      }
    }
    void render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [document, number]);
  return (
    <div className="pdf-preview">
      {error ? (
        <p role="alert">원본 미리보기를 표시하지 못했습니다. {error}</p>
      ) : (
        <canvas ref={canvas} aria-label={`PDF 원본 ${number}페이지`} />
      )}
    </div>
  );
}
