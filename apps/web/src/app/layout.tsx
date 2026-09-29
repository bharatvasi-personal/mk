import type { Metadata, Viewport } from 'next';
import { Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistrar } from '@/components/service-worker';
import { BRAND_NAME, SHOP } from '@/lib/config';

/*
 * The two faces the brand actually uses. Loaded through next/font so they are
 * self-hosted, preloaded and subset — a webfont request to Google on a 4G tether is a
 * render-blocking round trip to somebody else's server.
 */
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-playfair',
  display: 'swap',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  // Without this, Open Graph image URLs resolve against localhost, so the share card is
  // generated correctly and then advertised at an address nobody else can reach — the
  // WhatsApp preview stays blank, which is the exact problem the card exists to solve.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: `Mithila Kitchen Hyderabad — Homely Food Has Arrived`,
    template: `%s · ${BRAND_NAME}`,
  },
  description:
    'Freshly prepared homestyle Lunch & Dinner delivered across Hyderabad. Ghar ki Thali ' +
    'from ₹99, Mithila Deluxe Royal, and weekly or monthly subscriptions. ' +
    `${SHOP.tagline}`,
  keywords: [
    'homely food Hyderabad',
    'lunch delivery Gachibowli',
    'tiffin service Hitech City',
    'thali delivery Madhapur',
    'North Indian home food Hyderabad',
    'monthly meal subscription Hyderabad',
    'corporate lunch Hyderabad',
    'Mithila Kitchen',
  ],
  robots: { index: true, follow: true },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: BRAND_NAME, statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    siteName: BRAND_NAME,
    locale: 'en_IN',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The POS is a tablet app in a browser; pinch-zooming it mid-service is never wanted.
  maximumScale: 5,
  themeColor: '#a85516',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className={`${playfair.variable} ${jakarta.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
        {/* Rendered off-screen and made visible only by the print stylesheet. */}
        <pre id="thermal-bill" aria-hidden className="hidden" />
      </body>
    </html>
  );
}
