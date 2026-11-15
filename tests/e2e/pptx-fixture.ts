import PptxGenJS from "pptxgenjs";
export async function pptxFixture(hostile = false) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "Dudada test";
  deck.subject = "Local browser fixture";
  for (let i = 1; i <= 2; i++) {
    const slide = deck.addSlide();
    slide.background = { color: "F8FAFC" };
    slide.addShape(deck.ShapeType.rect, {
      x: 0.4,
      y: 0.35,
      w: 12.5,
      h: 0.8,
      fill: { color: "E2EEDC" },
      line: { color: "E2EEDC" },
    });
    slide.addText(
      i === 1 ? "두다다 공부방 · 첫 슬라이드" : "AI와 THE GREAT FUTURE",
      {
        x: 0.6,
        y: 0.45,
        w: 11,
        h: 0.5,
        fontSize: 26,
        color: "294C36",
        fontFace: "Arial",
      },
    );
    slide.addText("한국어 학습자료 123 · 환자 설명과 연구 결과", {
      x: 0.7,
      y: 1.6,
      w: 10,
      h: 0.6,
      fontSize: 20,
      color: "334155",
    });
    slide.addTable(
      [
        [{ text: "자료" }, { text: "결과" }],
        [{ text: "한국어 표" }, { text: "123명" }],
      ],
      {
        x: 0.7,
        y: 3,
        w: 7,
        border: { color: "CBD5E1", pt: 1 },
        fontSize: 16,
        fill: { color: "FFFFFF" },
        color: "334155",
      },
    );
    slide.addImage({
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZfkAAAAASUVORK5CYII=",
      x: 9,
      y: 3,
      w: 2,
      h: 1,
    });
    if (hostile)
      slide.addText(
        '<img src="https://pptx-leak.invalid/" onerror="parent.document.body.dataset.pptxAttack=1">',
        { x: 0.7, y: 5, w: 11, h: 0.5, fontSize: 12 },
      );
  }
  return Buffer.from(
    (await deck.write({ outputType: "nodebuffer" })) as Buffer,
  );
}
