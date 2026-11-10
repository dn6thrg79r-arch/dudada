import { openDB } from "idb";
import type { Notebook } from "./notebook";
export type PendingDraft = {
  owner: string;
  id: string;
  note: Notebook;
  baseRevision: number | null;
};
const database = () =>
  openDB("dudada-cloud-drafts", 1, {
    upgrade(db) {
      db.createObjectStore("pending", { keyPath: ["owner", "id"] });
    },
  });
export async function stageDraft(
  owner: string,
  note: Notebook,
  baseRevision: number | null,
) {
  const db = await database();
  const tx = db.transaction("pending", "readwrite");
  const old = (await tx.store.get([owner, note.id])) as
    PendingDraft | undefined;
  if (!old || old.note.updated <= note.updated)
    await tx.store.put({
      owner,
      id: note.id,
      note,
      baseRevision: old?.baseRevision ?? baseRevision,
    });
  await tx.done;
}
export async function clearDraft(owner: string, note: Notebook) {
  const db = await database();
  const tx = db.transaction("pending", "readwrite");
  const row = (await tx.store.get([owner, note.id])) as
    PendingDraft | undefined;
  if (row && JSON.stringify(row.note) === JSON.stringify(note))
    await tx.store.delete([owner, note.id]);
  await tx.done;
}
export async function pendingDrafts(owner: string): Promise<PendingDraft[]> {
  const db = await database();
  return (await db.getAll("pending")).filter((row) => row.owner === owner);
}
