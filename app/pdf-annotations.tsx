"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  selectionHighlight,
  type PdfHighlight,
  type HighlightRect,
} from "@/lib/study-tools";
export default function PdfAnnotations({
  frame,
  page,
  highlights,
  onAdd,
}: {
  frame: HTMLDivElement | null;
  page: number;
  highlights: PdfHighlight[];
  onAdd: (page: number, text: string, rects: HighlightRect[]) => void;
}) {
  const [selected, setSelected] =
    useState<ReturnType<typeof selectionHighlight>>(null);
  useEffect(() => {
    if (!frame) return;
    const doc = frame.ownerDocument;
    let scheduled = 0;
    const refresh = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() =>
        setSelected(selectionHighlight(frame, doc.getSelection())),
      );
    };
    doc.addEventListener("selectionchange", refresh);
    return () => {
      cancelAnimationFrame(scheduled);
      doc.removeEventListener("selectionchange", refresh);
    };
  }, [frame]);
  if (!frame) return null;
  return createPortal(
    <>
      <div className="pdf-highlights" aria-hidden="true">
        {highlights
          .filter((h) => h.page === page)
          .flatMap((h) =>
            h.rects.map((r, i) => (
              <span
                key={`${h.id}:${i}`}
                data-highlight-id={h.id}
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
      {selected && (
        <button
          className="highlight-action"
          type="button"
          style={{
            left: `${Math.min(selected.rects[0].x * 100, 65)}%`,
            top: `${Math.max(0, selected.rects[0].y * 100)}%`,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAdd(page, selected.text, selected.rects);
            frame.ownerDocument.getSelection()?.removeAllRanges();
            setSelected(null);
          }}
        >
          선택한 글에 형광펜
        </button>
      )}
    </>,
    frame,
  );
}
