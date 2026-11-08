export type Notebook = {
  id: string;
  title: string;
  fileName: string;
  fileSize: number | null;
  fingerprint: string | null;
  pageCount: number;
  pdfPage: number;
  editorPage: number;
  followPage: boolean;
  zoom: number | "fit";
  split: number;
  fontSize: number;
  drafts: Record<string, string>;
  updated: string;
  legacyText?: string;
};
export function createNotebook(
  name: string,
  count: number,
  fingerprint: string | null = null,
  size: number | null = null,
): Notebook {
  return {
    id: crypto.randomUUID(),
    title: name.replace(/\.pdf$/i, ""),
    fileName: name,
    fileSize: size,
    fingerprint,
    pageCount: count,
    pdfPage: 1,
    editorPage: 1,
    followPage: true,
    zoom: "fit",
    split: 55,
    fontSize: 19,
    drafts: {},
    updated: new Date().toISOString(),
  };
}
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function turnPage(note: Notebook, page: number): Notebook {
  const next = clamp(page, 1, note.pageCount);
  return {
    ...note,
    pdfPage: next,
    editorPage: note.followPage ? next : note.editorPage,
  };
}
export function exportNotebook(note: Notebook, markdown = false): string {
  const sections = Object.entries(note.drafts)
    .filter(([, text]) => text.trim())
    .sort(([a], [b]) => +a - +b)
    .map(([page, text]) => `${markdown ? "## " : ""}${page}페이지\n\n${text}`);
  return `${markdown ? "# " : ""}${note.title}\n\n${sections.join("\n\n")}\n`;
}
export function matchesPdf(
  note: Notebook,
  name: string,
  size: number,
  fingerprint: string,
  count: number,
) {
  return (
    note.pageCount === count &&
    (note.fingerprint
      ? note.fingerprint === fingerprint && note.fileSize === size
      : note.fileName === name)
  );
}
// The latest revision alone can report success. Failed writes do not poison later retries.
export class SaveQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private revision = 0;
  constructor(
    private write: (value: T) => Promise<void>,
    private status: (state: "saving" | "saved" | "error") => void,
  ) {}
  enqueue(value: T) {
    const revision = ++this.revision;
    this.status("saving");
    this.tail = this.tail
      .then(() => this.write(value))
      .then(() => {
        if (revision === this.revision) this.status("saved");
      })
      .catch(() => {
        if (revision === this.revision) this.status("error");
      });
    return this.tail;
  }
  flush() {
    return this.tail;
  }
}
