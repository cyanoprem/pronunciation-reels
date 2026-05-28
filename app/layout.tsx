import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

const IS_DEV = process.env.NODE_ENV !== "production";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--app-font-sans",
});

export const metadata: Metadata = {
  title: "Video Feed Prototype",
  description: "Video Feed Prototype — a pronunciation learning app.",
  robots: "index, follow",
  // Empty inline icon suppresses the browser's automatic /favicon.ico probe,
  // which the in-app webview fired on every document load (~16K edge req/12h).
  // The webview has no tab/address bar, so no icon is ever displayed anyway.
  icons: { icon: "data:," },
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
        {IS_DEV && (
          <Script src="/browser-shim.js" strategy="beforeInteractive" />
        )}
        <Providers>
          <div className="relative w-full max-w-[430px] h-dvh overflow-hidden shrink-0">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
