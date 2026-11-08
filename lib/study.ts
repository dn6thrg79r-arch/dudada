export type Page = { number: number; text: string };
export type Mode = "exact" | "study";
export type RecordState = {
  input: string;
  elapsed: number;
  mistakes: number;
  completed: boolean;
  date: string;
};
export type Material = {
  id: string;
  title: string;
  source: string;
  pageCount: number;
  pages: Page[];
  selected: number[];
  mode: Mode;
  cursor: number;
  records: Record<string, RecordState>;
  updated: string;
  activity: { date: string; chars: number; elapsed: number }[];
};
export type Sentence = { id: string; text: string; page: number };
export const normalize = (s: string) =>
  s.normalize("NFC").replace(/\r\n?/g, "\n");
export const clean = (s: string) =>
  normalize(s)
    .replace(/[^\S\n]+/g, " ")
    .replace(/([^\n])\n(?=[^\n])/g, "$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
export const day = () => new Intl.DateTimeFormat("sv-SE").format(new Date());
export function sentences(m: Material): Sentence[] {
  return m.pages
    .filter((p) => m.selected.includes(p.number))
    .flatMap((p) => {
      const text =
        m.mode === "study" ? clean(p.text) : normalize(p.text).trim();
      // Preserve punctuation and spaces inside each unit; a newline is a unit boundary in exact mode.
      const chunks = text
        .split(m.mode === "exact" ? /\n+/ : /(?<=[.!?。！？])\s+|\n{2,}/u)
        .filter((s) => s.trim());
      return chunks
        .flatMap((s) => {
          const chars = Array.from(s);
          const parts: string[] = [];
          while (chars.length) {
            let cut = Math.min(160, chars.length);
            if (cut < chars.length) {
              const space = chars.slice(0, cut).lastIndexOf(" ");
              if (space > 80) cut = space + 1;
            }
            parts.push(chars.splice(0, cut).join(""));
          }
          return parts;
        })
        .map((s, i) => ({
          id: `${m.mode}:${p.number}:${i}`,
          text: s,
          page: p.number,
        }));
    });
}
export function compare(target: string, input: string) {
  const t = Array.from(normalize(target)),
    v = Array.from(normalize(input));
  const correct = v.filter((c, i) => c === t[i]).length;
  return {
    correct,
    total: v.length,
    accuracy: v.length ? Math.round((correct / v.length) * 100) : 100,
    complete: normalize(target) === normalize(input),
  };
}
export function cpm(correct: number, elapsed: number) {
  return elapsed > 0 ? Math.round((correct * 60000) / elapsed) : 0;
}
export function createMaterial(
  title: string,
  pages: Page[],
  source = "직접 입력",
  pageCount = pages.length,
): Material {
  return {
    id: crypto.randomUUID(),
    title: title || "이름 없는 학습자료",
    source,
    pageCount,
    pages,
    selected: pages.map((p) => p.number),
    mode: "study",
    cursor: 0,
    records: {},
    updated: new Date().toISOString(),
    activity: [],
  };
}
export function parseRange(value: string, count: number): number[] {
  const result = new Set<number>();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error("페이지는 1-3, 5 형식으로 입력해 주세요.");
    const a = Number(match[1]),
      b = Number(match[2] || match[1]);
    if (a < 1 || b > count || a > b)
      throw new Error(`1~${count}페이지 안에서 선택해 주세요.`);
    for (let i = a; i <= b; i++) result.add(i);
  }
  return [...result].sort((a, b) => a - b);
}
