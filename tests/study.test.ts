import { describe, it, expect } from "vitest";
import {
  compare,
  clean,
  createMaterial,
  sentences,
  parseRange,
  cpm,
} from "../lib/study";
import { readingOrder } from "../lib/pdf";
describe("한국어 학습 도구", () => {
  it("Unicode 정규화와 숫자, 약어, 괄호를 비교한다", () => {
    expect(
      compare("간호사 12명 (ICU).", "간호사 12명 (ICU).".normalize("NFD"))
        .complete,
    ).toBe(true);
    expect(compare("환자 3명", "환자 4명").accuracy).toBe(80);
  });
  it("오타 삭제·수정 후 정확도를 회복한다", () => {
    expect(compare("간호", "가노").accuracy).toBe(0);
    expect(compare("간호", "간").accuracy).toBe(100);
    expect(compare("간호", "간호").complete).toBe(true);
    expect(compare("간호", "간호사").complete).toBe(false);
  });
  it("문장부호와 원문 페이지를 유지한다", () => {
    const m = createMaterial("노트", [
      { number: 3, text: "연구 결과는 12%입니다. ICU (3명)입니다!" },
    ]);
    expect(sentences(m).map((s) => s.text)).toEqual([
      "연구 결과는 12%입니다.",
      "ICU (3명)입니다!",
    ]);
    expect(sentences(m)[0].page).toBe(3);
    m.mode = "exact";
    m.pages[0].text = "첫째  줄\n둘째 줄";
    expect(sentences(m)[0].text).toBe("첫째  줄");
  });
  it("범위를 검증하고 중복을 제거한다", () => {
    expect(parseRange("1-3, 3, 8", 8)).toEqual([1, 2, 3, 8]);
    expect(() => parseRange("0-4", 8)).toThrow();
    expect(() => parseRange("3-2", 8)).toThrow();
    expect(() => parseRange("1-9", 8)).toThrow();
  });
  it("줄바꿈 정리와 CPM을 계산한다", () => {
    expect(clean("가  나\n다\n\n라")).toBe("가 나 다\n\n라");
    expect(cpm(120, 60000)).toBe(120);
    expect(cpm(10, 0)).toBe(0);
  });
  it("두 단을 왼쪽 단부터 읽는다", () => {
    const glyphs = [
      { str: "오른쪽 위", x: 300, y: 700, width: 80, height: 10 },
      { str: "왼쪽 아래", x: 20, y: 680, width: 80, height: 10 },
      { str: "왼쪽 위", x: 20, y: 700, width: 80, height: 10 },
      { str: "오른쪽 아래", x: 300, y: 680, width: 80, height: 10 },
    ];
    expect(readingOrder(glyphs, 2)).toBe(
      "왼쪽 위\n왼쪽 아래\n\n오른쪽 위\n오른쪽 아래",
    );
  });
  it("장문을 누락 없이 나눈다", () => {
    const text = "가".repeat(400);
    const m = createMaterial("장문", [{ number: 1, text }]);
    expect(sentences(m).every((s) => s.text.length <= 160)).toBe(true);
    expect(
      sentences(m)
        .map((s) => s.text)
        .join(""),
    ).toBe(text);
  });
});
