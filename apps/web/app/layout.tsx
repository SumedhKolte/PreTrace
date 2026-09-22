import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PrepTrace — AI Interview Prep", template: "%s · PrepTrace" },
  description: "Turn any job description into your interview advantage with researched, personalized preparation.",
  icons: {
    icon: [
      { url: "/icon.png", sizes: "64x64", type: "image/png" },
      { url: "/favicon.ico", sizes: "32x32" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "PrepTrace — Turn Job Descriptions into Interview Advantage",
    description: "Personalized, research-grounded interview kits, question coverage, and flashcards.",
    images: [{ url: "/banner.png", width: 1024, height: 384, alt: "PrepTrace Banner" }],
  },
};

export const viewport: Viewport = { themeColor: "#f8f8f7" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
