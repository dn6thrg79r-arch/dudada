"use client";
import { useEffect, useRef, useState } from "react";
import PdfAnnotations from "./pdf-annotations";
import type { PdfHighlight, HighlightRect } from "@/lib/study-tools";
import { bindPdfSelection } from "@/lib/pdf-selection";
import { pdfEnglishWords } from "@/lib/english-input";
import type { TextLayer, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
export default function PdfPreview({
  document,
  number,
  zoom,
  onEnglishWords,
  highlights = [],
  onHighlight,
}: {
  document: PDFDocumentProxy;
  number: number;
  zoom: number | "fit";
  onEnglishWords?: (words: string[]) => void;
  highlights?: PdfHighlight[];
  onHighlight?: (page: number, text: string, rects: HighlightRect[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [annotationFrame, setAnnotationFrame] = useState<{
    element: HTMLDivElement;
    page: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [textHint, setTextHint] = useState("");
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
    let textLayer: TextLayer | undefined;
    let frame: HTMLDivElement | undefined;
    let unbindSelection: (() => void) | undefined;
    async function render() {
      setLoading(true);
      setError("");
      setTextHint("");
      onEnglishWords?.([]);
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
        frame = window.document.createElement("div");
        frame.className = "pdf-page-frame";
        frame.style.width = `${viewport.width}px`;
        frame.style.height = `${viewport.height}px`;
        frame.append(canvas);
        surface.replaceChildren(frame);
        setAnnotationFrame({ element: frame, page: number });
        task = page.render({
          canvas,
          viewport,
          transform: [dpr, 0, 0, dpr, 0, 0],
        });
        await task.promise;
        if (!cancelled) {
          try {
            const content = await page.getTextContent();
            if (cancelled) return;
            const strings = content.items.flatMap((item) =>
              "str" in item ? [item.str] : [],
            );
            onEnglishWords?.(pdfEnglishWords(strings.join(" ")));
            if (strings.some((s) => s.trim())) {
              const layer = window.document.createElement("div");
              layer.className = "pdf-text-layer";
              layer.setAttribute("aria-label", "PDF 글자 선택 영역");
              layer.setAttribute("role", "group");
              layer.style.setProperty(
                "--total-scale-factor",
                String(scale * page.userUnit),
              );
              layer.style.setProperty("--scale-round-x", "1px");
              layer.style.setProperty("--scale-round-y", "1px");
              frame!.append(layer);
              const pdfjs = await import("pdfjs-dist");
              if (cancelled) return;
              textLayer = new pdfjs.TextLayer({
                textContentSource: content,
                container: layer,
                viewport,
              });
              await textLayer.render();
              if (cancelled) return;
              unbindSelection = bindPdfSelection(layer);
              pdfjs.TextLayer.cleanup();
            } else
              setTextHint(
                "이미지 PDF는 글자를 드래그할 수 없습니다. 원본을 보며 직접 필사해 주세요.",
              );
          } catch {
            if (!cancelled)
              setTextHint(
                "선택할 글자를 불러오지 못했습니다. PDF는 원본 그대로 볼 수 있습니다.",
              );
          }
        }
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
      unbindSelection?.();
      textLayer?.cancel();
      frame?.remove();
      if (canvas) {
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [document, number, zoom, width, onEnglishWords]);
  return (
    <div ref={host} className="pdf-render-host">
      <div className="pdf-render-status" role="status">
        {loading ? "원본 페이지를 그리는 중…" : error || ""}
      </div>
      <div className="pdf-surface" />
      {onHighlight && (
        <PdfAnnotations
          frame={
            annotationFrame?.page === number ? annotationFrame.element : null
          }
          page={number}
          highlights={highlights}
          onAdd={onHighlight}
        />
      )}
      {textHint && <p className="pdf-copy-note">{textHint}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
