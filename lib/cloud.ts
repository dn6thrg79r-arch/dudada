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
export async function loginOrCreate(username: string, password: string) {
  if (password.length < 8 || password.length > 128)
    throw new Error("비밀번호는 8~128자로 입력해 주세요.");
  const email = await usernameEmail(username);
  const client = cloudClient();
  const login = await client.auth.signInWithPassword({ email, password });
  if (!login.error) return login.data;
  if (login.error.code !== "invalid_credentials")
    throw new Error(
      "로그인하지 못했습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도해 주세요.",
    );
  const created = await client.auth.signUp({
    email,
    password,
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
