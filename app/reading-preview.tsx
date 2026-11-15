"use client";
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ReadingBlock, ReadingDocument } from "@/lib/reading";
import type { HighlightRect, PdfHighlight } from "@/lib/study-tools";
import PdfAnnotations from "./pdf-annotations";
function Blocks({
  blocks,
  depth = 0,
}: {
  blocks: ReadingBlock[];
  depth?: number;
}) {
  if (depth > 30) return null;
  return blocks.map((block, i) => {
    if (block.type === "image") {
      // URLs are created locally by the importer, never taken from document HTML.
      // eslint-disable-next-line @next/next/no-img-element
      return <img key={i} src={block.src} alt={block.alt} draggable={false} />;
    }
    if (block.type === "table")
      return (
        <table key={i}>
          <tbody>
            {block.rows.map((row, j) => (
              <tr key={j}>
                {row.map((cell, k) => (
                  <td key={k} colSpan={cell.colspan} rowSpan={cell.rowspan}>
                    <Blocks blocks={cell.blocks} depth={depth + 1} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    if (block.heading)
      return (
        <div
          role="heading"
          aria-level={block.heading}
          className={`reading-heading heading-${block.heading}`}
          key={i}
        >
          {block.text}
        </div>
      );
    if (block.pre) return <pre key={i}>{block.text}</pre>;
    if (block.quote) return <blockquote key={i}>{block.text}</blockquote>;
    return <p key={i}>{block.text}</p>;
  });
}
const PageBlocks = memo(Blocks);
export default function ReadingPreview({
  document: doc,
  number,
  zoom,
  highlights = [],
  onHighlight,
}: {
  document: ReadingDocument;
  number: number;
  zoom: number | "fit";
  highlights?: PdfHighlight[];
  onHighlight: (page: number, text: string, rects: HighlightRect[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0),
    [frame, setFrame] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.floor(entries[0].contentRect.width)),
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  // Reflow text at a fixed paper width. Scaling cannot alter highlight coordinates.
  const baseWidth = doc.imageSize
    ? Math.min(1200, doc.imageSize.width)
    : doc.width;
  const scale =
    zoom === "fit" ? Math.max(0.1, (width - 40) / baseWidth) : zoom / 100;
  return (
    <div className="pdf-render-host" ref={host}>
      <div className="pdf-surface">
        <div
          className={`pdf-page-frame reading-frame${doc.kind === "image" ? " reading-photo" : ""}`}
          style={
            {
              width: baseWidth * scale,
              "--reading-scale": scale,
              "--reading-width": `${baseWidth}px`,
            } as CSSProperties
          }
          ref={setFrame}
          data-page={number}
          aria-label={`${doc.kind === "image" ? "사진" : "문서"} 원문 ${number}페이지`}
        >
          <article className="reading-paper">
            <PageBlocks blocks={doc.pages[number - 1] || []} />
            {["docx", "hwpx", "hwp"].includes(doc.kind) && (
              <small className="reading-format-note">
                {doc.kind === "hwp"
                  ? "HWP 본문 읽기 · 그림과 원래 쪽 배치는 생략됩니다."
                  : "읽기용 보기 · 원래 쪽 배치·글꼴과 다를 수 있어요."}
              </small>
            )}
          </article>
          {doc.kind !== "image" && (
            <PdfAnnotations
              key={`${number}:${scale}`}
              frame={frame}
              page={number}
              highlights={highlights}
              onAdd={onHighlight}
            />
          )}
        </div>
      </div>
    </div>
  );
}
