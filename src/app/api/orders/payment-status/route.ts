import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

interface Body {
  orderId: string;
  razorpay_order_id: string;
  status: "failed" | "cancelled";
  reason?: string;
}

function isValidBody(body: unknown): body is Body {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.orderId === "string" &&
    typeof b.razorpay_order_id === "string" &&
    (b.status === "failed" || b.status === "cancelled") &&
    (b.reason === undefined || typeof b.reason === "string")
  );
}

/**
 * Called client-side when Razorpay Checkout reports a failed payment or the
 * customer dismisses the modal without paying. Lets admin see these as
 * "payment issues" instead of them silently sitting as "new" orders forever.
 */
export async function POST(req: Request) {
  const clientKey = getClientKey(req);
  const { allowed } = checkRateLimit(`payment-status:${clientKey}`, 30);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  // Only ever move a still-pending order into failed/cancelled — never
  // overwrite a payment that has already been confirmed paid (e.g. a stray
  // "dismiss" event firing after a successful payment already landed).
  const { data, error } = await supabase
    .from("orders")
    .update({
      payment_status: body.status,
      payment_failure_reason: body.reason?.slice(0, 500) || null,
    })
    .eq("id", body.orderId)
    .eq("razorpay_order_id", body.razorpay_order_id)
    .eq("payment_status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }

  return NextResponse.json({ updated: Boolean(data) });
}
