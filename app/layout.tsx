import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shirley's iVocab Quiz",
  description: "AI-Powered Vocabulary Quiz Generator",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
