"use client";
import { useEffect, useRef, useState } from "react";
import type { PresentationDocument } from "@/lib/presentation";
import type { PdfHighlight, HighlightRect } from "@/lib/study-tools";
let frameScript: Promise<string> | undefined;
function script() {
  return (frameScript ??= fetch(
    `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/pptx/frame.js`,
  )
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.text();
    })
    .catch((e) => {
      frameScript = undefined;
      throw e;
    }));
}
export default function PresentationPreview({
  document: doc,
  number,
  zoom,
  highlights = [],
  onHighlight,
  onNavigate,
}: {
  document: PresentationDocument;
  number: number;
  zoom: number | "fit";
  highlights?: PdfHighlight[];
  onHighlight: (page: number, text: string, rects: HighlightRect[]) => void;
  onNavigate: (delta: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    iframe = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(0),
    [html, setHtml] = useState(""),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  const [selected, setSelected] = useState<{
    page: number;
    text: string;
    rects: HighlightRect[];
  } | null>(null);
  const key = useRef(crypto.randomUUID());
  const scale =
    zoom === "fit" ? Math.max(0.1, (width - 40) / doc.width) : zoom / 100;
  const viewWidth = doc.width * scale,
    viewHeight = doc.height * scale;
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0].contentRect.width)),
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    script()
      .then((code) => {
        if (!active) return;
        setReady(false);
        setError(false);
        setSelected(null);
        const nonce = crypto.randomUUID();
        setHtml(
          `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none';"><style>html,body{margin:0;overflow:hidden;background:white;}#slide-root{transform-origin:0 0;}a{pointer-events:none;}.pptx-preview-wrapper{padding:0!important;background:transparent!important;}*{box-sizing:border-box;}</style></head><body><div id="slide-root"></div><script nonce="${nonce}">${code.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
        );
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [doc]);
  // Only pass the sanitized presentation to an opaque-origin, network-blocked
  // frame. No authentication token or account state ever enters this frame.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== "null"
      )
        return;
      const data = event.data;
      if (data?.type === "ready") {
        const bytes = doc.bytes.slice(0);
        iframe.current!.contentWindow!.postMessage(
          {
            type: "load",
            key: key.current,
            bytes,
            slidePaths: doc.slidePaths,
            width: doc.width,
            height: doc.height,
            viewWidth,
            page: number,
          },
          "*",
          [bytes],
        );
        return;
      }
      if (data?.key !== key.current) return;
      if (data.type === "rendered") setReady(true);
      if (data.type === "error") setError(true);
      if (data.type === "navigate" && (data.delta === 1 || data.delta === -1))
        onNavigate(data.delta);
      if (data.type === "selection") {
        const s = data.selection;
        if (
          !s ||
          typeof s.text !== "string" ||
          !Array.isArray(s.rects) ||
          data.page !== number
        ) {
          setSelected(null);
          return;
        }
        const rects = s.rects
          .slice(0, 500)
          .filter(
            (r: HighlightRect) =>
              [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
              r.x >= 0 &&
              r.y >= 0 &&
              r.width > 0 &&
              r.height > 0 &&
              r.x + r.width <= 1.01 &&
              r.y + r.height <= 1.01,
          );
        setSelected(
          rects.length
            ? { page: number, text: s.text.slice(0, 10000), rects }
            : null,
        );
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [doc, number, viewWidth, onNavigate]);
  useEffect(() => {
    if (ready)
      iframe.current?.contentWindow?.postMessage(
        { type: "page", key: key.current, page: number },
        "*",
      );
  }, [number, ready]);
  useEffect(() => {
    if (ready)
      iframe.current?.contentWindow?.postMessage(
        { type: "resize", key: key.current, width: viewWidth },
        "*",
      );
  }, [viewWidth, ready]);
  return (
    <div className="pdf-render-host" ref={host}>
      {error ? (
        <p className="notice error" role="alert">
          이 슬라이드를 표시하지 못했습니다. 복잡한 효과가 있는 자료는 PDF로
          내보내 불러와 주세요.
        </p>
      ) : null}
      <div className="pdf-render-status" role="status">
        {!ready && !error ? "브라우저에서 슬라이드를 여는 중…" : ""}
      </div>
      <div className="pdf-surface">
        <div
          className="pdf-page-frame"
          style={{ width: viewWidth, height: viewHeight }}
        >
          {html && (
            <iframe
              ref={iframe}
              srcDoc={html}
              sandbox="allow-scripts"
              title={`프레젠테이션 원본 ${number}슬라이드`}
              style={{
                width: viewWidth,
                height: viewHeight,
                border: 0,
                display: "block",
                background: "white",
              }}
            />
          )}
          <div className="pdf-highlights" aria-hidden="true">
            {highlights
              .filter((h) => h.page === number)
              .flatMap((h) =>
                h.rects.map((r, i) => (
                  <span
                    key={`${h.id}:${i}`}
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.width * 100}%`,
                      height: `${r.height * 100}%`,
                    }}
                  />
                )),
              )}
          </div>
          {selected?.page === number && (
            <button
              className="highlight-action"
              style={{
                left: `${Math.min(selected.rects[0].x * 100, 65)}%`,
                top: `${selected.rects[0].y * 100}%`,
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onHighlight(number, selected.text, selected.rects);
                setSelected(null);
              }}
            >
              선택한 글에 형광펜
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
