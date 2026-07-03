import "./globals.css";
import type { Metadata } from "next";
import AppHeader from "../components/AppHeader";
import ElectronUpdaterBridge from "../components/ElectronUpdaterBridge";

export const metadata: Metadata = {
  title: "xyzDiplays Custom Quote App",
  description: "Frontend-only quote app",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ElectronUpdaterBridge>
          <AppHeader />
          {children}
        </ElectronUpdaterBridge>
      </body>
    </html>
  );
}
