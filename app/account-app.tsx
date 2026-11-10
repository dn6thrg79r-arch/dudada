"use client";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpen } from "lucide-react";
import { cloudClient, cloudConfigured, loginOrCreate } from "@/lib/cloud";
import { createCloudRepository } from "@/lib/cloud-repository";
import StudyApp from "./study-app";
export default function AccountApp() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(!cloudConfigured),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!cloudConfigured) return;
    const c = cloudClient();
    const sub = c.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    c.auth.getSession().then(({ data, error }) => {
      if (error)
        setError("로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.");
      setSession(data.session);
      setReady(true);
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);
  const owner = session?.user.id;
  const repository = useMemo(
    () => (owner ? createCloudRepository(cloudClient(), owner) : null),
    [owner],
  );
  if (session && repository)
    return (
      <StudyApp
        key={session.user.id}
        repository={repository}
        accountName={session.user.user_metadata.display_name || "나의 계정"}
        onLogout={async () => {
          const { error } = await cloudClient().auth.signOut();
          if (error) throw error;
          setPassword("");
          setSession(null);
        }}
      />
    );
  return (
    <main className="account-screen">
      <div className="account-card">
        <span className="brand-icon">
          <BookOpen />
        </span>
        <h1>두다다 공부방</h1>
        <p>같은 아이디로, 어디서든 이어 쓰세요.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const data = await loginOrCreate(username, password);
              if (data.session) {
                setSession(data.session);
                setPassword("");
              }
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "로그인에 실패했습니다.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            아이디
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
            />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={128}
            />
          </label>
          <button
            className="primary"
            disabled={!ready || busy || !cloudConfigured}
          >
            {busy ? "로그인 중…" : "들어가기"}
          </button>
        </form>
        <p className="account-hint">
          처음 쓰는 아이디는 새로 만들어집니다.
          <br />
          비밀번호는 8자 이상으로 정해 주세요.
          <br />
          이메일 없이 사용하므로 비밀번호를 잊으면 직접 복구할 수 없습니다.
        </p>
        {!cloudConfigured && (
          <p className="notice error" role="alert">
            관리자의 클라우드 연결 설정이 필요합니다. 아직 PDF 서버 저장과
            로그인은 사용할 수 없습니다.
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
