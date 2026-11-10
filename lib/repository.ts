import type { Notebook } from "./notebook";
export type StudyRepository = {
  listNotebooks: () => Promise<Notebook[]>;
  saveNotebook: (note: Notebook) => Promise<void>;
  stageNotebook?: (note: Notebook) => Promise<void>;
  loadPdf?: (note: Notebook) => Promise<File | null>;
  savePdf?: (
    note: Notebook,
    file: File,
    onProgress: (percent: number) => void,
  ) => Promise<void>;
  deletePdf?: (note: Notebook) => Promise<void>;
};
