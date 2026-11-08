"use client";
import { useRef } from "react";
// Intentionally uncontrolled: typing, composition, cursor and native undo remain
// owned by the browser. Only explicit notebook/page navigation remounts this editor.
export default function TranscriptionEditor({
  initial,
  fontSize,
  onInput,
  onComposition,
}: {
  initial: string;
  fontSize: number;
  onInput: (text: string) => void;
  onComposition: (active: boolean) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  return (
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
      onInput={(e) => onInput(e.currentTarget.value)}
      onCompositionStart={() => onComposition(true)}
      onCompositionEnd={(e) => {
        onInput(e.currentTarget.value);
        onComposition(false);
      }}
    />
  );
}
