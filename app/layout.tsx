import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SideDesk — Your independent workspace",
  description: "Private freelance IT management",
};
export const dynamic = "force-dynamic";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
