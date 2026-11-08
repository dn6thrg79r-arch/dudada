"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
export default function PdfPreview({
  document,
  number,
  zoom,
}: {
  document: PDFDocumentProxy;
  number: number;
  zoom: number | "fit";
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0].contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el || width < 1) return;
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let renderedPage: PDFPageProxy | undefined;
    async function render() {
      setLoading(true);
      setError("");
      try {
        const page = await document.getPage(number);
        renderedPage = page;
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale =
          zoom === "fit"
            ? Math.max(0.1, (width - 40) / base.width)
            : zoom / 100;
        const viewport = page.getViewport({ scale });
        // Bound raster memory for large page dimensions and Retina screens, preserving CSS zoom.
        const pixels = 12_000_000;
        const dpr = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(pixels / (viewport.width * viewport.height)),
        );
        canvas = window.document.createElement("canvas");
        canvas.setAttribute("aria-label", `PDF 원본 ${number}페이지`);
        canvas.setAttribute("role", "img");
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const surface = el!.querySelector(".pdf-surface")!;
        surface.replaceChildren(canvas);
        task = page.render({
          canvas,
          viewport,
          transform: [dpr, 0, 0, dpr, 0, 0],
        });
        await task.promise;
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setLoading(false);
          setError(
            `페이지를 표시하지 못했습니다. 확대율을 줄이거나 다른 탭을 닫고 재시도해 주세요. ${e instanceof Error ? e.message : ""}`,
          );
        }
      } finally {
        renderedPage?.cleanup();
      }
    }
    void render();
    return () => {
      cancelled = true;
      task?.cancel();
      if (canvas) {
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [document, number, zoom, width]);
  return (
    <div ref={host} className="pdf-render-host">
      <div className="pdf-render-status" role="status">
        {loading ? "원본 페이지를 그리는 중…" : error || ""}
      </div>
      <div className="pdf-surface" />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
