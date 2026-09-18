import type { Metadata, Viewport } from "next";
import "./globals.css";
import Footer from "@/components/Footer";
import { CartProvider } from "@/components/CartContext";
import { KITCHEN_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: `${KITCHEN_NAME} — Home-style Bihar & Mithila Thalis`,
  description:
    "Order rotating daily thalis from a home-based cloud kitchen serving Bihar & Mithila-style food in Hyderabad.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: KITCHEN_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: "#9C2B3D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="flex min-h-screen flex-col font-body">
        <CartProvider>
          <div className="flex-1">{children}</div>
        </CartProvider>
        <Footer />
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); }); }`,
          }}
        />
      </body>
    </html>
  );
}
