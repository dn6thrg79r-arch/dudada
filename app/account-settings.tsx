"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { changePassword, changeUsername } from "@/lib/account-settings";

export default function AccountSettings({
  name,
  onRename,
  onClose,
}: {
  name: string;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"username" | "password">("username");
  const [newName, setNewName] = useState(name);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="account-dialog account-card"
      aria-labelledby="account-settings-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="account-dialog-heading">
        <h2 id="account-settings-title">계정 설정</h2>
        <button
          type="button"
          aria-label="계정 설정 닫기"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <p>아이디를 바꿔도 PDF와 필사는 그대로 남아요.</p>
      <div className="account-tabs" role="group" aria-label="변경할 정보">
        {(["username", "password"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            disabled={busy}
            aria-pressed={mode === tab}
            onClick={() => {
              setMode(tab);
              setError("");
              setSuccess("");
              setCurrent("");
              setPassword("");
              setConfirmation("");
            }}
          >
            {tab === "username" ? "아이디 변경" : "비밀번호 변경"}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setSuccess("");
          if (mode === "password" && password !== confirmation) {
            setError("새 비밀번호가 서로 다릅니다.");
            return;
          }
          setBusy(true);
          try {
            if (mode === "username") {
              const updated = await changeUsername(current, newName);
              onRename(updated);
              setNewName(updated);
              setSuccess(
                "아이디를 변경했습니다. 다음부터 새 아이디로 로그인해 주세요.",
              );
            } else {
              await changePassword(current, password);
              setSuccess(
                "비밀번호를 변경했습니다. 다음부터 새 비밀번호를 사용해 주세요.",
              );
            }
            setCurrent("");
            setPassword("");
            setConfirmation("");
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "계정 정보를 변경하지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            현재 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={4}
              maxLength={128}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          {mode === "username" ? (
            <label>
              새 아이디
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                새 비밀번호
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                새 비밀번호 확인
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={128}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            </>
          )}
          <p className="account-hint">
            {mode === "username"
              ? "한글·영문·숫자·밑줄·하이픈으로 3~32자. 변경 전 아이디는 다른 사람이 사용할 수 없어요."
              : "비밀번호는 4~128자로 정해 주세요."}
          </p>
          <button className="primary" type="submit">
            {busy ? "변경 중…" : "변경 사항 저장"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="notice" role="status">
          {success}
        </p>
      )}
    </dialog>
  );
}
