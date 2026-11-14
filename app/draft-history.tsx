"use client";
import { useEffect, useRef, useState } from "react";
import type { DraftVersion } from "@/lib/study-tools";
export default function DraftHistory({
  page,
  text,
  versions,
  onCapture,
  onRestore,
  onClose,
}: {
  page: number;
  text: string;
  versions: DraftVersion[];
  onCapture: () => void;
  onRestore: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(versions[0]?.id || "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const version = selected
    ? versions.find((v) => v.id === selected)
    : versions[0];
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  const act = (fn: () => void, success: string) => {
    setError("");
    try {
      fn();
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "작업에 실패했습니다.");
    }
  };
  return (
    <dialog
      ref={dialog}
      className="study-dialog history-dialog"
      aria-labelledby="history-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="section-heading">
        <h2 id="history-title">{page}페이지 이전 버전</h2>
        <button onClick={onClose}>닫기</button>
      </div>
      <p>
        1분 간격, 페이지 이동, 큰 수정 전에 보관해요. 페이지당 최근 30개, 자료
        전체 2MB까지 남습니다.
      </p>
      <button onClick={() => act(onCapture, "현재 글을 버전에 보관했습니다.")}>
        지금 버전 보관
      </button>
      <div className="history-content">
        <div className="version-list" role="group" aria-label="보관된 버전">
          {versions.length ? (
            versions.map((v) => (
              <button
                key={v.id}
                aria-pressed={version?.id === v.id}
                onClick={() => {
                  setSelected(v.id);
                  setMessage("");
                  setError("");
                }}
              >
                <span>{new Date(v.created).toLocaleString("ko-KR")}</span>
                <small>
                  {v.reason === "before-restore"
                    ? "복원 전 글"
                    : v.reason === "before-replace"
                      ? "큰 수정 전"
                      : v.reason === "manual"
                        ? "직접 보관"
                        : "자동 보관"}{" "}
                  · {v.text.length.toLocaleString()}자
                </small>
              </button>
            ))
          ) : (
            <p>아직 보관된 이전 글이 없어요.</p>
          )}
        </div>
        <textarea
          aria-label="이전 필사 미리보기"
          readOnly
          value={version?.text || ""}
          placeholder="왼쪽에서 버전을 선택하세요."
        />
      </div>
      <button
        className="primary"
        disabled={!version || version.text === text}
        onClick={() => {
          if (version)
            act(
              () => onRestore(version.id),
              "복원했습니다. 복원 전 글도 버전에 남겨 두었어요.",
            );
        }}
      >
        이 버전으로 복원
      </button>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
