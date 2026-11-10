import type { NextConfig } from "next";
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let privileged = publicKey?.startsWith("sb_secret_") || false;
if (publicKey?.split(".").length === 3) {
  try {
    privileged =
      JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString())
        .role !== "anon";
  } catch {}
}
if (privileged)
  throw new Error(
    "서버 비밀 키를 공개 빌드에 넣을 수 없습니다. Supabase publishable key를 사용하세요.",
  );
const pages = process.env.GITHUB_PAGES === "1";
const config: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  ...(pages
    ? {
        output: "export",
        trailingSlash: true,
        basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
      }
    : {}),
};
export default config;
