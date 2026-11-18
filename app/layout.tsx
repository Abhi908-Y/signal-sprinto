import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
import { SiteHeader, SiteFooter, DegradationBanners } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "Signal — outbound qualification & drafting",
  description:
    "Reads a company's own public pages, loops until named fields are filled, applies a deterministic rules engine, and drafts an email whose hook cites a verbatim quote.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${fraunces.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen antialiased">
        <SiteHeader />
        <DegradationBanners />
        <main className="mx-auto max-w-[1500px] px-4 py-5">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
