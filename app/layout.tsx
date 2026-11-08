import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "두다다 공부방 · PDF로 시작하는 필사",
  description:
    "PDF와 암기노트를 나만의 한국어 타자연습으로. 파일은 브라우저에서 안전하게 처리합니다.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
