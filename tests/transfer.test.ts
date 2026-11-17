import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCloudRepository,
  PDF_CHUNK_BYTES,
} from "../lib/cloud-repository";
import { createNotebook } from "../lib/notebook";
vi.mock("../lib/cloud-cache", () => ({
  pendingDrafts: async () => [],
  clearDraft: async () => {},
  stageDraft: async () => {},
}));
function fixture({
  delay = 40,
  fail = -1,
}: { delay?: number; fail?: number } = {}) {
  const file = new File(
    [new Uint8Array(5 * PDF_CHUNK_BYTES + 3)],
    "큰자료.pdf",
    { type: "application/pdf" },
  );
  const manifest = {
    prefix: "owner/note/old",
    chunks: 6,
    size: file.size,
    name: file.name,
    modified: 0,
  };
  const objects = new Map<string, Blob>();
  let active = 0,
    peak = 0;
  const published = vi.fn(async () => ({ error: null }));
  const removed = vi.fn(async (paths: string[]) => {
    for (const p of paths) objects.delete(p);
    return { error: null };
  });
  async function transfer(path: string, download: boolean, part?: Blob) {
    const index = Number(path.split("/").pop()!.split(".")[0]);
    active++;
    peak = Math.max(peak, active);
    // Vary completion order to detect byte reordering, not just faster requests.
    await new Promise((r) => setTimeout(r, delay + (5 - index) * 2));
    active--;
    if (index === fail) return { data: null, error: { message: "failed" } };
    if (!download) objects.set(path, part!);
    const data = new Blob([
      new Uint8Array(index === 5 ? 3 : PDF_CHUNK_BYTES).fill(index),
    ]);
    return { data, error: null };
  }
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: { manifest }, error: null }),
    upsert: published,
  };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "owner" } }, error: null }),
    },
    from: () => query,
    storage: {
      from: () => ({
        upload: (p: string, b: Blob) => transfer(p, false, b),
        download: (p: string) => transfer(p, true),
        remove: removed,
      }),
    },
  } as unknown as SupabaseClient;
  return {
    repository: createCloudRepository(client, "owner"),
    file,
    objects,
    published,
    removed,
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
  };
}
it("대용량 다운로드의 지연과 조각 순서를 측정한다", async () => {
  const f = fixture({ delay: 60 });
  const started = performance.now();
  const file = await f.repository.loadPdf!(createNotebook("큰자료.pdf", 8));
  const elapsed = Math.round(performance.now() - started);
  expect(f.peak).toBeGreaterThan(1);
  expect(f.peak).toBeLessThanOrEqual(3);
  console.info(
    `TRANSFER_BENCH ${JSON.stringify({ elapsedMs: elapsed, peakRequests: f.peak, chunks: 6, delayMs: 60 })}`,
  );
  const bytes = new Uint8Array(await file!.arrayBuffer());
  for (let i = 0; i < 6; i++) expect(bytes[i * PDF_CHUNK_BYTES]).toBe(i);
  expect(bytes.length).toBe(f.file.size);
});
it("저장은 모든 조각이 성공한 뒤에만 원본 정보를 교체하고 진행률은 감소하지 않는다", async () => {
  const f = fixture(),
    progress: number[] = [];
  await f.repository.savePdf!(createNotebook("큰자료.pdf", 8), f.file, (n) =>
    progress.push(n),
  );
  expect(f.published).toHaveBeenCalledOnce();
  expect(f.objects.size).toBe(6);
  expect(progress.at(-1)).toBe(100);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  expect(f.active).toBe(0);
  expect(f.peak).toBeLessThanOrEqual(3);
});
it("실패한 병렬 저장은 진행 중인 요청까지 마친 뒤 새 조각을 정리하고 기존 원본을 유지한다", async () => {
  const f = fixture({ fail: 1 });
  await expect(
    f.repository.savePdf!(createNotebook("큰자료.pdf", 8), f.file, () => {}),
  ).rejects.toThrow("저장에 실패");
  expect(f.active).toBe(0);
  expect(f.objects.size).toBe(0);
  expect(f.published).not.toHaveBeenCalled();
  for (const call of f.removed.mock.calls)
    expect(call[0].every((path) => !path.includes("/old/"))).toBe(true);
});
