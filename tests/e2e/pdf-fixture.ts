import { PDFDocument, StandardFonts, PDFName, PDFDict } from "pdf-lib";
export async function pdfFixture(blank = false, large = false) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2020-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2020-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Dudada def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n6 beginbfchar\n<41> <AC04>\n<42> <D638>\n<43> <C0AC>\n<58> <0049>\n<59> <0043>\n<5A> <0055>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  for (let i = 1; i <= 8; i++) {
    const page = doc.addPage([600, 800]);
    if (!blank) {
      page.drawText(`ABC 12 (XYZ).`, { x: 40, y: 700, font, size: 16 });
      page.drawText(`Page ${i}`, { x: 40, y: 650, font, size: 12 });
    }
  }
  await font.embed();
  const stream = doc.context.register(doc.context.flateStream(cmap));
  doc.context.lookup(font.ref, PDFDict).set(PDFName.of("ToUnicode"), stream);
  if (large)
    doc.context.register(doc.context.stream(new Uint8Array(101 * 1024 * 1024)));
  return Buffer.from(await doc.save());
}
