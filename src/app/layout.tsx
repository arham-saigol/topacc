import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "topacc.lol — the most valued accounts on X",
  description:
    "A paid leaderboard for X accounts. Spend money, take a rank. The highest total is the most valued account on X, decided by money.",
  openGraph: {
    title: "topacc.lol",
    description:
      "The most valued accounts on X, decided by money. Claim your rank.",
    url: "https://topacc.lol",
    siteName: "topacc.lol",
    images: [`https://unavatar.io/x/elonmusk?fallback=false`],
  },
  twitter: {
    card: "summary",
    site: "@topacclol",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
