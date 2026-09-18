import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { verifyRazorpaySignature } from "@/lib/razorpay";
import { notifyKitchenOfNewOrder } from "@/lib/whatsapp";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

interface VerifyBody {
  orderId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

function isValidBody(body: unknown): body is VerifyBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.orderId === "string" &&
    typeof b.razorpay_order_id === "string" &&
    typeof b.razorpay_payment_id === "string" &&
    typeof b.razorpay_signature === "string"
  );
}

export async function POST(req: Request) {
  const clientKey = getClientKey(req);
  const { allowed } = checkRateLimit(`verify:${clientKey}`, 20);
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
    return NextResponse.json({ error: "Invalid verification payload" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.orderId)
    .eq("razorpay_order_id", body.razorpay_order_id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const valid = verifyRazorpaySignature({
    orderId: body.razorpay_order_id,
    paymentId: body.razorpay_payment_id,
    signature: body.razorpay_signature,
  });

  if (!valid) {
    await supabase
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("id", order.id);
    return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
  }

  const { data: updatedOrder } = await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      razorpay_payment_id: body.razorpay_payment_id,
      razorpay_signature: body.razorpay_signature,
    })
    .eq("id", order.id)
    .select()
    .single();

  if (updatedOrder) {
    notifyKitchenOfNewOrder(updatedOrder).catch((err) =>
      console.error("Failed to notify kitchen via WhatsApp", err)
    );
  }

  return NextResponse.json({
    orderCode: order.order_code,
    status: "paid",
  });
}
