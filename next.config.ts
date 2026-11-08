import type { NextConfig } from "next";
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
