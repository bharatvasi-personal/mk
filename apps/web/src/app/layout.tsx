import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { ServiceWorkerRegistrar } from '@/components/service-worker';
import { BRAND_NAME } from '@/lib/config';

export const metadata: Metadata = {
  // Without this, Open Graph image URLs resolve against localhost, so the share card is
  // generated correctly and then advertised at an address nobody else can reach — the
  // WhatsApp preview stays blank, which is the exact problem the card exists to solve.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: `${BRAND_NAME} — Home food, made honestly | Tellapur, Hyderabad`,
    template: `%s · ${BRAND_NAME}`,
  },
  description:
    'Proper home-style food in Osman Nagar, Tellapur. Less oil, fresh vegetables, ' +
    'a lunch thali, chai all day, and Mithila specialities you will not find nearby.',
  keywords: [
    'home food Tellapur',
    'thali Osman Nagar',
    'mess near Tellapur',
    'Mithila food Hyderabad',
    'litti chokha Hyderabad',
    'lunch thali 502300',
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
    <html>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistrar />
        {/* Rendered off-screen and made visible only by the print stylesheet. */}
        <pre id="thermal-bill" aria-hidden className="hidden" />
      </body>
    </html>
  );
}
