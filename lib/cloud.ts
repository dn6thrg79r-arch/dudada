import {
  isolatedAuthClient,
  normalizeUsername,
  missingAccountSetup,
  registerUsername,
  accountError,
} from "./account-settings";
import {
  invalidCredentials,
  existingAccount,
  authFailureMessage,
} from "./auth-errors";
import {
  createClient,
  type SupabaseClient,
  type AuthResponse,
} from "@supabase/supabase-js";
export const cloudConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
);
let client: SupabaseClient | undefined;
export function cloudClient() {
  if (!cloudConfigured) throw new Error("클라우드 연결 설정이 필요합니다.");
  if (!client)
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    );
  return client;
}
export async function usernameEmail(username: string) {
  const name = username.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(name))
    throw new Error(
      "아이디는 한글·영문·숫자·밑줄·하이픈으로 3~32자 입력해 주세요.",
    );
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(name),
  );
  return `u.${Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")}@accounts.dudada.invalid`;
}
export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 128;
export function validatePassword(password: string) {
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  )
    throw new Error("비밀번호는 4~128자로 입력해 주세요.");
}
// Supabase enforces >=6 characters. Versioned client derivation supports the
// requested short passphrases without changing credentials of existing >=8-char users.
// Keep these parameters fixed: changing them would lock out existing short-password accounts.
export async function authPassword(email: string, password: string) {
  validatePassword(password);
  if (password.length >= 8) return password;
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 310000,
      salt: new TextEncoder().encode("dudada:short-password:v1:" + email),
    },
    material,
    256,
  );
  return (
    "Dd1!" +
    Array.from(new Uint8Array(bits), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function loginOrCreate(username: string, password: string) {
  validatePassword(password);
  const originalEmail = await usernameEmail(username);
  const client = isolatedAuthClient();
  const resolved = await client.rpc("resolve_study_username", {
    p_username: normalizeUsername(username),
  });
  if (resolved.error && !missingAccountSetup(resolved.error))
    throw new Error(
      authFailureMessage(
        { ...resolved.error, status: resolved.status },
        "아이디 확인",
      ),
    );
  if (resolved.data?.status === "retired")
    throw new Error("변경 전 아이디입니다. 새 아이디로 로그인해 주세요.");
  const known = resolved.data?.status === "active";
  const email = known ? (resolved.data.email as string) : originalEmail;
  const credential = await authPassword(email, password);
  let result: AuthResponse = await client.auth.signInWithPassword({
    email,
    password: credential,
  });
  if (result.error) {
    if (!invalidCredentials(result.error))
      throw new Error(authFailureMessage(result.error));
    if (known) throw new Error("아이디 또는 비밀번호를 확인해 주세요.");
    result = await client.auth.signUp({
      email,
      password: credential,
      options: { data: { display_name: username.normalize("NFKC").trim() } },
    });
    if (result.error && existingAccount(result.error))
      throw new Error(
        "아이디 또는 비밀번호를 확인해 주세요. 같은 아이디의 비밀번호가 다르면 새 계정을 만들지 않습니다.",
      );
    if (result.error)
      throw new Error(authFailureMessage(result.error, "계정 생성"));
  }
  if (!result.data.session)
    throw new Error(
      "이메일 확인 때문에 가입이 완료되지 않았습니다. 관리자가 Supabase의 Confirm email 설정을 꺼야 합니다.",
    );
  try {
    await registerUsername(client, username);
    const session = result.data.session;
    const adopted = await cloudClient().auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (adopted.error) throw new Error(authFailureMessage(adopted.error));
    return adopted.data;
  } catch (error) {
    await client.auth.signOut({ scope: "local" });
    throw error instanceof Error ? error : new Error(accountError({}));
  }
}
