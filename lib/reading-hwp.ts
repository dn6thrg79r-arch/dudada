import type { ReadingBlock } from "./reading";
export function readHwpParagraphs(bytes: Uint8Array): ReadingBlock[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    blocks: ReadingBlock[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length)
      throw new Error("HWP 본문 기록이 손상되었습니다.");
    const header = view.getUint32(at, true),
      tag = header & 1023;
    let size = header >>> 20;
    at += 4;
    if (size === 4095) {
      if (at + 4 > bytes.length) throw new Error("HWP 기록이 손상되었습니다.");
      size = view.getUint32(at, true);
      at += 4;
    }
    if (at + size > bytes.length)
      throw new Error("HWP 기록 길이가 올바르지 않습니다.");
    if (tag === 67) {
      if (size % 2) throw new Error("HWP 글자 기록이 손상되었습니다.");
      let text = "";
      for (let i = at; i < at + size; i += 2) {
        const code = view.getUint16(i, true);
        if (code >= 32) text += String.fromCharCode(code);
        else if (code === 10) text += "\n";
        else if (code === 13) {
          /* paragraph terminator */
        } else if (code === 24) text += "-";
        else if (code === 30 || code === 31) text += " ";
        else if (code > 0 && code < 24) {
          // Inline/extended controls occupy eight UTF-16 units, not visible text.
          if (i + 16 > at + size)
            throw new Error("HWP 제어 문자가 손상되었습니다.");
          if (code === 9) text += "\t";
          i += 14;
        }
      }
      if (text.trim())
        blocks.push({ type: "text", text: text.normalize("NFC") });
    }
    at += size;
  }
  return blocks;
}
export async function readHwp(
  bytes: ArrayBuffer,
  progress: (n: number) => void,
): Promise<ReadingBlock[]> {
  const raw = new Uint8Array(bytes);
  if (![208, 207, 17, 224, 161, 177, 26, 225].every((n, i) => raw[i] === n))
    throw new Error(
      "HWP 5 문서가 아닙니다. 구형 HWP 3 문서는 HWPX 또는 PDF로 저장해 주세요.",
    );
  const CFB = await import("cfb");
  let compound: ReturnType<typeof CFB.read>;
  try {
    compound = CFB.read(raw, { type: "array" });
  } catch {
    throw new Error(
      "손상되었거나 지원하지 않는 HWP입니다. HWPX 또는 PDF로 저장해 주세요.",
    );
  }
  const entry = CFB.find(compound, "FileHeader"),
    h = entry ? new Uint8Array(entry.content) : null;
  if (
    !h ||
    h.length < 40 ||
    new TextDecoder().decode(h.slice(0, 17)) !== "HWP Document File" ||
    h[35] !== 5
  )
    throw new Error(
      "지원하지 않는 HWP 버전입니다. HWPX 또는 PDF로 저장해 주세요.",
    );
  const flags = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(
    36,
    true,
  );
  if (flags & (2 | 4 | 16 | 256))
    throw new Error(
      "암호·배포 제한·DRM이 있는 HWP는 열 수 없습니다. 권한이 있는 원본을 HWPX 또는 PDF로 저장해 주세요.",
    );
  const sections = compound.FullPaths.map((p, i) => ({
    path: p,
    entry: compound.FileIndex[i],
  }))
    .filter((p) => /\/BodyText\/Section\d+$/i.test(p.path))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (!sections.length || sections.length > 500)
    throw new Error("HWP 본문이 없거나 문서가 너무 깁니다.");
  const { Inflate } = await import("fflate");
  const blocks: ReadingBlock[] = [];
  let total = 0;
  for (let i = 0; i < sections.length; i++) {
    let data = new Uint8Array(sections[i].entry.content);
    if (flags & 1) {
      const chunks: Uint8Array[] = [];
      let length = 0;
      const inflate = new Inflate((chunk) => {
        length += chunk.length;
        if (length > 16 * 1024 * 1024 || total + length > 40 * 1024 * 1024)
          throw new Error("HWP 본문 용량이 너무 큽니다. 문서를 나눠 주세요.");
        chunks.push(chunk);
      });
      try {
        for (let at = 0; at < data.length; at += 4096) {
          inflate.push(data.subarray(at, at + 4096), at + 4096 >= data.length);
          if (at % 65536 === 0) await new Promise((r) => setTimeout(r, 0));
        }
      } catch (error) {
        throw new Error(
          error instanceof Error && error.message.includes("너무")
            ? error.message
            : "HWP 압축 본문이 손상되었습니다. PDF로 저장해 주세요.",
        );
      }
      data = new Uint8Array(length);
      let at = 0;
      for (const chunk of chunks) {
        data.set(chunk, at);
        at += chunk.length;
      }
    }
    total += data.length;
    if (total > 40 * 1024 * 1024)
      throw new Error("HWP 본문 용량이 너무 큽니다.");
    blocks.push(...readHwpParagraphs(data));
    progress(15 + Math.round(((i + 1) / sections.length) * 65));
    await new Promise((r) => setTimeout(r, 0));
  }
  return blocks;
}
