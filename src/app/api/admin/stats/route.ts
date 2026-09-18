import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/requireAdmin";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createSupabaseServiceClient();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data: todaysOrders, error } = await service
    .from("orders")
    .select("total_paise, payment_status, created_at")
    .gte("created_at", startOfDay.toISOString());

  if (error) {
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }

  const paidOrders = (todaysOrders || []).filter((o: any) => o.payment_status === "paid");
  const issueOrders = (todaysOrders || []).filter((o: any) => o.payment_status !== "paid");
  const revenuePaise = paidOrders.reduce((sum: number, o: any) => sum + o.total_paise, 0);

  return NextResponse.json({
    orderCount: paidOrders.length,
    issueCount: issueOrders.length,
    revenuePaise,
  });
}
