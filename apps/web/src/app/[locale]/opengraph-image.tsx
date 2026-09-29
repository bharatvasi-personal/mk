import { ImageResponse } from 'next/og';
import { getDictionary } from '@mk/shared';
import { resolveLocale } from '@/lib/i18n';

export const alt = 'MithilaKitchen — home food, made honestly. Osman Nagar, Tellapur.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The share card.
 *
 * This matters more here than it would elsewhere: the menu link will be pasted into
 * Tellapur WhatsApp groups, and a link with no preview card looks like spam next to one
 * that shows the name, the tagline and the address. Without this the preview was blank.
 *
 * Drawn with shapes and Latin text rather than the Devanagari mark, because the image
 * renderer has no Indic font bundled and would render tofu boxes. One card per locale,
 * with the tagline in that language where the script allows it.
 */
export default async function OpengraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale);
  const dict = getDictionary(locale);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #fdf6ed 0%, #f8e7cd 100%)',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              background: '#a85516',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fdf6ed',
              fontSize: 48,
              fontWeight: 700,
            }}
          >
            MK
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 52, fontWeight: 700, color: '#5a2c16' }}>MithilaKitchen</div>
            <div style={{ fontSize: 26, color: '#a85516' }}>Osman Nagar · Tellapur · Hyderabad</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: '#211d19', lineHeight: 1.1, maxWidth: 900 }}>
            {locale === 'en' ? dict.home.heroTitle : 'Home food, made honestly.'}
          </div>
          <div style={{ fontSize: 30, color: '#5f584e', maxWidth: 880 }}>
            Thali at lunch · Chai all day · Chinese in the evening
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {['Less oil', 'Fresh vegetables', 'Mithila specials'].map((tag) => (
            <div
              key={tag}
              style={{
                fontSize: 24,
                color: '#853f16',
                background: '#f0cb98',
                padding: '10px 22px',
                borderRadius: 999,
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
