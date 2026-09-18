import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { generateOrderCode } from "@/lib/orderCode";
import { getRazorpayClient } from "@/lib/razorpay";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

interface CreateOrderBody {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  notes?: string;
  items: { itemId: string; quantity: number }[];
}

function isValidBody(body: unknown): body is CreateOrderBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.customerName === "string" &&
    b.customerName.trim().length > 0 &&
    typeof b.customerPhone === "string" &&
    /^[0-9+\-\s]{7,15}$/.test(b.customerPhone.trim()) &&
    typeof b.deliveryAddress === "string" &&
    b.deliveryAddress.trim().length > 0 &&
    Array.isArray(b.items) &&
    b.items.length > 0 &&
    b.items.every(
      (i) =>
        i &&
        typeof i === "object" &&
        typeof (i as any).itemId === "string" &&
        Number.isInteger((i as any).quantity) &&
        (i as any).quantity > 0 &&
        (i as any).quantity <= 20
    )
  );
}

export async function POST(req: Request) {
  const clientKey = getClientKey(req);
  const { allowed } = checkRateLimit(`orders:${clientKey}`, 10);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValidBody(body)) {
    return NextResponse.json({ error: "Invalid order details" }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();

  const itemIds = body.items.map((i) => i.itemId);
  const { data: dbItems, error: itemsError } = await supabase
    .from("items")
    .select("*")
    .in("id", itemIds);

  if (itemsError || !dbItems || dbItems.length !== new Set(itemIds).size) {
    return NextResponse.json({ error: "One or more items are invalid" }, { status: 400 });
  }

  const soldOut = dbItems.find((i: any) => i.sold_out);
  if (soldOut) {
    return NextResponse.json(
      { error: `${soldOut.name} is sold out. Please update your cart.` },
      { status: 409 }
    );
  }

  let subtotalPaise = 0;
  const orderItemsPayload = body.items.map((cartItem) => {
    const dbItem = dbItems.find((i: any) => i.id === cartItem.itemId)!;
    const lineTotal = dbItem.price_paise * cartItem.quantity;
    subtotalPaise += lineTotal;
    return {
      item_id: dbItem.id,
      item_name: dbItem.name,
      unit_price_paise: dbItem.price_paise,
      quantity: cartItem.quantity,
    };
  });

  const totalPaise = subtotalPaise; // no delivery fee / taxes at this stage
  const orderCode = generateOrderCode();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_code: orderCode,
      customer_name: body.customerName.trim(),
      customer_phone: body.customerPhone.trim(),
      delivery_address: body.deliveryAddress.trim(),
      notes: (body.notes || "").trim(),
      subtotal_paise: subtotalPaise,
      total_paise: totalPaise,
      status: "new",
      payment_status: "pending",
    })
    .select()
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  const { error: itemsInsertError } = await supabase
    .from("order_items")
    .insert(orderItemsPayload.map((i) => ({ ...i, order_id: order.id })));

  if (itemsInsertError) {
    return NextResponse.json({ error: "Failed to save order items" }, { status: 500 });
  }

  try {
    const razorpay = getRazorpayClient();
    const razorpayOrder = await razorpay.orders.create({
      amount: totalPaise,
      currency: "INR",
      receipt: orderCode,
      notes: { order_id: order.id, order_code: orderCode },
    });

    await supabase
      .from("orders")
      .update({ razorpay_order_id: razorpayOrder.id })
      .eq("id", order.id);

    return NextResponse.json({
      orderId: order.id,
      orderCode,
      totalPaise,
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Razorpay order creation failed", err);
    return NextResponse.json(
      { error: "Could not initiate payment. Please try again." },
      { status: 502 }
    );
  }
}
