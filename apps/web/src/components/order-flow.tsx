'use client';

import { useEffect, useMemo, useState } from 'react';
import { extractGst, formatMinor } from '@mk/shared';
import { MenuList } from '@/components/menu-list';
import { Button, Card, ErrorNote, Field, inputClass } from '@/components/ui';
import { useCart } from '@/lib/cart';
import { useDict } from '@/lib/dict';
import { api, post, setAccessToken } from '@/lib/api';
import { DEFAULT_TENANT, RAZORPAY_KEY_ID } from '@/lib/config';
import type { PublicBranch, PublicMenuCategory } from '@/lib/server-api';

type Step = 'CART' | 'PHONE' | 'CODE' | 'DETAILS' | 'DONE';

interface PlacedOrder {
  orderId: string;
  tokenNo: number;
  totalMinor: number;
  taxMinor: number;
  subtotalMinor: number;
  paymentStatus: string;
}

/**
 * Customer ordering: cart → phone OTP → pickup slot → pay.
 *
 * Phone OTP rather than a password because there is no password for a customer to
 * forget, and a phone number is the thing the counter actually needs to call out an
 * order. The whole flow works with online payment switched off — the order is still
 * placed and paid at the counter — so the site can launch before the gateway activates.
 */
export function OrderFlow({ branch, categories }: { branch: PublicBranch; categories: PublicMenuCategory[] }) {
  const dict = useDict();
  const cart = useCart();
  const [step, setStep] = useState<Step>('CART');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [pickupAt, setPickupAt] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [onlineEnabled, setOnlineEnabled] = useState<boolean | null>(null);

  const lines = cart.lines;
  const subtotal = lines.reduce((s, l) => s + l.priceMinor * l.qty, 0);
  // Menu prices are GST-inclusive, so tax is shown as a component of the total rather
  // than added to it. Showing it as an addition would make the site look more expensive
  // than the board in the shop.
  const tax = useMemo(() => extractGst(subtotal, 500).tax, [subtotal]);

  useEffect(() => {
    void api<{ onlineEnabled: boolean }>('/payments/status')
      .then((r) => setOnlineEnabled(r.onlineEnabled))
      .catch(() => setOnlineEnabled(false));
  }, []);

  useEffect(() => {
    // Default to a pickup 30 minutes out, rounded to the next 15 — the realistic
    // minimum for a thali once the kitchen has seen the ticket.
    const t = new Date(Date.now() + 30 * 60_000);
    t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);
    setPickupAt(toLocalInput(t));
  }, []);

  async function requestOtp() {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ devCode?: string }>('/auth/customer/otp/request', {
        tenantSlug: DEFAULT_TENANT,
        phone,
      });
      setDevCode(res.devCode ?? null);
      setStep('CODE');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ accessToken: string; customer: { name: string | null } }>(
        '/auth/customer/otp/verify',
        { tenantSlug: DEFAULT_TENANT, phone, code, name: name || undefined },
      );
      setAccessToken(res.accessToken);
      if (res.customer.name) setName(res.customer.name);
      setStep('DETAILS');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(): Promise<PlacedOrder | null> {
    setBusy(true);
    setError(null);
    try {
      const clientRef = crypto.randomUUID();
      const order = await post<PlacedOrder>(
        '/public/orders',
        {
          branchId: branch.id,
          clientRef,
          // Every line in a cart shares a slot in practice; the first one decides.
          mealSlot: lines[0]?.mealSlot ?? 'ALL_DAY',
          items: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, notes: l.notes })),
          pickupAt: new Date(pickupAt).toISOString(),
          notes: notes || undefined,
        },
        clientRef,
      );
      setPlaced(order);
      return order;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function payAtCounter() {
    const order = await placeOrder();
    if (order) {
      cart.clear();
      setStep('DONE');
    }
  }

  async function payOnline() {
    const order = await placeOrder();
    if (!order) return;
    setBusy(true);
    try {
      const intent = await post<{
        gatewayOrderId: string;
        amountMinor: number;
        currency: string;
        publicKey: string;
      }>('/payments/intent', { orderId: order.orderId });

      await loadRazorpay();
      const rz = (window as unknown as { Razorpay?: new (o: unknown) => { open: () => void } }).Razorpay;
      if (!rz) throw new Error('Could not load the payment window. Please pay at the counter.');

      new rz({
        key: intent.publicKey || RAZORPAY_KEY_ID,
        order_id: intent.gatewayOrderId,
        amount: intent.amountMinor,
        currency: intent.currency,
        name: 'MithilaKitchen',
        description: `Pickup order #${order.tokenNo}`,
        prefill: { contact: phone, name },
        theme: { color: '#a85516' },
        // The browser callback is advisory only: the order is marked paid by the signed
        // server-side webhook, never by anything the page says.
        handler: () => {
          cart.clear();
          setStep('DONE');
        },
        modal: { ondismiss: () => setBusy(false) },
      }).open();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'DONE' && placed) {
    return (
      <Card className="mt-8 text-center">
        <h2 className="font-display text-2xl font-semibold text-leaf-600">{dict.checkout.successTitle}</h2>
        <p className="mt-2 text-ink-600">{dict.checkout.successBody}</p>
        <div className="mx-auto mt-6 w-fit rounded-xl border-2 border-brand-600 px-8 py-4">
          <div className="text-xs uppercase tracking-widest text-ink-400">{dict.checkout.token}</div>
          <div className="text-5xl font-bold tabular-nums text-brand-700">{placed.tokenNo}</div>
        </div>
        <p className="mt-4 text-ink-600">
          {formatMinor(placed.totalMinor)} ·{' '}
          {new Date(pickupAt).toLocaleString('en-IN', { timeStyle: 'short', dateStyle: 'medium' })}
        </p>
      </Card>
    );
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className={step === 'CART' ? '' : 'pointer-events-none opacity-50'}>
        <MenuList categories={categories} canOrder branchId={branch.id} />
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <h2 className="font-display text-lg font-semibold text-brand-800">{dict.cart.title}</h2>

          {lines.length === 0 ? (
            <p className="mt-4 text-sm text-ink-400">{dict.cart.empty}</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {lines.map((l) => (
                <li key={l.variantId} className="flex items-start gap-2 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-ink-400">
                      {l.variantName} · {formatMinor(l.priceMinor)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      aria-label="decrease"
                      className="pos-tap grid h-8 w-8 place-items-center rounded border border-ink-200"
                      onClick={() => cart.setQty(l.variantId, l.qty - 1)}
                    >
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums">{l.qty}</span>
                    <button
                      aria-label="increase"
                      className="pos-tap grid h-8 w-8 place-items-center rounded border border-ink-200"
                      onClick={() => cart.setQty(l.variantId, l.qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <span className="w-16 text-right tabular-nums">{formatMinor(l.priceMinor * l.qty)}</span>
                </li>
              ))}
            </ul>
          )}

          {lines.length > 0 ? (
            <dl className="mt-4 space-y-1 border-t border-ink-100 pt-3 text-sm">
              <div className="flex justify-between text-ink-600">
                <dt>{dict.cart.subtotal}</dt>
                <dd className="tabular-nums">{formatMinor(subtotal - tax)}</dd>
              </div>
              <div className="flex justify-between text-ink-600">
                <dt>{dict.cart.tax}</dt>
                <dd className="tabular-nums">{formatMinor(tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold">
                <dt>{dict.cart.total}</dt>
                <dd className="tabular-nums">{formatMinor(subtotal)}</dd>
              </div>
            </dl>
          ) : null}

          <div className="mt-4 space-y-3">
            <ErrorNote error={error} />

            {step === 'CART' ? (
              <Button className="w-full" disabled={lines.length === 0} onClick={() => setStep('PHONE')}>
                {dict.cart.checkout}
              </Button>
            ) : null}

            {step === 'PHONE' ? (
              <>
                <Field label={dict.checkout.phoneLabel} hint={dict.checkout.phoneHelp}>
                  <input
                    className={inputClass}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="9xxxxxxxxx"
                  />
                </Field>
                <Button className="w-full" disabled={phone.length !== 10 || busy} onClick={requestOtp}>
                  {busy ? dict.common.loading : dict.checkout.sendCode}
                </Button>
              </>
            ) : null}

            {step === 'CODE' ? (
              <>
                <Field label={dict.checkout.codeLabel}>
                  <input
                    className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
                {devCode ? (
                  <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    Development: SMS is not configured, your code is <strong>{devCode}</strong>
                  </p>
                ) : null}
                <Field label={dict.checkout.nameLabel}>
                  <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Button className="w-full" disabled={code.length !== 6 || busy} onClick={verifyOtp}>
                  {busy ? dict.common.loading : dict.checkout.verify}
                </Button>
              </>
            ) : null}

            {step === 'DETAILS' ? (
              <>
                <Field label={dict.checkout.pickupLabel}>
                  <input
                    className={inputClass}
                    type="datetime-local"
                    value={pickupAt}
                    onChange={(e) => setPickupAt(e.target.value)}
                  />
                </Field>
                <Field label={dict.common.notes}>
                  <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>

                {onlineEnabled ? (
                  <Button className="w-full" disabled={busy} onClick={payOnline}>
                    {busy ? dict.checkout.placing : dict.checkout.payNow}
                  </Button>
                ) : (
                  <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
                    {dict.checkout.paymentsOff}
                  </p>
                )}

                <Button variant="secondary" className="w-full" disabled={busy} onClick={payAtCounter}>
                  {busy ? dict.checkout.placing : dict.checkout.payAtShop}
                </Button>
              </>
            ) : null}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let razorpayPromise: Promise<void> | null = null;

/** Loaded on demand, not on every page: it is 100 KB the menu browsers never need. */
function loadRazorpay(): Promise<void> {
  razorpayPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Payment window failed to load'));
    document.head.appendChild(script);
  });
  return razorpayPromise;
}
