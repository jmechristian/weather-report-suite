import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

const serif = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Storm Leads",
  description: "Wind and hail homeowner leads for the DMV",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable} antialiased`}>{children}</body>
    </html>
  );
}
