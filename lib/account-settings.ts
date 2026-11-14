import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  authPassword,
  cloudClient,
  usernameEmail,
  validatePassword,
} from "./cloud";
import { authFailureMessage, invalidCredentials } from "./auth-errors";

export function normalizeUsername(name: string) {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
export function missingAccountSetup(error: { code?: string } | null) {
  return error?.code === "PGRST202" || error?.code === "42883";
}
export const ACCOUNT_SETUP_MESSAGE =
  "아이디 변경 준비가 필요합니다. 관리자가 Supabase SQL Editor에서 supabase/account-settings.sql을 한 번 실행해 주세요. 비밀번호 변경은 지금도 가능합니다.";
export function accountError(error: { message?: string; code?: string }) {
  if (missingAccountSetup(error)) return ACCOUNT_SETUP_MESSAGE;
  if (error.message?.includes("username_taken") || error.code === "23505")
    return "이미 사용 중이거나 예약된 아이디입니다. 다른 아이디를 입력해 주세요.";
  if (error.message?.includes("username_changed"))
    return "변경된 아이디로 다시 로그인해 주세요.";
  return "계정 정보를 변경하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.";
}
// Checking a password must not sign the editor out or replace its active session.
export function isolatedAuthClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `dudada-account-check-${crypto.randomUUID()}`,
      },
    },
  );
}
export async function currentUsername(c: SupabaseClient) {
  const { data, error } = await c.rpc("current_study_username");
  if (error && !missingAccountSetup(error))
    throw new Error(accountError(error));
  return typeof data === "string" ? data : null;
}
export async function registerUsername(c: SupabaseClient, username: string) {
  const { error } = await c.rpc("register_study_username", {
    p_username: normalizeUsername(username),
  });
  if (error && !missingAccountSetup(error))
    throw new Error(accountError(error));
  return !error;
}
async function verifyPassword(password: string) {
  validatePassword(password);
  const { data, error } = await cloudClient().auth.getUser();
  if (error || !data.user?.email) throw new Error("다시 로그인해 주세요.");
  const c = isolatedAuthClient();
  const login = await c.auth.signInWithPassword({
    email: data.user.email,
    password: await authPassword(data.user.email, password),
  });
  if (login.error) {
    if (invalidCredentials(login.error))
      throw new Error("현재 비밀번호가 맞지 않습니다.");
    throw new Error(authFailureMessage(login.error));
  }
  if (login.data.user.id !== data.user.id)
    throw new Error("다시 로그인해 주세요.");
  return { c, user: data.user };
}
export async function changeUsername(
  currentPassword: string,
  newUsername: string,
) {
  await usernameEmail(newUsername); // same Unicode validation as login
  const { c, user } = await verifyPassword(currentPassword);
  try {
    if (!(await currentUsername(c))) {
      const available = await registerUsername(
        c,
        user.user_metadata.display_name || "",
      );
      if (!available) throw new Error(ACCOUNT_SETUP_MESSAGE);
    }
    const { data, error } = await c.rpc("rename_study_username", {
      p_username: normalizeUsername(newUsername),
    });
    if (error) throw new Error(accountError(error));
    if (typeof data !== "string")
      throw new Error("아이디 변경 결과를 확인하지 못했습니다.");
    return data;
  } finally {
    await c.auth.signOut({ scope: "local" });
  }
}
export async function changePassword(
  currentPassword: string,
  newPassword: string,
) {
  validatePassword(newPassword);
  const { c, user } = await verifyPassword(currentPassword);
  const { error } = await c.auth.updateUser({
    password: await authPassword(user.email!, newPassword),
  });
  if (error) {
    await c.auth.signOut({ scope: "local" });
    if (error.code === "same_password")
      throw new Error("현재와 다른 비밀번호를 입력해 주세요.");
    throw new Error(authFailureMessage(error, "비밀번호 변경"));
  }
  const { data } = await c.auth.getSession();
  if (data.session) {
    const adopted = await cloudClient().auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (!adopted.error) return;
  }
  throw new Error(
    "비밀번호는 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.",
  );
}
