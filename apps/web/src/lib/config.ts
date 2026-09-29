export const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT ?? 'mithilakitchen';
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'MithilaKitchen';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '';

/** Shop facts that belong in content, not in code. Overridden by the API where it knows better. */
export const SHOP = {
  addressLines: ['Shop No. 1, Osman Nagar Road', 'Tellapur, Hyderabad, Telangana 502300'],
  phone: '+91 90000 00000',
  whatsapp: '919000000000',
  mapsQuery: 'Osman Nagar Road, Tellapur, Hyderabad 502300',
  openingDate: '2026-10-15',
  hours: [
    { label: 'Chai & snacks', value: '7:00 am – 10:00 pm' },
    { label: 'Lunch thali', value: '11:30 am – 3:30 pm' },
    { label: 'Chinese counter', value: '5:30 pm – 10:30 pm' },
  ],
};
