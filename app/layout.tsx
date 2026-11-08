import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "두다다 공부방 · PDF로 시작하는 필사",
  description:
    "PDF 원문을 읽으며 내 속도로 필사하는 집중형 공부방. 파일과 필사는 브라우저에만 머뭅니다.",
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
