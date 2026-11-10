import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usernameEmail, validatePassword, authPassword } from "../lib/cloud";
import {
  PDF_CHUNK_BYTES,
  pdfChunkPaths,
  createCloudRepository,
} from "../lib/cloud-repository";
import { createNotebook, SaveQueue } from "../lib/notebook";
vi.mock("../lib/cloud-cache", () => ({
  pendingDrafts: async () => [],
  clearDraft: async () => {},
  stageDraft: async () => {},
}));
afterEach(() => vi.useRealTimers());
describe("클라우드 계정과 저장", () => {
  it("아이디를 일관되게 매핑하고 이메일을 요구하지 않는다", async () => {
    expect(await usernameEmail("  Study_1 ")).toBe(
      await usernameEmail("study_1"),
    );
    expect(await usernameEmail("홍길동")).toMatch(
      /^u\.[a-f0-9]{64}@accounts\.dudada\.invalid$/,
    );
    await expect(usernameEmail("a")).rejects.toThrow();
    await expect(usernameEmail("a@b")).rejects.toThrow();
  });
  it("서로 다른 아이디를 분리한다", async () => {
    expect(await usernameEmail("공부1")).not.toBe(await usernameEmail("공부2"));
  });
  it("큰 PDF를 10MB 단위의 계정별 경로로 나눈다", () => {
    const size = 101 * 1024 * 1024;
    const count = Math.ceil(size / PDF_CHUNK_BYTES);
    expect(count).toBe(11);
    expect(pdfChunkPaths("owner/note/upload", count)[10]).toBe(
      "owner/note/upload/10.part",
    );
  });
  it("로그인 계정이 다르면 서버 쓰기를 시작하지 않는다", async () => {
    const from = vi.fn();
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: "B" } }, error: null }),
      },
      from,
    } as unknown as SupabaseClient;
    const repository = createCloudRepository(client, "A");
    await expect(
      repository.saveNotebook(createNotebook("소식.pdf", 8)),
    ).rejects.toThrow("로그인");
    expect(from).not.toHaveBeenCalled();
  });
  it("기기 간 수정 충돌은 성공으로 처리하지 않는다", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      update: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [
        { id: "note", revision: 3, payload: createNotebook("소식.pdf", 8) },
      ],
      error: null,
    });
    query.update.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: "A" } }, error: null }),
      },
      from: () => query,
    } as unknown as SupabaseClient;
    const repository = createCloudRepository(client, "A");
    await repository.listNotebooks();
    const note = { ...createNotebook("소식.pdf", 8), id: "note" };
    await expect(repository.saveNotebook(note)).rejects.toThrow("다른 기기");
    expect(query.eq).toHaveBeenCalledWith("revision", 3);
  });
  it("연속 입력은 최신 필사만 묶어서 저장하며 다른 자료는 유지한다", async () => {
    vi.useFakeTimers();
    const writes: { id: string; text: string }[] = [];
    const states: string[] = [];
    const q = new SaveQueue(
      async (n) => {
        writes.push(n);
      },
      (s) => states.push(s),
      (n: { id: string; text: string }) => n.id,
    );
    q.enqueue({ id: "a", text: "ㅎ" });
    q.enqueue({ id: "a", text: "한" });
    q.enqueue({ id: "b", text: "다른 자료" });
    q.enqueue({ id: "a", text: "한글" });
    await vi.runAllTimersAsync();
    await q.flush();
    expect(writes).toEqual([
      { id: "a", text: "한글" },
      { id: "b", text: "다른 자료" },
    ]);
    expect(states.at(-1)).toBe("saved");
  });
});

describe("4자 이상 암호", () => {
  it("4자와 128자는 허용하고 3자와 129자는 거절한다", () => {
    expect(() => validatePassword("1234")).not.toThrow();
    expect(() => validatePassword("a".repeat(128))).not.toThrow();
    expect(() => validatePassword("123")).toThrow("4~128");
    expect(() => validatePassword("a".repeat(129))).toThrow();
  });
  it("기존 8자 이상 암호의 인증값을 변경하지 않는다", async () => {
    expect(
      await authPassword("user@accounts.dudada.invalid", "existing-password"),
    ).toBe("existing-password");
    expect(await authPassword("user@accounts.dudada.invalid", "12345678")).toBe(
      "12345678",
    );
  });
  it("짧은 암호는 계정별로 동일한 버전 고정 인증값을 만든다", async () => {
    const email = await usernameEmail("study_1");
    const value = await authPassword(email, "1234");
    expect(value).toBe(
      "Dd1!87c3c539d2a7c6b83964cdaad84d04df2201127a903919db926bc221209e9dc9",
    );
    expect(value.length).toBe(68);
    expect(await authPassword(await usernameEmail("STUDY_1"), "1234")).toBe(
      value,
    );
    expect(await authPassword(await usernameEmail("study_2"), "1234")).not.toBe(
      value,
    );
    expect(await authPassword(email, "1235")).not.toBe(value);
  });
});
