import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline', robots: { index: false } };

/**
 * The fallback the service worker serves when a page is requested with no network and
 * nothing cached.
 *
 * It says what still works, because the honest answer is "most of it": bills already
 * taken are queued and safe, and cash and the shop's UPI QR do not depend on us at all.
 * A blank error page would make staff think the day's takings are gone.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-600 font-display text-2xl font-bold text-white">
        म
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-brand-900">No connection</h1>
      <p className="mt-2 text-ink-600">
        This screen needs the network. Nothing has been lost — bills taken at the counter are
        saved on this device and will sync by themselves.
      </p>

      <ul className="mt-6 space-y-2 rounded-xl border border-ink-200 bg-white p-4 text-left text-sm text-ink-600">
        <li>Keep taking cash and UPI on the shop QR — neither needs us.</li>
        <li>Write bills on the paper pad if the counter screen will not open.</li>
        <li>Reopen the counter once the network is back; queued bills send automatically.</li>
      </ul>

      <a
        href="/en/pos"
        className="pos-tap mt-6 rounded-lg bg-brand-600 px-5 py-3 font-semibold text-white"
      >
        Try the counter again
      </a>
    </main>
  );
}
