import { openDB } from "idb";
import { createNotebook, type Notebook } from "./notebook";
const database = () =>
  openDB("dudada-study", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("materials"))
        db.createObjectStore("materials", { keyPath: "id" });
      if (!db.objectStoreNames.contains("notebooks"))
        db.createObjectStore("notebooks", { keyPath: "id" });
    },
  });
export async function listNotebooks(): Promise<Notebook[]> {
  const db = await database();
  // Migrate user-entered drafts, preserving the original store and edited source separately.
  const tx = db.transaction(["materials", "notebooks"], "readwrite");
  const old = await tx.objectStore("materials").getAll();
  for (const m of old) {
    const id = `legacy:${m.id}`;
    if (await tx.objectStore("notebooks").get(id)) continue;
    const note = createNotebook(m.source || m.title, Math.max(1, m.pageCount));
    note.id = id;
    note.title = m.title;
    note.updated = m.updated;
    note.legacyText = (m.pages || [])
      .map(
        (p: { number: number; text: string }) =>
          `[${p.number}페이지]\n${p.text}`,
      )
      .join("\n\n");
    for (const [key, value] of Object.entries(m.records || {})) {
      const [mode, page] = key.split(":");
      const r = value as { input?: string };
      if (mode === m.mode && r.input)
        note.drafts[page] =
          (note.drafts[page] ? note.drafts[page] + "\n" : "") + r.input;
    }
    await tx.objectStore("notebooks").put(note);
  }
  await tx.done;
  return (await db.getAll("notebooks")).sort((a, b) =>
    b.updated.localeCompare(a.updated),
  );
}
export async function saveNotebook(note: Notebook) {
  const db = await database();
  await db.put("notebooks", note);
}
