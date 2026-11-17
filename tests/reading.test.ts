import { it, expect } from "vitest";
import JSZip from "jszip";
import { decodeStudyText, paginateReading, blockText } from "../lib/reading";
import { readHwp, readHwpParagraphs } from "../lib/reading-hwp";
import {
  checkDocumentZip,
  localPart,
  readDocumentZip,
} from "../lib/document-archive";
import { sourceKind, sourceMime } from "../lib/source-types";
import { hwpFixture } from "./e2e/reading-fixture";
it("UTF-8·UTF-16·한국어 CP949 TXT를 줄바꿈 손실 없이 읽고 바이너리를 거절한다", () => {
  expect(decodeStudyText(new TextEncoder().encode("한글\r\nAI\r다음"))).toBe(
    "한글\nAI\n다음",
  );
  expect(
    decodeStudyText(
      new Uint8Array(
        Buffer.concat([
          Buffer.from([255, 254]),
          Buffer.from("한글 UTF16", "utf16le"),
        ]),
      ),
    ),
  ).toBe("한글 UTF16");
  expect(
    decodeStudyText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xb9, 0xbe, 0xee])),
  ).toBe("한국어");
  expect(() => decodeStudyText(new Uint8Array([0, 1, 2, 3]))).toThrow(
    "텍스트 파일",
  );
});
it("원문을 고정 단위로 나누고 한글·이모지·문단 순서를 보존한다", () => {
  const text = "한글😀".repeat(4000),
    pages = paginateReading([{ type: "text", text }]);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.flat().map(blockText).join("")).toBe(text);
  expect(() => paginateReading([])).toThrow("글이나 사진");
});
it("문서 ZIP의 폭탄·잘못된 경로·실행 개체를 압축 해제 전에 막는다", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", "x");
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  expect(checkDocumentZip(bytes).has("word/document.xml")).toBe(true);
  const bad = bytes.slice(0),
    v = new DataView(bad);
  for (let i = 0; i < bad.byteLength - 46; i++)
    if (v.getUint32(i, true) === 0x02014b50) {
      v.setUint32(i + 24, 0xffffffff, true);
      break;
    }
  expect(() => checkDocumentZip(bad)).toThrow("너무 큽니다");
  zip.file("../escape.xml", "x");
  expect(() => checkDocumentZip(new ArrayBuffer(0))).toThrow();
  await expect(
    zip.generateAsync({ type: "arraybuffer" }).then(checkDocumentZip),
  ).rejects.toThrow("경로");
  expect(
    localPart("word/document.xml", "https://outside.invalid/a.png"),
  ).toBeNull();
  expect(localPart("Contents/content.hpf", "../BinData/image1.png")).toBe(
    "BinData/image1.png",
  );
});
it("압축된 HWP 5 본문을 읽고 암호화·손상·구형 파일을 구분한다", async () => {
  const bytes = hwpFixture();
  expect(
    (
      await readHwp(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
        () => {},
      )
    )
      .map(blockText)
      .join(""),
  ).toContain("한국어 HWP 본문");
  const locked = hwpFixture(true);
  await expect(
    readHwp(
      locked.buffer.slice(
        locked.byteOffset,
        locked.byteOffset + locked.byteLength,
      ) as ArrayBuffer,
      () => {},
    ),
  ).rejects.toThrow("암호");
  await expect(readHwp(new ArrayBuffer(8), () => {})).rejects.toThrow("HWP 5");
  expect(() => readHwpParagraphs(new Uint8Array([67, 0, 0, 255]))).toThrow(
    "기록",
  );
});
it("원본 확장자별 MIME을 복원하고 지원하지 않는 실행 파일은 선택하지 않는다", () => {
  for (const name of [
    "한글.HWPX",
    "한글.hwp",
    "노트.TXT",
    "자료.docx",
    "사진.jpeg",
    "발표.pptx",
    "자료.PDF",
  ])
    expect(sourceKind(name)).not.toBeNull();
  expect(sourceMime("사진.JPG")).toBe("image/jpeg");
  expect(sourceMime("자료.docx")).toContain("wordprocessingml");
  expect(sourceKind("앱.exe")).toBeNull();
  expect(sourceKind("옛파일.doc")).toBeNull();
});

it("읽기 화면에 필요한 파일만 풀고, 생략하는 파일도 경로와 전체 용량을 검사한다", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", "본문");
  zip.file("word/fonts/unused.dat", new Uint8Array(10 * 1024 * 1024));
  zip.file("docProps/thumbnail.bin", new Uint8Array(1024));
  const bytes = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
  });
  const progress: number[] = [];
  const result = await readDocumentZip(
    bytes,
    (n) => progress.push(n),
    (name) => name === "word/document.xml",
  );
  expect([...result.keys()]).toEqual(["word/document.xml"]);
  expect(new TextDecoder().decode(result.get("word/document.xml"))).toBe(
    "본문",
  );
  expect(progress.at(-1)).toBe(75);
  zip.file("../unused.dat", "invalid");
  await expect(
    zip.generateAsync({ type: "arraybuffer" }).then((b) =>
      readDocumentZip(
        b,
        () => {},
        (name) => name === "word/document.xml",
      ),
    ),
  ).rejects.toThrow("경로");
});
