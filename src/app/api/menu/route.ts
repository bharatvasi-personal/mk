import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const revalidate = 0;

export async function GET() {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load menu" }, { status: 500 });
  }

  return NextResponse.json({ items: data });
}
