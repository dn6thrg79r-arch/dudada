export type SourceKind =
  "pdf" | "pptx" | "txt" | "md" | "docx" | "hwpx" | "hwp" | "image";
export const SOURCE_ACCEPT =
  ".pdf,.pptx,.txt,.md,.markdown,.docx,.hwpx,.hwp,.jpg,.jpeg,.png,.webp";
export function sourceKind(name: string): SourceKind | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(ext || "")) return "image";
  if (ext === "markdown") return "md";
  return ["pdf", "pptx", "txt", "md", "docx", "hwpx", "hwp"].includes(ext || "")
    ? (ext as SourceKind)
    : null;
}
export function sourceMime(name: string) {
  const kind = sourceKind(name);
  const types: Partial<Record<SourceKind, string>> = {
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    hwpx: "application/hwp+zip",
    hwp: "application/x-hwp",
    txt: "text/plain",
    md: "text/markdown",
  };
  return kind === "image"
    ? `image/${/\.jpe?g$/i.test(name) ? "jpeg" : name.split(".").pop()?.toLowerCase()}`
    : types[kind!] || "application/octet-stream";
}
export function sourceName(kind?: SourceKind) {
  return kind === "image" ? "사진" : (kind || "pdf").toUpperCase();
}
