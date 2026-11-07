import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Flip", description: "eBay 되팔기 도우미" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
