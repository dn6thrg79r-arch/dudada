import { stageDraft, clearDraft, pendingDrafts } from "./cloud-cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notebook } from "./notebook";
import type { StudyRepository } from "./repository";
export const PDF_CHUNK_BYTES = 10 * 1024 * 1024;
const BUCKET = "study-pdfs";
type PdfManifest = {
  prefix: string;
  chunks: number;
  size: number;
  name: string;
  modified: number;
};
export function pdfChunkPaths(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix}/${i}.part`);
}
export function createCloudRepository(
  client: SupabaseClient,
  owner: string,
): StudyRepository {
  const revisions = new Map<string, number>();
  async function ensureOwner() {
    const { data, error } = await client.auth.getUser();
    if (error || data.user?.id !== owner)
      throw new Error(
        "로그인이 만료됐습니다. 입력한 글을 내보낸 뒤 다시 로그인해 주세요.",
      );
  }
  async function manifest(note: Notebook): Promise<PdfManifest | null> {
    const { data, error } = await client
      .from("study_documents")
      .select("manifest")
      .eq("owner_id", owner)
      .eq("id", note.id)
      .maybeSingle();
    if (error) throw new Error("저장된 PDF 정보를 불러오지 못했습니다.");
    return data?.manifest || null;
  }
  const repository: StudyRepository = {
    async stageNotebook(note) {
      await stageDraft(owner, note, revisions.get(note.id) ?? null);
    },
    async listNotebooks() {
      await ensureOwner();
      const { data, error } = await client
        .from("study_notebooks")
        .select("id,payload,revision")
        .eq("owner_id", owner)
        .order("updated_at", { ascending: false });
      if (error)
        throw new Error(
          "클라우드 자료를 불러오지 못했습니다. 네트워크와 Supabase 설정을 확인해 주세요.",
        );
      const notes = (data || []).map((row) => {
        revisions.set(row.id, row.revision);
        return row.payload as Notebook;
      });
      const staged = await pendingDrafts(owner);
      for (const pending of staged) {
        const serverRevision = revisions.get(pending.id) ?? null;
        let recovery = pending.note;
        if (serverRevision !== pending.baseRevision)
          recovery = {
            ...pending.note,
            id: crypto.randomUUID(),
            title: pending.note.title + " · 복구본",
            updated: new Date().toISOString(),
          };
        await repository.saveNotebook(recovery);
        if (recovery.id !== pending.id) await clearDraft(owner, pending.note);
        const index = notes.findIndex((n) => n.id === recovery.id);
        if (index < 0) notes.unshift(recovery);
        else notes[index] = recovery;
      }
      return notes;
    },
    async saveNotebook(note) {
      await ensureOwner();
      const revision = revisions.get(note.id);
      if (revision === undefined) {
        const { data, error } = await client
          .from("study_notebooks")
          .insert({ id: note.id, owner_id: owner, payload: note })
          .select("revision")
          .single();
        if (error)
          throw new Error(
            "클라우드 저장에 실패했습니다. 다른 기기에서 같은 자료를 수정 중이면 새로 로그인해 주세요.",
          );
        revisions.set(note.id, data.revision);
      } else {
        const { data, error } = await client
          .from("study_notebooks")
          .update({
            payload: note,
            revision: revision + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", owner)
          .eq("id", note.id)
          .eq("revision", revision)
          .select("revision")
          .maybeSingle();
        if (error || !data)
          throw new Error(
            "다른 기기에서 자료가 변경됐거나 저장에 실패했습니다. 현재 글을 TXT로 보관한 뒤 자료를 다시 불러오세요.",
          );
        revisions.set(note.id, data.revision);
      }
      await clearDraft(owner, note);
    },
    async savePdf(note, file, onProgress) {
      await ensureOwner();
      const old = await manifest(note);
      const prefix = `${owner}/${encodeURIComponent(note.id)}/${crypto.randomUUID()}`;
      const count = Math.ceil(file.size / PDF_CHUNK_BYTES);
      const paths = pdfChunkPaths(prefix, count);
      const uploaded: string[] = [];
      try {
        for (let i = 0; i < count; i++) {
          const { error } = await client.storage
            .from(BUCKET)
            .upload(
              paths[i],
              file.slice(i * PDF_CHUNK_BYTES, (i + 1) * PDF_CHUNK_BYTES),
              { contentType: "application/octet-stream", upsert: false },
            );
          if (error)
            throw new Error(
              "PDF 저장에 실패했습니다. 인터넷 연결과 저장 공간을 확인하고 다시 시도해 주세요.",
            );
          uploaded.push(paths[i]);
          onProgress(Math.round(((i + 1) / count) * 100));
        }
        const value: PdfManifest = {
          prefix,
          chunks: count,
          size: file.size,
          name: file.name,
          modified: file.lastModified,
        };
        const { error } = await client
          .from("study_documents")
          .upsert({ id: note.id, owner_id: owner, manifest: value });
        if (error)
          throw new Error(
            "PDF 저장 정보를 기록하지 못했습니다. 다시 시도해 주세요.",
          );
      } catch (e) {
        if (uploaded.length) await client.storage.from(BUCKET).remove(uploaded);
        throw e;
      }
      // Publish the manifest only after all chunks succeed; an interrupted replacement keeps the prior PDF.
      if (old)
        await client.storage
          .from(BUCKET)
          .remove(pdfChunkPaths(old.prefix, old.chunks));
    },
    async loadPdf(note) {
      await ensureOwner();
      const info = await manifest(note);
      if (!info) return null;
      if (
        !info.prefix.startsWith(owner + "/") ||
        !Number.isInteger(info.chunks) ||
        info.chunks < 1 ||
        info.chunks > 52 ||
        info.size > 512 * 1024 * 1024
      )
        throw new Error(
          "저장된 PDF 정보가 올바르지 않습니다. 원본을 다시 선택해 주세요.",
        );
      const parts: Blob[] = [];
      for (const path of pdfChunkPaths(info.prefix, info.chunks)) {
        const { data, error } = await client.storage
          .from(BUCKET)
          .download(path);
        if (error || !data)
          throw new Error(
            "PDF 다운로드에 실패했습니다. 네트워크를 확인하고 자료를 다시 선택해 주세요.",
          );
        parts.push(data);
      }
      const file = new File(parts, info.name, {
        type: "application/pdf",
        lastModified: info.modified,
      });
      if (file.size !== info.size)
        throw new Error("PDF를 모두 내려받지 못했습니다. 다시 시도해 주세요.");
      return file;
    },
    async deletePdf(note) {
      await ensureOwner();
      const info = await manifest(note);
      if (!info) return;
      const { error } = await client.storage
        .from(BUCKET)
        .remove(pdfChunkPaths(info.prefix, info.chunks));
      if (error) throw new Error("PDF 삭제에 실패했습니다.");
      const removed = await client
        .from("study_documents")
        .delete()
        .eq("owner_id", owner)
        .eq("id", note.id);
      if (removed.error)
        throw new Error("PDF 삭제 정보를 저장하지 못했습니다.");
    },
  };
  return repository;
}
