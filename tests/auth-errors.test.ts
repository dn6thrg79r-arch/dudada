import { describe, it, expect } from "vitest";
import {
  invalidCredentials,
  existingAccount,
  authFailureMessage,
} from "../lib/auth-errors";
describe("인증 서버 오류 호환", () => {
  it("코드가 생략된 표준 자격 증명 오류도 신규 가입 흐름으로 연결한다", () => {
    expect(
      invalidCredentials({ status: 400, message: "Invalid login credentials" }),
    ).toBe(true);
    expect(
      invalidCredentials({ code: "invalid_credentials", status: 400 }),
    ).toBe(true);
  });
  it("연결키·제한·검증 오류에서는 가입을 시도하지 않는다", () => {
    for (const error of [
      { status: 401, message: "Invalid API key" },
      { status: 429, message: "Invalid login credentials" },
      { status: 400, code: "validation_failed", message: "invalid email" },
      { status: 400, message: "Something else" },
    ])
      expect(invalidCredentials(error)).toBe(false);
  });
  it("중복 계정은 기존 비밀번호 오류로 안내한다", () => {
    expect(
      existingAccount({ status: 422, message: "User already registered" }),
    ).toBe(true);
    expect(existingAccount({ code: "user_already_exists" })).toBe(true);
  });
  it("HTTP 상태·코드를 표시하고 원문 메시지나 키를 노출하지 않는다", () => {
    const text = authFailureMessage({
      status: 401,
      message: "sensitive credential",
    });
    expect(text).toContain("연결키");
    expect(text).toContain("HTTP 401");
    expect(text).not.toContain("sensitive credential");
    expect(
      authFailureMessage({ status: 400, code: "email_provider_disabled" }),
    ).toContain("이메일 로그인");
    expect(authFailureMessage({ status: 0 })).toContain("서버에 연결");
  });
});
