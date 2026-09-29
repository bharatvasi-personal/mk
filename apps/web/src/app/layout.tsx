import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { BRAND_NAME } from '@/lib/config';

export const metadata: Metadata = {
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
        {/* Rendered off-screen and made visible only by the print stylesheet. */}
        <pre id="thermal-bill" aria-hidden className="hidden" />
      </body>
    </html>
  );
}
