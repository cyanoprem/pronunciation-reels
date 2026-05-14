import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--app-font-sans",
});

export const metadata: Metadata = {
  title: "Video Feed Prototype",
  description: "Video Feed Prototype — a pronunciation learning app.",
  robots: "index, follow",
  openGraph: {
    title: "Video Feed Prototype",
    description: "Video Feed Prototype — a pronunciation learning app.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Video Feed Prototype",
    description: "Video Feed Prototype — a pronunciation learning app.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} flex justify-center min-h-dvh bg-[#07080F]`}>
        <Providers>
          <div className="relative w-full max-w-[430px] h-dvh overflow-hidden shrink-0">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
