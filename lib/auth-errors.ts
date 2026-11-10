export type AuthFailure = {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
};
// Some Auth gateways do not expose the API-version header, so auth-js omits code.
// Accept only the documented credential error, never arbitrary HTTP 400 failures.
export function invalidCredentials(error: AuthFailure) {
  return (
    error.code === "invalid_credentials" ||
    (!error.code &&
      error.status === 400 &&
      /^invalid login credentials$/i.test(error.message?.trim() || ""))
  );
}
export function existingAccount(error: AuthFailure) {
  return (
    error.code === "user_already_exists" ||
    (!error.code &&
      [400, 422].includes(error.status || 0) &&
      /^user already registered$/i.test(error.message?.trim() || ""))
  );
}
export function authFailureMessage(error: AuthFailure, stage = "로그인") {
  const code =
    error.code && /^[a-z_0-9]{1,80}$/i.test(error.code)
      ? error.code
      : "unknown";
  const status = typeof error.status === "number" ? error.status : 0;
  const detail = `[${code} · HTTP ${status}]`;
  if (
    status === 401 ||
    status === 403 ||
    code === "bad_jwt" ||
    code === "invalid_api_key"
  )
    return `Supabase 연결키가 거절됐습니다. GitHub의 Project URL과 Publishable key가 같은 프로젝트의 값인지 확인해 주세요. ${detail}`;
  if (code === "email_provider_disabled")
    return `Supabase에서 이메일 로그인이 꺼져 있습니다. Authentication의 Email을 켜 주세요. ${detail}`;
  if (code === "signup_disabled")
    return `Supabase에서 새 계정 생성이 꺼져 있습니다. 신규 가입 허용 설정을 확인해 주세요. ${detail}`;
  if (code === "email_not_confirmed")
    return `이메일 확인이 필요합니다. Supabase의 Confirm email 설정을 꺼 주세요. ${detail}`;
  if (status === 429 || code.includes("rate_limit"))
    return `요청이 많아 잠시 제한됐습니다. 잠시 후 다시 시도해 주세요. ${detail}`;
  if (code === "email_address_invalid" || code === "validation_failed")
    return `Supabase가 계정 정보를 거절했습니다. 관리자에게 아래 오류를 알려주세요. ${detail}`;
  if (code === "weak_password")
    return `Supabase 비밀번호 정책에 맞지 않습니다. 관리자에게 아래 오류를 알려주세요. ${detail}`;
  if (status === 0)
    return `Supabase 서버에 연결하지 못했습니다. 프로젝트 주소와 인터넷 연결을 확인해 주세요. ${detail}`;
  return `${stage} 요청이 서버에서 거절됐습니다. 아래 오류 코드를 알려주세요. ${detail}`;
}
