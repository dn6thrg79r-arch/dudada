"use client";
import { useEffect, useRef } from "react";
import type { Bookmark, PdfHighlight } from "@/lib/study-tools";
export default function ReadingMarks({
  bookmarks,
  highlights,
  onGo,
  onRename,
  onDeleteBookmark,
  onDeleteHighlight,
  onClose,
}: {
  bookmarks: Bookmark[];
  highlights: PdfHighlight[];
  onGo: (page: number) => void;
  onRename: (page: number, label: string) => void;
  onDeleteBookmark: (page: number) => void;
  onDeleteHighlight: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="study-dialog"
      aria-labelledby="marks-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="marks-title">책갈피와 형광펜</h2>
        <button onClick={onClose}>닫기</button>
      </div>
      <h3>책갈피</h3>
      {!bookmarks.length && (
        <p>PDF 위의 책갈피 버튼으로 중요한 페이지를 남겨 보세요.</p>
      )}
      {[...bookmarks]
        .sort((a, b) => a.page - b.page)
        .map((b) => (
          <div className="mark-row" key={b.page}>
            <button
              aria-label={`${b.page}페이지 책갈피로 이동`}
              onClick={() => onGo(b.page)}
            >
              {b.page}쪽
            </button>
            <input
              aria-label={`${b.page}페이지 책갈피 이름`}
              value={b.label}
              maxLength={100}
              onChange={(e) => onRename(b.page, e.target.value)}
            />
            <button
              aria-label={`${b.page}페이지 책갈피 삭제`}
              onClick={() => onDeleteBookmark(b.page)}
            >
              삭제
            </button>
          </div>
        ))}
      <h3>형광펜</h3>
      {!highlights.length && (
        <p>
          원문 글자를 드래그한 뒤 “선택한 글에 형광펜”을 누르세요. 스캔 PDF는
          글자 선택을 지원하지 않아요.
        </p>
      )}
      {highlights.map((h) => (
        <div className="mark-row" key={h.id}>
          <button className="highlight-excerpt" onClick={() => onGo(h.page)}>
            <span>
              {h.page}쪽 · {h.text}
            </span>
          </button>
          <button
            aria-label={`${h.text.slice(0, 30)} 형광펜 삭제`}
            onClick={() => onDeleteHighlight(h.id)}
          >
            삭제
          </button>
        </div>
      ))}
    </dialog>
  );
}
