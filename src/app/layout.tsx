import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import PlausibleProvider from "next-plausible";
import { TailwindIndicator } from "@/components/tailwind-indicator";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { SIDEBAR_WIDTH_SCRIPT } from "@/lib/sidebar";
import { ConvexClientProvider } from "@/providers/convex-provider";
import { defaultMetadata, ogMetadata, twitterMetadata } from "./metadata";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  ...defaultMetadata,
  twitter: {
    ...twitterMetadata,
  },
  openGraph: {
    ...ogMetadata,
  },
};

/**
 * Analytics is opt-in per deployment: without NEXT_PUBLIC_PLAUSIBLE_DOMAIN the
 * app renders nothing rather than reporting to another site's domain.
 */
function Analytics({ children }: { children: React.ReactNode }) {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  if (!domain) {
    return <>{children}</>;
  }
  return <PlausibleProvider domain={domain}>{children}</PlausibleProvider>;
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <script
            // Restores a stored sidebar width before first paint.
            dangerouslySetInnerHTML={{ __html: SIDEBAR_WIDTH_SCRIPT }}
          />
          <Analytics>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <ConvexClientProvider>
                {children}
                <TailwindIndicator />
                <Toaster />
              </ConvexClientProvider>
            </ThemeProvider>
          </Analytics>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
