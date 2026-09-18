import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: { code: string } }) {
  const clientKey = getClientKey(req);
  const { allowed } = checkRateLimit(`track:${clientKey}`, 30);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const code = params.code.trim().toUpperCase();
  const supabase = createSupabaseServiceClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_code, status, payment_status, total_paise, created_at")
    .eq("order_code", code)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: items } = await supabase
    .from("order_items")
    .select("item_name, quantity, unit_price_paise")
    .eq("order_id", order.id);

  const { id, ...publicOrder } = order;

  return NextResponse.json({ order: publicOrder, items: items || [] });
}
