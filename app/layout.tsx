import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WaveCenter",
  description: "The hub of the DEO movement, and the original DEO.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
