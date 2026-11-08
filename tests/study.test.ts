import { describe, it, expect } from "vitest";
import {
  createNotebook,
  turnPage,
  exportNotebook,
  matchesPdf,
  SaveQueue,
} from "../lib/notebook";
describe("자유 필사", () => {
  it("55/45, 19px, 빈 필사로 시작한다", () => {
    const n = createNotebook("병원소식.pdf", 8);
    expect(n.split).toBe(55);
    expect(n.fontSize).toBe(19);
    expect(n.drafts).toEqual({});
  });
  it("연결된 페이지를 이동해도 각 페이지 글을 보존한다", () => {
    const n = createNotebook("소식.pdf", 8);
    n.drafts = { "1": "간호  ICU\n\n자유 필사", "2": "둘째" };
    const next = turnPage(n, 2);
    expect(next.editorPage).toBe(2);
    expect(turnPage(next, 1).drafts["1"]).toBe(n.drafts["1"]);
  });
  it("페이지 연결을 끄면 참고 페이지로 이동해도 편집 페이지를 유지한다", () => {
    const n = { ...createNotebook("소식.pdf", 8), followPage: false };
    expect(turnPage(n, 4).editorPage).toBe(1);
    expect(turnPage(n, 99).pdfPage).toBe(8);
  });
  it("모든 필사를 숫자 페이지 순서로 내보내고 공백과 줄바꿈을 보존한다", () => {
    const n = createNotebook("필사.pdf", 12);
    n.drafts = { "10": "마지막", "2": "두  칸\n\n문단", "1": "처음" };
    const text = exportNotebook(n);
    expect(text.indexOf("2페이지")).toBeLessThan(text.indexOf("10페이지"));
    expect(text).toContain("두  칸\n\n문단");
    expect(exportNotebook(n, true)).toContain("## 2페이지");
  });
  it("파일명만 같고 PDF 식별자가 다른 파일을 연결하지 않는다", () => {
    const n = createNotebook("a.pdf", 8, "original", 100);
    expect(matchesPdf(n, "a.pdf", 100, "other", 8)).toBe(false);
    expect(matchesPdf(n, "이름변경.pdf", 100, "original", 8)).toBe(true);
  });
  it("저장이 끝나기 전에는 저장 완료로 표시하지 않는다", async () => {
    const states: string[] = [];
    const writes: number[] = [];
    let release: () => void = () => {};
    const q = new SaveQueue<number>(
      (n) =>
        new Promise<void>((r) => {
          writes.push(n);
          release = r;
        }),
      (s) => states.push(s),
    );
    const first = q.enqueue(1);
    await Promise.resolve();
    q.enqueue(2);
    release();
    await first;
    await Promise.resolve();
    expect(states).not.toContain("saved");
    release();
    await q.flush();
    expect(writes).toEqual([1, 2]);
    expect(states.at(-1)).toBe("saved");
  });
  it("저장 실패를 표시하고 재시도한다", async () => {
    const states: string[] = [];
    let fail = true;
    const q = new SaveQueue(
      async () => {
        if (fail) throw new Error("quota");
      },
      (s) => states.push(s),
    );
    await q.enqueue("글");
    expect(states.at(-1)).toBe("error");
    fail = false;
    await q.enqueue("글");
    expect(states.at(-1)).toBe("saved");
  });
});
