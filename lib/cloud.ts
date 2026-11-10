import { createClient, type SupabaseClient } from "@supabase/supabase-js";
export const cloudConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
let client: SupabaseClient | undefined;
export function cloudClient() {
  if (!cloudConfigured) throw new Error("클라우드 연결 설정이 필요합니다.");
  if (!client)
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
  const email = await usernameEmail(username);
  const credential = await authPassword(email, password);
  const client = cloudClient();
  const login = await client.auth.signInWithPassword({
    email,
    password: credential,
  });
  if (!login.error) return login.data;
  if (login.error.code !== "invalid_credentials")
    throw new Error(
      "로그인하지 못했습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도해 주세요.",
    );
  const created = await client.auth.signUp({
    email,
    password: credential,
    options: { data: { display_name: username.normalize("NFKC").trim() } },
  });
  if (created.error?.code === "user_already_exists")
    throw new Error(
      "아이디 또는 비밀번호를 확인해 주세요. 같은 아이디의 비밀번호가 다르면 새 계정을 만들지 않습니다.",
    );
  if (created.error)
    throw new Error(
      "계정을 만들지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 서버의 가입 설정을 확인해 달라고 해주세요.",
    );
  if (!created.data.session)
    throw new Error(
      "이메일 확인 때문에 가입이 완료되지 않았습니다. 관리자가 Supabase의 Confirm email 설정을 꺼야 합니다.",
    );
  return created.data;
}
