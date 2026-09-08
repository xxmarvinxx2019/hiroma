import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const developmentPosCacheCleanup = `
(() => {
  const marker = 'hiroma:dev-pos-cache-cleanup-reload';
  const isPosWorker = (worker) => {
    try { return worker && new URL(worker.scriptURL).pathname === '/sw-pos.js'; }
    catch { return false; }
  };
  const run = async () => {
    if (!('serviceWorker' in navigator)) return;
    const controlled = isPosWorker(navigator.serviceWorker.controller);
    const registrations = await navigator.serviceWorker.getRegistrations();
    const matching = registrations.filter((registration) =>
      [registration.active, registration.waiting, registration.installing].some(isPosWorker)
    );
    const workerResults = await Promise.all(matching.map((registration) => registration.unregister()));
    const keys = 'caches' in window ? await caches.keys() : [];
    const cacheResults = await Promise.all(
      keys.filter((key) => key.startsWith('hiroma-pos-')).map((key) => caches.delete(key))
    );
    const cleaned = controlled || workerResults.some(Boolean) || cacheResults.some(Boolean);
    if (cleaned && sessionStorage.getItem(marker) !== 'done') {
      sessionStorage.setItem(marker, 'done');
      window.location.reload();
      return;
    }
    sessionStorage.removeItem(marker);
  };
  void run().catch((error) => console.warn('[GLOBAL POS DEV CACHE CLEANUP]', error));
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hiroma Digital",
  description: "Hiroma Digital business, reseller, and point-of-sale ecosystem.",
  manifest: "/manifest.webmanifest",
  applicationName: "Hiroma Digital",
  appleWebApp: {
    capable: true,
    title: "Hiroma POS",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {process.env.NODE_ENV !== "production" && (
          <Script id="hiroma-development-pos-cache-cleanup" strategy="beforeInteractive">
            {developmentPosCacheCleanup}
          </Script>
        )}
        {children}
      </body>
    </html>
  );
}
