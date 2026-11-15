const initials = [
  "r",
  "R",
  "s",
  "e",
  "E",
  "f",
  "a",
  "q",
  "Q",
  "t",
  "T",
  "d",
  "w",
  "W",
  "c",
  "z",
  "x",
  "v",
  "g",
];
const vowels = [
  "k",
  "o",
  "i",
  "O",
  "j",
  "p",
  "u",
  "P",
  "h",
  "hk",
  "ho",
  "hl",
  "y",
  "n",
  "nj",
  "np",
  "nl",
  "b",
  "m",
  "ml",
  "l",
];
const finals = [
  "",
  "r",
  "R",
  "rt",
  "s",
  "sw",
  "sg",
  "e",
  "f",
  "fr",
  "fa",
  "fq",
  "ft",
  "fx",
  "fv",
  "fg",
  "a",
  "q",
  "qt",
  "t",
  "T",
  "d",
  "w",
  "c",
  "z",
  "x",
  "v",
  "g",
];
const jamo: Record<string, string> = {};
Array.from("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ").forEach((c, i) => {
  jamo[c] = initials[i];
});
Array.from("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ").forEach((c, i) => {
  jamo[c] = vowels[i];
});
Array.from("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ").forEach(
  (c, i) => {
    jamo[c] ??= finals[i + 1];
  },
);
export function englishKeys(text: string) {
  return Array.from(text.normalize("NFC"), (c) => {
    const code = c.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172)
      return (
        initials[Math.floor(code / 588)] +
        vowels[Math.floor((code % 588) / 28)] +
        finals[code % 28]
      );
    if (c.charCodeAt(0) >= 0x1100 && c.charCodeAt(0) <= 0x1112)
      return initials[c.charCodeAt(0) - 0x1100];
    if (c.charCodeAt(0) >= 0x1161 && c.charCodeAt(0) <= 0x1175)
      return vowels[c.charCodeAt(0) - 0x1161];
    if (c.charCodeAt(0) >= 0x11a8 && c.charCodeAt(0) <= 0x11c2)
      return finals[c.charCodeAt(0) - 0x11a7];
    return jamo[c] ?? c;
  }).join("");
}
export function pdfEnglishWords(text: string) {
  return [...new Set(text.match(/[A-Za-z][A-Za-z0-9_-]{0,79}/g) || [])].slice(
    0,
    5000,
  );
}
const particles = new Set([
  "",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "와",
  "과",
  "도",
  "의",
  "에",
  "에서",
  "에게",
  "으로",
  "로",
  "처럼",
  "보다",
  "만",
  "까지",
  "부터",
  "이나",
  "나",
  "라는",
  "라고",
  "란",
  "와의",
  "과의",
  "에서의",
  "으로의",
  "에서도",
  "에는",
  "에서는",
]);
export function pdfKoreanWords(text: string) {
  const words = new Set(
    (text.normalize("NFC").match(/[\p{Script=Hangul}]+/gu) || []).slice(
      0,
      10000,
    ),
  );
  // Preserve Korean syllables that really occur on the page, even inside a word.
  for (const word of [...words])
    for (const c of word) {
      if (words.size >= 10000) break;
      words.add(c);
    }
  return [...words];
}
const ordinaryKorean = new Set([
  "가",
  "나",
  "너",
  "저",
  "우리",
  "그",
  "이",
  "것",
  "수",
  "등",
  "중",
  "내",
  "네",
  "새",
  "해",
  "애",
  "채",
  "더",
  "데",
  "왜",
  "안",
  "못",
  "곧",
  "다",
  "또",
  "및",
  "즉",
  "후",
  "전",
  "각",
  "본",
  "위",
  "아래",
]);
const noKoreanWords: ReadonlySet<string> = new Set();
const hangul = /[\p{Script=Hangul}]/u;
export function dictionaryCorrection(
  token: string,
  words: ReadonlyMap<string, string>,
  koreanWords: ReadonlySet<string> = noKoreanWords,
): string | null {
  if (!words.size || token.length > 128) return null;
  for (let cut = token.length; cut > 0; cut--) {
    const prefix = token.slice(0, cut),
      suffix = token.slice(cut);
    if (!particles.has(suffix) || !hangul.test(prefix)) continue;
    const keys = englishKeys(prefix).toLowerCase();
    const english = words.get(keys);
    if (!english) continue;
    if (!/[ㄱ-ㅣ0-9]/u.test(prefix)) {
      // Composed typos such as 솓/THE and 먀/AI need the same source-word match.
      // Known Korean and Korean actually printed on the page take precedence.
      if (
        ordinaryKorean.has(prefix.normalize("NFC")) ||
        koreanWords.has(prefix.normalize("NFC")) ||
        koreanWords.has(token.normalize("NFC"))
      )
        continue;
      if (keys.length < 3 && keys !== "ai" && !/^[A-Z]{2}$/.test(english))
        continue;
    }
    return english + suffix;
  }
  return null;
}
export type Replacement = { start: number; end: number; text: string };
export function automaticEnglish(
  value: string,
  caret: number,
  words: ReadonlyMap<string, string>,
  koreanWords: ReadonlySet<string> = noKoreanWords,
): Replacement | null {
  if (!/[\s.,!?;:)\]}]/.test(value[caret - 1] || "")) return null;
  const start = Math.max(0, caret - 256),
    tail = value.slice(start, caret);
  const match = tail.match(
    /([\p{Script=Hangul}A-Za-z0-9_-]+)([\s.,!?;:)\]}]+)$/u,
  );
  if (!match) return null;
  const corrected = dictionaryCorrection(match[1], words, koreanWords);
  if (!corrected || corrected === match[1]) return null;
  const index = start + match.index!;
  return { start: index, end: index + match[1].length, text: corrected };
}
export function manualEnglish(
  value: string,
  start: number,
  end: number,
  words: ReadonlyMap<string, string>,
  koreanWords: ReadonlySet<string> = noKoreanWords,
): Replacement | null {
  if (start === end) {
    while (start > 0 && /\s/.test(value[start - 1])) start--;
    end = start;
    while (
      start > 0 &&
      /[\p{Script=Hangul}A-Za-z0-9_-]/u.test(value[start - 1])
    )
      start--;
  }
  const token = value.slice(start, end);
  if (!token || !hangul.test(token)) return null;
  const text =
    dictionaryCorrection(token, words, koreanWords) ?? englishKeys(token);
  return text === token ? null : { start, end, text };
}
