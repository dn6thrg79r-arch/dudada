import { documentXml, localPart, readDocumentZip } from "./document-archive";
import type { ReadingBlock } from "./reading";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const descendants = (node: Element | Document, name: string) => [
  ...node.getElementsByTagNameNS("*", name),
];
export async function readOffice(
  bytes: ArrayBuffer,
  kind: "docx" | "hwpx",
  urls: string[],
  progress: (n: number) => void,
): Promise<ReadingBlock[]> {
  const files = await readDocumentZip(bytes, progress);
  const images = new Map<string, string>(),
    imageUrls = new Map<string, string>();
  let imageBytes = 0,
    nodes = 0;
  const image = (id: string): ReadingBlock => {
    const path = images.get(id),
      data = path ? files.get(path) : undefined;
    if (!data)
      return {
        type: "text",
        text: "[그림을 표시할 수 없습니다. 원래 모양이 필요하면 PDF로 저장해 주세요.]",
      };
    let src = imageUrls.get(path!);
    if (!src) {
      const mime =
        data[0] === 137 && data[1] === 80
          ? "image/png"
          : data[0] === 255 && data[1] === 216
            ? "image/jpeg"
            : new TextDecoder().decode(data.slice(0, 3)) === "GIF"
              ? "image/gif"
              : new TextDecoder().decode(data.slice(8, 12)) === "WEBP"
                ? "image/webp"
                : "";
      if (!mime)
        return {
          type: "text",
          text: "[이 그림 형식은 PDF로 저장하면 볼 수 있어요.]",
        };
      imageBytes += data.length;
      if (imageBytes > 20 * 1024 * 1024)
        throw new Error("문서의 사진 용량이 너무 큽니다. PDF로 저장해 주세요.");
      src = URL.createObjectURL(
        new Blob([new Uint8Array(data)], { type: mime }),
      );
      urls.push(src);
      imageUrls.set(path!, src);
    }
    return { type: "image", src, alt: "문서에 포함된 그림" };
  };
  function visitGuard(depth: number) {
    if (++nodes > 60000 || depth > 30)
      throw new Error("문서 구조가 너무 복잡합니다. PDF로 저장해 주세요.");
  }
  function paragraph(el: Element, depth: number): ReadingBlock[] {
    visitGuard(depth);
    const result: ReadingBlock[] = [];
    let text = "";
    const style = descendants(el, "pStyle")[0]?.getAttributeNS(W, "val") || "";
    const heading = /(?:heading|제목)\s*([1-6])/i.exec(style);
    const flush = () => {
      if (text.length) {
        result.push({
          type: "text",
          text,
          heading: heading ? Number(heading[1]) : undefined,
        });
        text = "";
      }
    };
    function run(node: Element, d: number) {
      visitGuard(d);
      if (node.localName === "tbl") {
        flush();
        result.push(table(node, d + 1));
        return;
      }
      if (
        node.localName === "drawing" ||
        node.localName === "pict" ||
        node.localName === "pic"
      ) {
        const ref =
          descendants(node, "blip")[0]?.getAttributeNS(R, "embed") ||
          descendants(node, "imagedata")[0]?.getAttributeNS(R, "id") ||
          descendants(node, "img")[0]?.getAttribute("binaryItemIDRef");
        flush();
        result.push(image(ref || ""));
        return;
      }
      if (node.localName === "t") {
        for (const child of node.childNodes) {
          if (
            child.nodeType === Node.TEXT_NODE ||
            child.nodeType === Node.CDATA_SECTION_NODE
          )
            text += child.nodeValue || "";
          else if (child.nodeType === Node.ELEMENT_NODE)
            run(child as Element, d + 1);
        }
        return;
      }
      if (node.localName === "tab") {
        text += "\t";
        return;
      }
      if (["br", "lineBreak", "cr"].includes(node.localName)) {
        text += "\n";
        return;
      }
      for (const child of node.children) run(child, d + 1);
    }
    for (const child of el.children) run(child, depth + 1);
    flush();
    return result;
  }
  function table(el: Element, depth: number): ReadingBlock {
    visitGuard(depth);
    // Only direct rows/cells belong to this table; nested tables are parsed in their own cells.
    const rows = [...el.children]
      .filter((c) => c.localName === "tr")
      .map((row) =>
        [...row.children]
          .filter((c) => c.localName === "tc")
          .map((cell) => {
            const span = descendants(cell, "cellSpan")[0];
            const docxSpan = descendants(cell, "gridSpan")[0]?.getAttributeNS(
              W,
              "val",
            );
            return {
              blocks: container(cell, depth + 1),
              colspan: Math.min(
                50,
                Math.max(
                  1,
                  Number(docxSpan || span?.getAttribute("colSpan") || 1),
                ),
              ),
              rowspan:
                kind === "hwpx"
                  ? Math.min(
                      50,
                      Math.max(1, Number(span?.getAttribute("rowSpan") || 1)),
                    )
                  : 1,
            };
          }),
      );
    return { type: "table", rows };
  }
  function container(el: Element, depth: number): ReadingBlock[] {
    visitGuard(depth);
    return [...el.children].flatMap((child) => {
      if (child.localName === "p") return paragraph(child, depth + 1);
      if (child.localName === "tbl") return [table(child, depth + 1)];
      if (
        ["sdt", "sdtContent", "subList", "body", "sec"].includes(
          child.localName,
        )
      )
        return container(child, depth + 1);
      return [];
    });
  }
  if (kind === "docx") {
    if (!files.has("[Content_Types].xml") || !files.has("word/document.xml"))
      throw new Error(
        "Word DOCX 문서가 아닙니다. DOC 파일은 DOCX 또는 PDF로 저장해 주세요.",
      );
    const rel = files.get("word/_rels/document.xml.rels");
    if (rel)
      for (const r of descendants(documentXml(rel), "Relationship")) {
        if (r.getAttribute("TargetMode") === "External") continue;
        const part = localPart(
          "word/document.xml",
          r.getAttribute("Target") || "",
        );
        if (part && files.has(part))
          images.set(r.getAttribute("Id") || "", part);
      }
    const root = documentXml(files.get("word/document.xml"));
    const body = descendants(root, "body")[0];
    if (!body) throw new Error("Word 본문을 찾지 못했습니다.");
    return container(body, 0);
  }
  if (!files.has("Contents/content.hpf"))
    throw new Error(
      "한글 HWPX 문서가 아닙니다. 한글에서 HWPX 또는 PDF로 저장해 주세요.",
    );
  const content = documentXml(files.get("Contents/content.hpf"));
  const parts = new Map<string, string>();
  for (const item of descendants(content, "item")) {
    const path = localPart(
      "Contents/content.hpf",
      item.getAttribute("href") || "",
    );
    if (path && files.has(path)) {
      parts.set(item.getAttribute("id") || "", path);
      images.set(item.getAttribute("id") || "", path);
    }
  }
  const ordered = descendants(content, "itemref")
    .map((i) => parts.get(i.getAttribute("idref") || ""))
    .filter((p): p is string => !!p && /section\d+\.xml$/i.test(p));
  const sections = ordered.length
    ? ordered
    : [...files.keys()]
        .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!sections.length) throw new Error("한글 문서의 본문을 찾지 못했습니다.");
  return sections.flatMap((path) =>
    container(documentXml(files.get(path)).documentElement, 0),
  );
}
