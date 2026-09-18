"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useCart } from "@/components/CartContext";
import { formatRupees } from "@/lib/constants";

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function CheckoutPage() {
  const { items, totalPaise, clear } = useCart();
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (items.length === 0) {
      setError("Your cart is empty.");
      return;
    }

    setSubmitting(true);
    try {
      const createRes = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          customerPhone: phone,
          deliveryAddress: address,
          notes,
          items: items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        setError(createData.error || "Could not create order.");
        setSubmitting(false);
        return;
      }

      const { orderId, orderCode, totalPaise: amount, razorpayOrderId, razorpayKeyId } =
        createData;

      const rzp = new window.Razorpay({
        key: razorpayKeyId,
        amount,
        currency: "INR",
        name: "MithilaKitchen",
        description: `Order ${orderCode}`,
        order_id: razorpayOrderId,
        prefill: { name, contact: phone },
        theme: { color: "#9C2B3D" },
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch("/api/orders/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            if (!verifyRes.ok) {
              setError("Payment verification failed. Please contact us with your order ID.");
              setSubmitting(false);
              return;
            }
            clear();
            router.push(`/track?code=${orderCode}&justPaid=1`);
          } catch {
            setError("Payment verification failed. Please contact us with your order ID.");
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => setSubmitting(false),
        },
      });

      rzp.open();
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <h1 className="mb-6 text-2xl font-bold text-indigo">Checkout</h1>

      <div className="card mb-6 p-4">
        {items.length === 0 ? (
          <p className="text-indigo/70">Your cart is empty.</p>
        ) : (
          <ul className="divide-y divide-mustard/20">
            {items.map((i) => (
              <li key={i.itemId} className="flex justify-between py-2 text-sm">
                <span>
                  {i.name} × {i.quantity}
                </span>
                <span>{formatRupees(i.pricePaise * i.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-between border-t border-mustard/30 pt-3 font-bold text-indigo">
          <span>Total</span>
          <span>{formatRupees(totalPaise)}</span>
        </div>
      </div>

      <form onSubmit={handlePay} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-indigo">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-mustard/40 px-4 py-3"
            placeholder="Your name"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-indigo">Phone</label>
          <input
            required
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-mustard/40 px-4 py-3"
            placeholder="10-digit mobile number"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-indigo">
            Delivery address
          </label>
          <textarea
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-xl border border-mustard/40 px-4 py-3"
            rows={3}
            placeholder="Flat / street / landmark / area"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-indigo">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-mustard/40 px-4 py-3"
            rows={2}
            placeholder="Spice level, allergies, delivery instructions..."
          />
        </div>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={submitting || items.length === 0}
          className="btn-primary w-full"
        >
          {submitting ? "Processing..." : `Pay ${formatRupees(totalPaise)}`}
        </button>
      </form>
    </div>
  );
}
