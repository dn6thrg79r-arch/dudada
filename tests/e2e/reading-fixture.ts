import JSZip from "jszip";
import * as CFB from "cfb";
import { deflateSync } from "fflate";
export const photo = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABGCAIAAACIdsdYAAAAl0lEQVR4nO3QQQkAIADAQBP7No5RbaEwDxZg3Jh76ULj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVgd2K//AdL/5zQAAAABJRU5ErkJggg==",
  "base64",
);
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export async function officeFixture(kind: "docx" | "hwpx", hostile = false) {
  const zip = new JSZip(),
    attack =
      '<img src="https://reading-leak.invalid/x" onerror="document.body.dataset.attack=1">';
  if (kind === "docx") {
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "_rels/.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    const p = (s: string) => `<w:p><w:r><w:t>${escape(s)}</w:t></w:r></w:p>`;
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>한국어 Word 학습자료</w:t></w:r></w:p>${p("환자 123명의 AI 연구 결과를 읽습니다.")}<w:tbl><w:tr><w:tc>${p("자료")}</w:tc><w:tc>${p("한국어 표")}</w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p>${hostile ? p(attack) : ""}<w:p><w:r><w:drawing><a:blip r:embed="external"/></w:drawing></w:r></w:p></w:body></w:document>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://reading-leak.invalid/photo.png" TargetMode="External"/></Relationships>',
    );
    zip.file("word/media/image1.png", photo);
  } else {
    zip.file("mimetype", "application/hwp+zip");
    zip.file(
      "Contents/content.hpf",
      '<opf:package xmlns:opf="http://www.idpf.org/2007/opf"><opf:manifest><opf:item id="section0" href="section0.xml" media-type="application/xml"/><opf:item id="image1" href="../BinData/image1.png" media-type="image/png"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>',
    );
    const p = (s: string) =>
      `<hp:p><hp:run><hp:t>${escape(s)}</hp:t></hp:run></hp:p>`;
    zip.file(
      "Contents/section0.xml",
      `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">${p("한국어 한글 HWPX 학습자료")}${p("환자 123명의 AI 연구 결과를 읽습니다.")}<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList>${p("자료")}</hp:subList><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc><hp:tc><hp:subList>${p("한국어 표")}</hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p><hp:p><hp:run><hp:pic><hc:img binaryItemIDRef="image1"/></hp:pic></hp:run></hp:p>${hostile ? p(attack) : ""}</hs:sec>`,
    );
    zip.file("BinData/image1.png", photo);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
export function hwpFixture(encrypted = false) {
  const header = Buffer.alloc(256);
  header.write("HWP Document File");
  header.writeUInt32LE(0x05000300, 32);
  header.writeUInt32LE(encrypted ? 3 : 1, 36);
  const text = Buffer.from(
    "한국어 HWP 본문을 읽습니다. AI 연구 결과 123명\r",
    "utf16le",
  );
  const record = Buffer.alloc(text.length + 4);
  record.writeUInt32LE(67 | (text.length << 20), 0);
  text.copy(record, 4);
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, "FileHeader", header);
  CFB.utils.cfb_add(cfb, "BodyText/Section0", deflateSync(record));
  return Buffer.from(CFB.write(cfb, { type: "buffer" }));
}
