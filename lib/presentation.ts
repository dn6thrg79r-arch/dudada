import type JSZip from "jszip";
export const MAX_PRESENTATION_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED = 120 * 1024 * 1024;
export type PresentationDocument = {
  kind: "pptx";
  bytes: ArrayBuffer;
  pageCount: number;
  width: number;
  height: number;
  fingerprint: string;
  texts: string[];
  slidePaths: string[];
};
// Read the central directory before decompression; never trust a renamed .zip or
// let a tiny compressed upload expand without a bound in an iPad browser.
export function scanPptxArchive(
  buffer: ArrayBuffer,
  onEntry?: (name: string, method: number) => void,
) {
  const v = new DataView(buffer);
  let end = -1;
  for (
    let at = buffer.byteLength - 22;
    at >= Math.max(0, buffer.byteLength - 65557);
    at--
  ) {
    if (
      v.getUint32(at, true) === 0x06054b50 &&
      at + 22 + v.getUint16(at + 20, true) === buffer.byteLength
    ) {
      end = at;
      break;
    }
  }
  if (end < 0)
    throw new Error(
      "손상되었거나 암호가 걸린 PPTX입니다. PDF로 내보내 다시 불러와 주세요.",
    );
  const count = v.getUint16(end + 10, true),
    start = v.getUint32(end + 16, true);
  if (
    v.getUint16(end + 4, true) !== 0 ||
    v.getUint16(end + 6, true) !== 0 ||
    !count ||
    count > 10000 ||
    start >= end
  )
    throw new Error("이 PPTX는 너무 크거나 지원하지 않는 압축 형식입니다.");
  let offset = start,
    total = 0;
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || v.getUint32(offset, true) !== 0x02014b50)
      throw new Error("PPTX 파일 정보를 읽지 못했습니다.");
    const flags = v.getUint16(offset + 8, true),
      method = v.getUint16(offset + 10, true),
      size = v.getUint32(offset + 24, true);
    const n = v.getUint16(offset + 28, true),
      extra = v.getUint16(offset + 30, true),
      comment = v.getUint16(offset + 32, true);
    const next = offset + 46 + n + extra + comment;
    if (next > end || flags & 1 || ![0, 8].includes(method))
      throw new Error(
        "암호가 있거나 지원하지 않는 PPTX입니다. PDF로 저장해 불러와 주세요.",
      );
    const name = new TextDecoder().decode(
      new Uint8Array(buffer, offset + 46, n),
    );
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      names.has(name)
    )
      throw new Error("PPTX 내부 파일 경로가 올바르지 않습니다.");
    if (
      !name.endsWith("/") &&
      /vbaproject|activex|ppt\/embeddings\/.*\.bin$/i.test(name)
    )
      throw new Error(
        "매크로나 실행 개체가 포함된 자료는 PDF로 내보내 불러와 주세요.",
      );
    if (/\.(mp4|mov|mp3|wav|wmv|avi|webm|ogg)$/i.test(name))
      throw new Error("동영상·음성 포함 자료는 PDF로 내보내 불러와 주세요.");
    names.add(name);
    onEntry?.(name, method);
    total += size;
    if (
      total > MAX_EXPANDED ||
      (/\.(xml|rels)$/i.test(name) && size > 8 * 1024 * 1024)
    )
      throw new Error(
        "슬라이드 자료가 너무 큽니다. 슬라이드를 나눠 불러와 주세요.",
      );
    offset = next;
  }
  if (!names.has("[Content_Types].xml") || !names.has("ppt/presentation.xml"))
    throw new Error("PPTX 프레젠테이션 파일이 아닙니다.");
  return names;
}
function readEntry(
  entry: JSZip.JSZipObject,
  limit: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0,
      failed = false;
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream.on("data", (chunk) => {
      length += chunk.length;
      if (length > limit) {
        failed = true;
        stream.pause();
        reject(new Error("PPTX 압축을 푼 자료가 너무 큽니다."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (failed) return;
      const result = new Uint8Array(length);
      let at = 0;
      for (const c of chunks) {
        result.set(c, at);
        at += c.length;
      }
      resolve(result);
    });
    stream.resume();
  });
}
const P = "http://schemas.openxmlformats.org/presentationml/2006/main",
  A = "http://schemas.openxmlformats.org/drawingml/2006/main",
  R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function xmlDocument(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("지원하지 않는 XML이 포함된 PPTX입니다.");
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length)
    throw new Error("손상된 PPTX 문서를 읽지 못했습니다.");
  // The preview package uses innerHTML for text runs. Re-serialize text rather
  // than CDATA/markup, so user text can never become executable HTML.
  const walk = (node: Node) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === Node.CDATA_SECTION_NODE)
        node.replaceChild(xml.createTextNode(c.textContent || ""), c);
      else walk(c);
    }
  };
  walk(xml);
  for (const node of [...xml.getElementsByTagNameNS(A, "t")])
    node.replaceChildren(xml.createTextNode(node.textContent || ""));
  return xml;
}
function resolvePart(owner: string, target: string) {
  try {
    const url = new URL(target, "https://pptx.invalid/" + owner);
    return url.origin === "https://pptx.invalid"
      ? decodeURIComponent(url.pathname.slice(1))
      : null;
  } catch {
    return null;
  }
}
export async function openPresentation(
  file: File,
  onProgress: (n: number) => void,
): Promise<PresentationDocument> {
  if (
    !/\.pptx$/i.test(file.name) ||
    !file.size ||
    file.size > MAX_PRESENTATION_BYTES
  )
    throw new Error("PPTX는 50MB 이하 파일을 선택해 주세요.");
  onProgress(5);
  const original = await file.arrayBuffer();
  const methods = new Map<string, number>();
  const names = scanPptxArchive(original, (name, method) =>
    methods.set(name, method),
  );
  onProgress(10);
  const { default: Zip } = await import("jszip");
  const zip = await Zip.loadAsync(original);
  const docs = new Map<string, Document>();
  let total = 0,
    done = 0;
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    const bytes = await readEntry(entry, MAX_EXPANDED - total);
    total += bytes.length;
    if (/\.(xml|rels)$/i.test(name)) {
      const doc = xmlDocument(new TextDecoder().decode(bytes));
      if (name.endsWith(".rels")) {
        const owner = name
          .replace(/(^|\/)_rels\//, "$1")
          .replace(/\.rels$/, "");
        for (const rel of [
          ...doc.getElementsByTagNameNS("*", "Relationship"),
        ]) {
          const target = resolvePart(owner, rel.getAttribute("Target") || "");
          if (
            rel.getAttribute("TargetMode") === "External" ||
            !target ||
            !names.has(target)
          )
            rel.remove();
        }
      }
      if (name === "[Content_Types].xml") {
        // Some producers list unused slide masters that are absent from the ZIP.
        for (const part of [...doc.getElementsByTagNameNS("*", "Override")]) {
          const path = (part.getAttribute("PartName") || "").replace(/^\//, "");
          if (!names.has(path)) part.remove();
        }
      }
      docs.set(name, doc);
      zip.file(name, new XMLSerializer().serializeToString(doc));
    } else
      entry.options.compression = methods.get(name) === 0 ? "STORE" : "DEFLATE";
    // Unchanged binary entries retain JSZip's original compressed bytes.
    // Replacing them with inflated data forces every photo to be compressed
    // again during generation, even though only XML was sanitized.
    onProgress(10 + Math.round((++done / names.size) * 45));
  }
  const presentation = docs.get("ppt/presentation.xml")!,
    rels = docs.get("ppt/_rels/presentation.xml.rels");
  const size = presentation.getElementsByTagNameNS(P, "sldSz")[0];
  const width = Number(size?.getAttribute("cx")) / 9525,
    height = Number(size?.getAttribute("cy")) / 9525;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 100 ||
    height < 100 ||
    width > 5000 ||
    height > 5000
  )
    throw new Error(
      "지원하지 않는 슬라이드 크기입니다. PDF로 저장해 불러와 주세요.",
    );
  const targets = new Map(
    [...(rels?.getElementsByTagNameNS("*", "Relationship") || [])].map((r) => [
      r.getAttribute("Id"),
      resolvePart("ppt/presentation.xml", r.getAttribute("Target") || ""),
    ]),
  );
  const slides = [...presentation.getElementsByTagNameNS(P, "sldId")];
  if (!slides.length || slides.length > 300)
    throw new Error("PPTX는 1~300장씩 나눠 불러와 주세요.");
  const slidePaths: string[] = [];
  const texts = slides.map((s) => {
    const part = targets.get(s.getAttributeNS(R, "id"));
    const doc = part ? docs.get(part) : null;
    if (!doc || !part) throw new Error("슬라이드 정보를 찾지 못했습니다.");
    slidePaths.push(part);
    return [...doc.getElementsByTagNameNS(A, "t")]
      .map((t) => t.textContent || "")
      .join(" ");
  });
  const clean = await zip.generateAsync(
    {
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 1 },
    },
    (info) => onProgress(55 + Math.round(info.percent * 0.4)),
  );
  const hash = await crypto.subtle.digest("SHA-256", original);
  onProgress(100);
  return {
    kind: "pptx",
    bytes: clean,
    pageCount: slides.length,
    width,
    height,
    texts,
    slidePaths,
    fingerprint:
      "pptx:" +
      Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
  };
}
