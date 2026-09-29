export const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? 'mithilakitchen';
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'MithilaKitchen';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '';

/**
 * Brand facts, taken from the live site rather than invented.
 *
 * These belong in content, not scattered through components — the phone number appears in
 * nine places and changing it in nine places is how one of them ends up wrong.
 */
export const SHOP = {
  tagline: 'Traditional Taste. Timeless Love.',
  city: 'Hyderabad',
  whatsapp: '919738872001',
  phoneDisplay: '+91 97388 72001',
  instagram: 'mithilakitchen',
  addressLines: ['Osman Nagar Road, Tellapur', 'Hyderabad, Telangana 502300'],
  mapsQuery: 'Osman Nagar Road, Tellapur, Hyderabad 502300',
  openingDate: '2026-10-15',

  /** Pre-order cutoffs, shown in the announcement bar and on the menu cards. */
  service: [
    {
      key: 'LUNCH',
      icon: '🍛',
      label: 'Homestyle Lunch',
      window: '12:00 PM – 3:00 PM',
      contents: 'Dal • Rice • Seasonal Vegetable / Chicken Curry • Roti or Paratha • Salad & Achaar',
      cutoff: 'Pre-order Lunch by 10:00 AM',
      delivery: 'Delivered 12:30 PM – 2:00 PM',
    },
    {
      key: 'DINNER',
      icon: '🌙',
      label: 'Homestyle Dinner',
      window: '7:00 PM – 10:00 PM',
      contents: 'Roti or Paratha • Dal • Vegetable / Chicken Curry • Steamed Rice & Accompaniments',
      cutoff: 'Pre-order Dinner by 4:00 PM',
      delivery: 'Delivered 7:30 PM – 9:30 PM',
    },
  ],

  promise: [
    { icon: '🌿', title: 'Quality Ingredients', body: 'We carefully select the everyday ingredients that go into your meals.' },
    { icon: '🫙', title: 'Thoughtful Cooking', body: 'Traditional recipes and familiar flavours inspired by the warmth of home kitchens.' },
    { icon: '🧼', title: 'Hygienic Preparation', body: 'Clean and organised food preparation practices are an important part of our kitchen.' },
    { icon: '📦', title: 'Food-Grade Packaging', body: 'Every meal is packed carefully using food-grade packaging for delivery.' },
  ],

  why: [
    'Quality Ingredients',
    'Traditional Home-Style Taste',
    'Hygienic Preparation',
    'Food-Grade Packaging',
    'Freshly Prepared Meals',
  ],

  steps: [
    {
      n: '01',
      title: 'Choose your meal',
      body: 'Select from our freshly curated daily Lunch, Dinner, Mithila Specials, or Corporate meal boxes.',
    },
    {
      n: '02',
      title: 'Order through WhatsApp',
      body: 'Review your items, input your Hyderabad address and preferred delivery time. We auto-format your order into WhatsApp.',
    },
    {
      n: '03',
      title: 'Enjoy food that feels like home',
      body: 'Piping hot, wholesome Indian comfort food delivered in food-grade packaging, just like mom sent it over.',
    },
  ],

  /** Delivery zones. Times are indicative and confirmed on WhatsApp per order. */
  areas: [
    { name: 'Gachibowli', note: 'IT Corridor', eta: '30–40 min' },
    { name: 'Kondapur', note: 'Residential & Tech Hub', eta: '30–45 min' },
    { name: 'Hitech City', note: 'Cyber Towers & Mindspace', eta: '25–35 min' },
    { name: 'Madhapur', note: 'Commercial Center', eta: '30–40 min' },
    { name: 'Financial District', note: 'Wipro Circle & ISB', eta: '35–45 min' },
    { name: 'Nanakramguda', note: 'WaveRock & Tech Parks', eta: '35–45 min' },
    { name: 'Kokapet', note: 'Neopolis & Gated Communities', eta: '40–50 min' },
    { name: 'Tellapur', note: 'Townships & Villa Communities', eta: '40–50 min' },
    { name: 'Jubilee Hills', note: 'Central West Hyderabad', eta: '35–45 min' },
    { name: 'Banjara Hills', note: 'Central Hyderabad', eta: '40–50 min' },
    { name: 'Manikonda & Puppalguda', note: 'Residential Corridor', eta: '30–40 min' },
    { name: 'Gowlidoddy', note: 'Q-City & Hostels', eta: '30–40 min' },
  ],

  corporate: [
    'Office Lunches',
    'Team Meals',
    'Meetings',
    'Training Sessions',
    'Corporate Events',
    'Recurring Meal Requirements',
  ],
};

/** A WhatsApp deep link with a pre-filled message. */
export function whatsappLink(message: string): string {
  return `https://wa.me/${SHOP.whatsapp}?text=${encodeURIComponent(message)}`;
}
