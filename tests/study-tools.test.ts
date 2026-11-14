import { describe, it, expect } from "vitest";
import { createNotebook } from "../lib/notebook";
import {
  checkpoint,
  beforeDraftEdit,
  restoreDraft,
  HISTORY_BYTES,
  HISTORY_PER_PAGE,
} from "../lib/study-tools";
describe("필사 이전 버전", () => {
  it("기존 자료에 이력이 없어도 수정 전 글을 보관하고 연속 입력은 중복 보관하지 않는다", () => {
    const n = {
      ...createNotebook("자료.pdf", 8),
      drafts: { 1: "처음 작성한 글" },
    };
    const initial = beforeDraftEdit(n, 1, "처음 작성한 글에 추가", 1000);
    expect(initial.history?.[1][0].text).toBe("처음 작성한 글");
    const more = { ...initial, drafts: { 1: "처음 작성한 글에 추가" } };
    expect(beforeDraftEdit(more, 1, "처음 작성한 글에 추가 문장", 1100)).toBe(
      more,
    );
    expect(checkpoint(initial, 1, "처음 작성한 글")).toBe(initial);
  });
  it("짧은 시간 안의 전체 삭제·붙여넣기 교체 직전에도 완성된 글을 보존한다", () => {
    const full =
      "의료진의 자세한 설명과 연구 결과를 충분히 읽고 옮겨 적은 문장입니다.";
    let n = checkpoint(
      createNotebook("자료.pdf", 8),
      1,
      "이전 문장",
      "automatic",
      1000,
    );
    n = { ...n, drafts: { 1: full } };
    expect(beforeDraftEdit(n, 1, "", 1500).history?.[1][0].text).toBe(full);
    expect(
      beforeDraftEdit(
        n,
        1,
        "전혀 다른 내용으로 잘못 붙여넣은 문장을 대신 넣었습니다.",
        1500,
      ).history?.[1][0].text,
    ).toBe(full);
  });
  it("1분 경과 및 페이지별 보관 후 복원하고 복원 전 글도 다시 가져올 수 있다", () => {
    let n = checkpoint(
      createNotebook("자료.pdf", 8),
      1,
      "원래 글",
      "automatic",
      1000,
    );
    n = { ...n, drafts: { 1: "복원하기 전 최신 글", 2: "다른 페이지" } };
    const id = n.history![1][0].id;
    const restored = restoreDraft(n, 1, id);
    expect(restored.drafts).toEqual({ 1: "원래 글", 2: "다른 페이지" });
    const backup = restored.history![1].find(
      (v) => v.reason === "before-restore",
    )!;
    expect(restoreDraft(restored, 1, backup.id).drafts[1]).toBe(
      "복원하기 전 최신 글",
    );
    expect(
      beforeDraftEdit(n, 1, "복원하기 전 최신 글 추가", 62000).history![1][0]
        .text,
    ).toBe(n.drafts[1]);
  });
  it("페이지당 30개와 자료 전체 본문 2MB를 넘지 않고 최신 버전을 남긴다", () => {
    let n = createNotebook("자료.pdf", 8);
    for (let i = 0; i < 50; i++)
      n = checkpoint(n, 1, `문장${i}`, "automatic", 1000 + i);
    expect(n.history![1]).toHaveLength(HISTORY_PER_PAGE);
    expect(n.history![1][0].text).toBe("문장49");
    for (let i = 0; i < 8; i++)
      n = checkpoint(n, i + 1, String(i).repeat(400000), "automatic", 2000 + i);
    const all = Object.values(n.history!).flat();
    expect(
      all.reduce((sum, v) => sum + new TextEncoder().encode(v.text).length, 0),
    ).toBeLessThanOrEqual(HISTORY_BYTES);
    expect(n.history![8][0].text).toBe("7".repeat(400000));
  });
  it("현재 글을 보관할 수 없는 대용량 복원은 차단하고 원문을 유지한다", () => {
    let n = checkpoint(createNotebook("자료.pdf", 8), 1, "원래 글");
    n = { ...n, drafts: { 1: "a".repeat(HISTORY_BYTES + 1) } };
    expect(() => restoreDraft(n, 1, n.history![1][0].id)).toThrow("TXT");
    expect(n.drafts[1]).toHaveLength(HISTORY_BYTES + 1);
  });
});
