import type { Token, Tokens } from "marked";
import type { SourceKind } from "./source-types";
export type ReadingBlock =
  | {
      type: "text";
      text: string;
      heading?: number;
      pre?: boolean;
      quote?: boolean;
    }
  | { type: "image"; src: string; alt: string }
  | {
      type: "table";
      rows: { blocks: ReadingBlock[]; colspan?: number; rowspan?: number }[][];
    };
export type ReadingDocument = {
  kind: Exclude<SourceKind, "pdf" | "pptx">;
  pages: ReadingBlock[][];
  texts: string[];
  pageCount: number;
  fingerprint: string;
  width: number;
  imageSize?: { width: number; height: number };
  urls: string[];
};
export const MAX_READING_BYTES = 25 * 1024 * 1024;
export function decodeStudyText(bytes: Uint8Array) {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff)
    text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("euc-kr", { fatal: true }).decode(bytes);
    }
  }
  if (/[\x00-\x08\x0e-\x1f]/.test(text))
    throw new Error("텍스트 파일이 아닙니다. UTF-8 TXT로 저장해 주세요.");
  return text.replace(/\r\n?/g, "\n").normalize("NFC");
}
export function blockText(block: ReadingBlock): string {
  return block.type === "text"
    ? block.text
    : block.type === "image"
      ? block.alt
      : block.rows
          .map((row) =>
            row.map((c) => c.blocks.map(blockText).join("\n")).join("\t"),
          )
          .join("\n");
}
export function paginateReading(blocks: ReadingBlock[]) {
  const pages: ReadingBlock[][] = [];
  let page: ReadingBlock[] = [],
    weight = 0;
  const put = (b: ReadingBlock) => {
    const n = b.type === "image" ? 1800 : Math.max(60, blockText(b).length);
    if (page.length && weight + n > 5000) {
      pages.push(page);
      page = [];
      weight = 0;
    }
    page.push(b);
    weight += n;
  };
  for (const block of blocks) {
    // A long paragraph cannot force an entire book into a single DOM page.
    if (block.type === "text" && block.text.length > 4500) {
      const chars = Array.from(block.text);
      for (let i = 0; i < chars.length; i += 4500)
        put({ ...block, text: chars.slice(i, i + 4500).join("") });
    } else if (block.type === "table" && block.rows.length > 30) {
      for (let i = 0; i < block.rows.length; i += 30)
        put({ ...block, rows: block.rows.slice(i, i + 30) });
    } else put(block);
    if (pages.length > 500)
      throw new Error("문서가 너무 깁니다. 500쪽 이하로 나눠 주세요.");
  }
  if (page.length) pages.push(page);
  if (!pages.length)
    throw new Error(
      "읽을 수 있는 글이나 사진이 없습니다. 원래 프로그램에서 PDF로 저장해 주세요.",
    );
  return pages;
}
async function markdownBlocks(text: string): Promise<ReadingBlock[]> {
  const { Lexer } = await import("marked");
  // Only tokens become React text. Never render raw Markdown HTML or remote images.
  const inline = (tokens: ReturnType<typeof Lexer.lexInline>): string =>
    tokens
      .map((t) => {
        if (t.type === "br") return "\n";
        if (t.type === "html") return t.raw;
        if ("tokens" in t && t.tokens) return inline(t.tokens);
        return "text" in t ? String(t.text) : t.raw;
      })
      .join("");
  const walk = (tokens: Token[], depth = 0): ReadingBlock[] => {
    if (depth > 12) throw new Error("Markdown의 문단 중첩이 너무 깊습니다.");
    return tokens.flatMap((t): ReadingBlock[] => {
      if (t.type === "space" || t.type === "def") return [];
      if (t.type === "heading") {
        const h = t as Tokens.Heading;
        return [{ type: "text", text: inline(h.tokens), heading: h.depth }];
      }
      if (t.type === "code") return [{ type: "text", text: t.text, pre: true }];
      if (t.type === "blockquote")
        return walk((t as Tokens.Blockquote).tokens, depth + 1).map((b) =>
          b.type === "text" ? { ...b, quote: true } : b,
        );
      if (t.type === "list")
        return (t as Tokens.List).items.flatMap((item, i) =>
          walk(item.tokens, depth + 1).map((b, j) =>
            b.type === "text" && !j
              ? {
                  ...b,
                  text: `${t.ordered ? `${Number(t.start) + i}.` : "•"} ${b.text}`,
                }
              : b,
          ),
        );
      if (t.type === "table")
        return [
          {
            type: "table",
            rows: [(t as Tokens.Table).header, ...(t as Tokens.Table).rows].map(
              (row) =>
                row.map((c) => ({
                  blocks: [{ type: "text", text: inline(c.tokens) }],
                })),
            ),
          },
        ];
      return [
        {
          type: "text",
          text:
            "tokens" in t && t.tokens
              ? inline(t.tokens)
              : "text" in t
                ? String(t.text)
                : t.raw,
        },
      ];
    });
  };
  return walk(Lexer.lex(text));
}
export function disposeReading(doc: ReadingDocument | null) {
  doc?.urls.forEach((url) => URL.revokeObjectURL(url));
}
export async function openReading(
  file: File,
  kind: ReadingDocument["kind"],
  progress: (n: number) => void,
): Promise<ReadingDocument> {
  const limit =
    kind === "txt" || kind === "md" ? 4 * 1024 * 1024 : MAX_READING_BYTES;
  if (!file.size || file.size > limit)
    throw new Error(
      `이 자료는 ${limit / 1024 / 1024}MB 이하 파일을 선택해 주세요.`,
    );
  progress(5);
  const bytes = await file.arrayBuffer();
  const urls: string[] = [];
  let blocks: ReadingBlock[], imageSize: ReadingDocument["imageSize"];
  try {
    if (kind === "txt" || kind === "md") {
      const text = decodeStudyText(new Uint8Array(bytes));
      if (!text.trim())
        throw new Error(
          "빈 텍스트 파일입니다. 글이 있는 자료를 선택해 주세요.",
        );
      blocks =
        kind === "md"
          ? await markdownBlocks(text)
          : text.split(/\n\s*\n/).map((text) => ({ type: "text", text }));
    } else if (kind === "image") {
      const b = new Uint8Array(bytes);
      const mime =
        b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71
          ? "image/png"
          : b[0] === 255 && b[1] === 216
            ? "image/jpeg"
            : new TextDecoder().decode(b.slice(0, 4)) === "RIFF" &&
                new TextDecoder().decode(b.slice(8, 12)) === "WEBP"
              ? "image/webp"
              : null;
      if (!mime)
        throw new Error(
          "사진을 읽지 못했습니다. JPG·PNG·WebP 파일을 선택해 주세요.",
        );
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      urls.push(url);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () =>
          reject(
            new Error("사진이 손상되었거나 이 브라우저에서 지원하지 않습니다."),
          );
        img.src = url;
      });
      if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 24000000)
        throw new Error("사진이 너무 큽니다. 2,400만 화소 이하로 줄여 주세요.");
      imageSize = { width: img.naturalWidth, height: img.naturalHeight };
      blocks = [{ type: "image", src: url, alt: file.name }];
    } else if (kind === "hwp") {
      const { readHwp } = await import("./reading-hwp");
      blocks = await readHwp(bytes, progress);
    } else {
      const { readOffice } = await import("./reading-office");
      blocks = await readOffice(bytes, kind, urls, progress);
    }
    progress(90);
    const pages = kind === "image" ? [blocks] : paginateReading(blocks);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    progress(100);
    return {
      kind,
      pages,
      texts: pages.map((p) => p.map(blockText).join("\n\n")),
      pageCount: pages.length,
      width: kind === "image" ? imageSize!.width : 800,
      imageSize,
      urls,
      fingerprint:
        `${kind}:` +
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
    };
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
