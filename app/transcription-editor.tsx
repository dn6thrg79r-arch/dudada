"use client";
import { useMemo, useRef } from "react";
import {
  automaticEnglish,
  manualEnglish,
  type Replacement,
} from "@/lib/english-input";
// Browser-owned value, composition, selection and undo survive app rerenders.
export default function TranscriptionEditor({
  initial,
  fontSize,
  onInput,
  onComposition,
  englishWords = [],
  autoEnglish = false,
  onAutoEnglish,
}: {
  initial: string;
  fontSize: number;
  onInput: (text: string) => void;
  onComposition: (active: boolean) => void;
  englishWords?: string[];
  autoEnglish?: boolean;
  onAutoEnglish?: (value: boolean) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false),
    replacing = useRef(false);
  const words = useMemo(
    () => new Map(englishWords.map((word) => [word.toLowerCase(), word])),
    [englishWords],
  );
  function replace(change: Replacement) {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart,
      end = el.selectionEnd;
    el.focus({ preventScroll: true });
    replacing.current = true;
    try {
      el.setSelectionRange(change.start, change.end);
      const inserted =
        document.execCommand?.("insertText", false, change.text) ?? false;
      if (!inserted)
        el.setRangeText(change.text, change.start, change.end, "end");
      const delta = change.text.length - (change.end - change.start);
      const adjust = (p: number) =>
        p >= change.end
          ? p + delta
          : p > change.start
            ? change.start + change.text.length
            : p;
      el.setSelectionRange(adjust(caret), adjust(end));
    } finally {
      replacing.current = false;
    }
  }
  function publish(value: string, caret: number, allowAuto: boolean) {
    if (autoEnglish && allowAuto && !composing.current) {
      const change = automaticEnglish(value, caret, words);
      if (change) replace(change);
    }
    if (area.current) onInput(area.current.value);
  }
  function manual() {
    const el = area.current;
    if (!el || composing.current) return;
    const change = manualEnglish(
      el.value,
      el.selectionStart,
      el.selectionEnd,
      words,
    );
    if (change) {
      replace(change);
      onInput(el.value);
    }
  }
  return (
    <>
      <textarea
        ref={area}
        className="manuscript"
        aria-label="필사 편집기"
        defaultValue={initial}
        style={{ fontSize }}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        placeholder={
          "PDF를 읽으며 천천히 옮겨 적어 보세요.\n\n기억하고 싶은 문장과 나의 생각을 자유롭게 남겨요."
        }
        onInput={(e) => {
          if (replacing.current) return;
          const native = e.nativeEvent as InputEvent;
          publish(
            e.currentTarget.value,
            e.currentTarget.selectionStart,
            !native.isComposing &&
              !(native.inputType || "").startsWith("history"),
          );
        }}
        onCompositionStart={() => {
          composing.current = true;
          onComposition(true);
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          onComposition(false);
          publish(e.currentTarget.value, e.currentTarget.selectionStart, false);
        }}
        onKeyDown={(e) => {
          if (
            e.ctrlKey &&
            e.shiftKey &&
            e.code === "KeyE" &&
            !e.nativeEvent.isComposing &&
            !composing.current
          ) {
            e.preventDefault();
            manual();
          }
        }}
      />
      <div className="transcription-tools">
        <button
          title="영문으로 쓰려던 부분만 선택하거나 커서 앞 낱말을 변환 · Ctrl+Shift+E"
          onMouseDown={(e) => e.preventDefault()}
          onClick={manual}
        >
          한글 → 영문
        </button>
        <label title="현재 PDF 원문에 있는 영단어와 일치하는 자모·숫자 혼합 낱말만 공백·문장부호 뒤에 변환합니다. 일반 한글과 애매한 단어는 그대로 둡니다.">
          <input
            type="checkbox"
            aria-label="영문 자동 변환"
            checked={autoEnglish}
            onChange={(e) => onAutoEnglish?.(e.target.checked)}
          />
          자동 변환
        </label>
      </div>
    </>
  );
}
