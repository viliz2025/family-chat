import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Семейный чат",
  description: "Уютное место для общения с близкими",
  manifest: "/manifest.json",
  other: {
    google: "notranslate"
  },
  appleWebApp: {
    capable: true,
    title: "Семейный чат",
    statusBarStyle: "default"
  }
};

export const viewport: Viewport = {
  themeColor: "#d98b73",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="notranslate" lang="ru" translate="no">
      <body className="notranslate">{children}</body>
    </html>
  );
}
