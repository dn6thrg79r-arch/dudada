import { describe, it, expect } from "vitest";
import {
  englishKeys,
  dictionaryCorrection,
  automaticEnglish,
  manualEnglish,
  pdfEnglishWords,
  pdfKoreanWords,
} from "../lib/english-input";
const words = new Map(
  [
    "vps26a",
    "snx27",
    "hear",
    "HR",
    "HER2",
    "go",
    "THE",
    "GREAT",
    "FUTURE",
    "AI",
    "TO",
    "SO",
  ].map((w) => [w.toLowerCase(), w]),
);
describe("두벌식 한/영 오입력", () => {
  it("사용자 예시의 자모·완성 글자·숫자를 영문 키로 되돌린다", () => {
    expect(englishKeys("펜26ㅁ")).toBe("vps26a");
    expect(englishKeys("눝27")).toBe("snx27");
    expect(englishKeys("ㅗㄷㅁㄱ")).toBe("hear");
    expect(englishKeys("ㅗㄱ")).toBe("hr");
    expect(englishKeys("ㅗㄷㄱ2")).toBe("her2");
  });
  it("원문의 영단어와 조사를 구분한다", () => {
    expect(dictionaryCorrection("펜26ㅁ와", words)).toBe("vps26a와");
    expect(dictionaryCorrection("눝27이", words)).toBe("snx27이");
    expect(dictionaryCorrection("ㅗㄱ과", words)).toBe("HR과");
    expect(dictionaryCorrection("ㅗㄷㄱ2", words)).toBe("HER2");
  });
  it("일반 한글과 원문에 없는 애매한 낱말은 자동으로 바꾸지 않는다", () => {
    for (const text of [
      "세포",
      "막단백질의",
      "골지",
      "해",
      "환자",
      "임상시험인",
      "123",
    ])
      expect(dictionaryCorrection(text, words)).toBe(null);
    expect(dictionaryCorrection("펜26ㅁ", new Map())).toBe(null);
  });
  it("공백·마침표에서만 해당 낱말을 교정하고 앞 문장과 커서를 보존한다", () => {
    const before = "세포 막단백질의 골지 우회 경로에서 펜26ㅁ와 ";
    const r = automaticEnglish(before, before.length, words)!;
    expect(before.slice(0, r.start) + r.text + before.slice(r.end)).toBe(
      "세포 막단백질의 골지 우회 경로에서 vps26a와 ",
    );
    expect(automaticEnglish("펜26ㅁ", 5, words)).toBe(null);
    const second = "대규모 3상 임상시험인 ㅗㄷㅁㄱ ";
    expect(automaticEnglish(second, second.length, words)?.text).toBe("hear");
  });
  it("원문 단어를 뽑으며 영문 대소문자를 보존한다", () => {
    expect(pdfEnglishWords("연구 VPS26A와 SNX27, HR과 HER2")).toEqual([
      "VPS26A",
      "SNX27",
      "HR",
      "HER2",
    ]);
  });
  it("명시적으로 선택한 단어는 사전에 없어도 변환하고 나머지는 유지한다", () => {
    const text = "한글 해 다음";
    expect(manualEnglish(text, 3, 4, new Map())).toEqual({
      start: 3,
      end: 4,
      text: "go",
    });
    expect(englishKeys("값 꽈 ㅘ")).toBe("rkqt Rhk hk");
    expect(englishKeys("펜".normalize("NFD"))).toBe("vps");
  });
});

describe("완성형 한글 영문 오입력", () => {
  it("원문에 있는 THE와 AI를 완성 음절과 조사까지 인식한다", () => {
    expect(englishKeys("솓")).toBe("the");
    expect(englishKeys("먀")).toBe("ai");
    expect(dictionaryCorrection("솓", words)).toBe("THE");
    expect(dictionaryCorrection("솓를", words)).toBe("THE를");
    expect(dictionaryCorrection("먀", words)).toBe("AI");
    expect(dictionaryCorrection("먀가", words)).toBe("AI가");
    expect(dictionaryCorrection("먀", new Map([["ai", "ai"]]))).toBe("ai");
    expect(dictionaryCorrection("솓".normalize("NFD"), words)).toBe("THE");
  });
  it("완성형도 공백을 입력한 뒤에만 변환하고 원문 밖 단어는 만들지 않는다", () => {
    const phrase = "캠페인 솓 ";
    const result = automaticEnglish(phrase, phrase.length, words)!;
    expect(
      phrase.slice(0, result.start) + result.text + phrase.slice(result.end),
    ).toBe("캠페인 THE ");
    expect(automaticEnglish("먀", 1, words)).toBe(null);
    expect(dictionaryCorrection("먀", new Map([["the", "THE"]]))).toBe(null);
    expect(dictionaryCorrection("솓", new Map())).toBe(null);
  });
  it("일반 한글 및 PDF에 인쇄된 한글을 우선 보존한다", () => {
    const protectedWords = pdfKoreanWords(
      "솓이라는 표기와 먀라는 이름을 원문에서 사용했다",
    );
    expect(protectedWords).toContain("솓");
    expect(protectedWords).toContain("먀");
    for (const text of ["솓", "먀"])
      expect(dictionaryCorrection(text, words, new Set(protectedWords))).toBe(
        null,
      );
    for (const text of ["새", "내", "해"])
      expect(dictionaryCorrection(text, words)).toBe(null);
    expect(
      dictionaryCorrection("해".normalize("NFD"), new Map([["go", "GO"]])),
    ).toBe(null);
  });
});
