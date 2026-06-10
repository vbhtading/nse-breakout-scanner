import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HighBreak | NSE Daily + Weekly High Breakout Scanner",
  description: "Scans a curated list of NSE stocks for price breakouts above yesterday high and above 5-day high, combined with elevated volume. Shows common stocks that satisfy both conditions. Powered by Yahoo Finance. Ready for Vercel.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0f1a]">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
