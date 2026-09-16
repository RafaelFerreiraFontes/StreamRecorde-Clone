import type { Metadata } from "next";
import "./globals.css";
import { DashboardProvider } from "@/components/provider";
import { Shell } from "@/components/shell";
export const metadata: Metadata = {
  title: "StreamRecorder | Integration console",
  description: "Technical API and Worker integration dashboard",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <DashboardProvider>
          <Shell>{children}</Shell>
        </DashboardProvider>
      </body>
    </html>
  );
}
