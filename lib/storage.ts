import { openDB } from "idb";
import type { Material } from "./study";
const database = () =>
  openDB("dudada-study", 1, {
    upgrade(db) {
      db.createObjectStore("materials", { keyPath: "id" });
    },
  });
export async function listMaterials(): Promise<Material[]> {
  const db = await database();
  return (await db.getAll("materials")).sort((a, b) =>
    b.updated.localeCompare(a.updated),
  );
}
export async function saveMaterial(m: Material) {
  const db = await database();
  await db.put("materials", m);
}
export async function deleteMaterial(id: string) {
  const db = await database();
  await db.delete("materials", id);
}
