# MithilaKitchen

Ordering site for a home-based cloud kitchen serving rotating Bihar / Mithila-style
thalis in Hyderabad.

**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS · Supabase (PostgreSQL +
Auth) · Razorpay Checkout · WhatsApp Business Cloud API (with a `wa.me` fallback) ·
deployed to Vercel · installable as a PWA.

## Features

- **Customer flow** — browse today's menu (sold-out items are flagged and un-orderable),
  cart, checkout (name/phone/address/notes), pay with Razorpay, get a confirmation with
  a trackable order ID.
- **Order tracking** — `/track` looks up any order by its ID (e.g. `MK-AB12CD`).
- **Admin dashboard** (`/admin`) — signed in via Supabase Auth (email/password, no
  hardcoded PIN). View all orders, advance status New → Preparing → Out for Delivery →
  Delivered, toggle daily item availability, see today's order count and revenue.
- **Delivery view** (`/delivery`) — orders currently Out for Delivery only, with
  tap-to-call, tap-to-navigate (Google Maps), and a one-tap Mark Delivered button.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

The app runs at http://localhost:3000. Admin dashboard: http://localhost:3000/admin
(redirects to `/admin/login`). Delivery view: http://localhost:3000/delivery.

### Database

See [`supabase/README.md`](./supabase/README.md) for running the migrations, seeding
the menu, and creating your first admin/staff user.

## Environment variables

Set these in `.env.local` for local dev, and in your Vercel project's Environment
Variables for production. **Never commit real values** — `.env.local` is gitignored.

| Variable | Where it's used | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Public anon key (safe to expose; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Bypasses RLS — used by API routes for the public ordering flow. **Secret, server-side only.** |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | client + server | Razorpay Key ID. Use a **test-mode** key to start. |
| `RAZORPAY_KEY_SECRET` | server only | Razorpay Key Secret. **Secret.** |
| `WHATSAPP_CLOUD_API_TOKEN` | server only | WhatsApp Business Cloud API access token. Leave blank until your app is approved — the app falls back to generating a `wa.me` deep link instead. |
| `WHATSAPP_PHONE_NUMBER_ID` | server only | The Cloud API phone number ID (not the phone number itself). |
| `WHATSAPP_BUSINESS_NUMBER` | server only | The kitchen's WhatsApp number (with country code, digits only), used for both the Cloud API and the `wa.me` fallback. |
| `NEXT_PUBLIC_FSSAI_NUMBER` | client | Displayed in the footer and on order confirmations. Required by FSSAI regulations before going live. |
| `NEXT_PUBLIC_KITCHEN_NAME` | client | Defaults to "MithilaKitchen" |
| `NEXT_PUBLIC_KITCHEN_CITY` | client | Defaults to "Hyderabad" |

None of these are placeholders you should ship in a real deployment — get the real
FSSAI number, Razorpay keys, and WhatsApp number before going live, and set them only
as environment variables (locally in `.env.local`, in production in Vercel's project
settings), never in code.

## Payments

Razorpay Checkout handles all card/UPI entry — this app never touches card data. The
server creates a Razorpay order (`/api/orders`), the client opens Razorpay's hosted
checkout, and the server verifies the payment signature (`/api/orders/verify`) before
marking the order paid. Start with Razorpay **test mode** keys; switch to live keys
(and re-check your Razorpay KYC/activation) when ready to accept real payments.

## WhatsApp notifications

Once your WhatsApp Business Cloud API app is approved, set `WHATSAPP_CLOUD_API_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_BUSINESS_NUMBER` and new-order notifications
are sent automatically via the Cloud API. Until then, leave the token blank — the app
still returns a `wa.me` deep link so staff can send the notification manually with one
tap.

## Rate limiting

The public ordering API (`/api/orders`, `/api/orders/verify`, `/api/orders/track/:code`)
is rate-limited per IP (in-memory, per server instance). This is sufficient for a
single-region Vercel deployment; if you scale to multiple regions, swap
`src/lib/rateLimit.ts` for a shared store (e.g. Upstash Redis).

## Deployment (Vercel)

1. Push this repo to GitHub and import it in Vercel.
2. Add all environment variables above in the Vercel project settings (Production and
   Preview).
3. Deploy. Vercel builds with `next build` automatically.
4. Run the Supabase migrations against your production project before going live.

## PWA / installability

The app ships a `manifest.json` and a minimal service worker (`public/sw.js`) so it's
installable on Android/iOS home screens. No native app build is planned at this stage.
The bundled icons are placeholders in the brand colors — swap `public/icons/icon-192.png`
and `public/icons/icon-512.png` for real branded artwork before launch.

## Brand palette

| Color | Hex |
| --- | --- |
| Maroon | `#9C2B3D` |
| Mustard | `#E0A526` |
| Indigo | `#2B3A67` |
| Cream | `#FBF3E5` |

## Security notes

- Card data is never handled by this app — Razorpay Checkout's hosted iframe/redirect
  owns that entirely.
- All secrets live in environment variables, never in source.
- Admin/delivery routes require Supabase Auth **and** a matching row in the
  `admin_users` table (see `supabase/README.md`) — there is no hardcoded PIN.
- Row Level Security is enabled on all tables; customer-facing API routes use the
  service role key server-side and validate/authorize every write themselves.
- `npm audit` is clean except one advisory in Next.js's own bundled build-time
  PostCSS (not part of the runtime request path); fixing it requires jumping to the
  Next.js 16 major version, which is a larger upgrade left for a follow-up.
