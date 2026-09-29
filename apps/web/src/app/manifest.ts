import type { MetadataRoute } from 'next';
import { BRAND_NAME } from '@/lib/config';

/**
 * The web app manifest, which is what makes the POS installable to a tablet's home
 * screen. Without it the counter is "a browser tab someone might close", which is not
 * what you want the shop's till to be.
 *
 * `start_url` points at the POS rather than the marketing site: the person installing
 * this is staff, and the first thing they should see on tap is the counter.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND_NAME} — Counter`,
    short_name: BRAND_NAME,
    description: 'Counter, kitchen display and back office for MithilaKitchen.',
    start_url: '/en/pos',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f7f6f4',
    theme_color: '#a85516',
    lang: 'en',
    categories: ['business', 'food', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Counter', short_name: 'Counter', url: '/en/pos' },
      { name: 'Kitchen', short_name: 'Kitchen', url: '/en/kitchen' },
      { name: 'Attendance', short_name: 'Punch', url: '/en/punch' },
    ],
  };
}
