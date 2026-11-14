import type { Notebook } from "./notebook";
export type HighlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type PdfHighlight = {
  id: string;
  page: number;
  text: string;
  rects: HighlightRect[];
  created: string;
};
export type Bookmark = { page: number; label: string };
export type DraftVersion = {
  id: string;
  text: string;
  created: string;
  reason: "automatic" | "manual" | "before-replace" | "before-restore";
};
export const HISTORY_INTERVAL = 60_000;
export const HISTORY_PER_PAGE = 30;
export const HISTORY_BYTES = 2 * 1024 * 1024;
const bytes = (text: string) => new TextEncoder().encode(text).length;
export function checkpoint(
  note: Notebook,
  page: number,
  text: string,
  reason: DraftVersion["reason"] = "automatic",
  now = Date.now(),
): Notebook {
  if (!text || bytes(text) > HISTORY_BYTES) return note;
  const versions = note.history?.[page] || [];
  if (versions[0]?.text === text) return note;
  const version: DraftVersion = {
    id: crypto.randomUUID(),
    text,
    created: new Date(now).toISOString(),
    reason,
  };
  const history: Record<string, DraftVersion[]> = {
    ...note.history,
    [page]: [version, ...versions].slice(0, HISTORY_PER_PAGE),
  };
  // Bound the entire document, retaining the newest versions across all pages.
  const all = Object.entries(history)
    .flatMap(([p, list]) => list.map((v) => ({ p, v })))
    .sort((a, b) => b.v.created.localeCompare(a.v.created));
  let used = 0;
  const retained = new Set<string>();
  // Always keep the newly captured text, even if timestamps are tied.
  retained.add(version.id);
  used += bytes(version.text);
  for (const { v } of all) {
    if (v.id === version.id) continue;
    const size = bytes(v.text);
    if (used + size <= HISTORY_BYTES) {
      used += size;
      retained.add(v.id);
    }
  }
  for (const p of Object.keys(history))
    history[p] = history[p].filter((v) => retained.has(v.id));
  return { ...note, history };
}
export function beforeDraftEdit(
  note: Notebook,
  page: number,
  next: string,
  now = Date.now(),
): Notebook {
  const old = note.drafts[page] || "";
  if (old === next || !old) return note;
  const latest = note.history?.[page]?.[0];
  let destructive = next.length < old.length * 0.7;
  if (!destructive && !next.startsWith(old)) {
    let prefix = 0,
      suffix = 0;
    while (
      prefix < Math.min(old.length, next.length) &&
      old[prefix] === next[prefix]
    )
      prefix++;
    while (
      suffix < Math.min(old.length, next.length) - prefix &&
      old[old.length - 1 - suffix] === next[next.length - 1 - suffix]
    )
      suffix++;
    destructive = old.length - prefix - suffix > Math.max(20, old.length * 0.3);
  }
  if (
    destructive ||
    !latest ||
    now - Date.parse(latest.created) >= HISTORY_INTERVAL
  )
    return checkpoint(
      note,
      page,
      old,
      destructive ? "before-replace" : "automatic",
      now,
    );
  return note;
}
export function restoreDraft(
  note: Notebook,
  page: number,
  versionId: string,
): Notebook {
  const version = note.history?.[page]?.find((v) => v.id === versionId);
  if (!version) throw new Error("이 버전은 더 이상 남아 있지 않습니다.");
  const current = note.drafts[page] || "";
  if (bytes(current) > HISTORY_BYTES)
    throw new Error(
      "현재 글이 커서 복원 전 보관할 수 없습니다. TXT로 먼저 내보내 주세요.",
    );
  const archived = checkpoint(note, page, current, "before-restore");
  return { ...archived, drafts: { ...note.drafts, [page]: version.text } };
}
export function selectionHighlight(
  frame: HTMLElement,
  selection: Selection | null,
): { text: string; rects: HighlightRect[] } | null {
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0),
    layer = frame.querySelector(".pdf-text-layer");
  if (
    !layer?.contains(range.startContainer) ||
    !layer.contains(range.endContainer)
  )
    return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const box = frame.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: Math.max(0, (r.left - box.left) / box.width),
      y: Math.max(0, (r.top - box.top) / box.height),
      width:
        Math.min(1, (r.right - box.left) / box.width) -
        Math.max(0, (r.left - box.left) / box.width),
      height:
        Math.min(1, (r.bottom - box.top) / box.height) -
        Math.max(0, (r.top - box.top) / box.height),
    }))
    .filter((r) => r.width > 0 && r.height > 0 && r.x < 1 && r.y < 1);
  // Empty PDF.js selection guards can span the entire page. Never paint those.
  const seen = new Set<string>();
  const lines = rects.filter((r) => {
    if (r.height >= 0.15) return false;
    const key = [r.x, r.y, r.width, r.height]
      .map((v) => v.toFixed(5))
      .join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return lines.length
    ? { text: text.slice(0, 10000), rects: lines.slice(0, 500) }
    : null;
}
