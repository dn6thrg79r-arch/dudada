import type JSZip from "jszip";
const LIMIT = 80 * 1024 * 1024;
// Check the ZIP directory before allocating any expanded document bytes.
export function checkDocumentZip(buffer: ArrayBuffer) {
  const v = new DataView(buffer);
  let end = -1;
  for (
    let i = buffer.byteLength - 22;
    i >= Math.max(0, buffer.byteLength - 65557);
    i--
  ) {
    if (
      v.getUint32(i, true) === 0x06054b50 &&
      i + 22 + v.getUint16(i + 20, true) === buffer.byteLength
    ) {
      end = i;
      break;
    }
  }
  if (end < 0)
    throw new Error(
      "손상되었거나 암호화된 문서입니다. 원래 프로그램에서 PDF로 저장해 주세요.",
    );
  let at = v.getUint32(end + 16, true),
    total = 0;
  const count = v.getUint16(end + 10, true),
    names = new Set<string>();
  if (
    !count ||
    count > 5000 ||
    at >= end ||
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true)
  )
    throw new Error("지원하지 않는 문서 압축 형식입니다.");
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50)
      throw new Error("문서 압축 정보가 손상되었습니다.");
    const size = v.getUint32(at + 24, true),
      n = v.getUint16(at + 28, true);
    const next =
      at + 46 + n + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    if (
      next > end ||
      v.getUint16(at + 8, true) & 1 ||
      ![0, 8].includes(v.getUint16(at + 10, true))
    )
      throw new Error("암호화되었거나 지원하지 않는 문서입니다.");
    const name = new TextDecoder().decode(new Uint8Array(buffer, at + 46, n));
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      names.has(name)
    )
      throw new Error("문서 내부 경로가 올바르지 않습니다.");
    if (/vbaproject|activex|(?:^|\/)embeddings\/.*\.bin$/i.test(name))
      throw new Error("매크로나 실행 개체가 있는 문서는 PDF로 저장해 주세요.");
    total += size;
    if (
      total > LIMIT ||
      (/\.(xml|rels|hpf)$/i.test(name) && size > 8 * 1024 * 1024)
    )
      throw new Error(
        "문서의 압축 해제 용량이 너무 큽니다. 문서를 나눠 주세요.",
      );
    names.add(name);
    at = next;
  }
  return names;
}
async function boundedEntry(
  entry: JSZip.JSZipObject,
  limit: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Uint8Array[] = [];
    const stream = (
      entry as JSZip.JSZipObject & {
        internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
      }
    ).internalStream("uint8array");
    stream.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        stream.pause();
        reject(new Error("문서 압축 해제 용량이 너무 큽니다."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      const result = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        result.set(chunk, at);
        at += chunk.length;
      }
      resolve(result);
    });
    stream.resume();
  });
}
export async function readDocumentZip(
  bytes: ArrayBuffer,
  progress: (n: number) => void,
) {
  const names = checkDocumentZip(bytes);
  const { default: Zip } = await import("jszip");
  const zip = await Zip.loadAsync(bytes),
    files = new Map<string, Uint8Array>();
  let size = 0,
    done = 0;
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    const data = await boundedEntry(
      entry,
      Math.min(
        LIMIT - size,
        /\.(xml|rels|hpf)$/i.test(name) ? 8 * 1024 * 1024 : LIMIT,
      ),
    );
    size += data.length;
    files.set(name, data);
    progress(10 + Math.round((++done / names.size) * 65));
  }
  return files;
}
export function documentXml(bytes?: Uint8Array) {
  if (!bytes) throw new Error("문서의 본문 정보를 찾지 못했습니다.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("지원하지 않는 XML이 포함된 문서입니다.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("문서의 XML이 손상되었습니다.");
  return doc;
}
export function localPart(owner: string, target: string) {
  if (/^[a-z][a-z\d+.-]*:|^\/\/|\\/i.test(target)) return null;
  try {
    const u = new URL(target, "https://document.invalid/" + owner);
    return u.origin === "https://document.invalid"
      ? decodeURIComponent(u.pathname.slice(1))
      : null;
  } catch {
    return null;
  }
}
