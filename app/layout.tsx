import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Custom Quote Demo",
  description: "Frontend-only quote app demo",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
