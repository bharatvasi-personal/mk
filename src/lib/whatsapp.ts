import type { OrderRow } from "@/lib/supabase/types";
import { formatRupees } from "@/lib/constants";

function orderSummaryText(order: OrderRow): string {
  return [
    `New order ${order.order_code}`,
    `${order.customer_name} · ${order.customer_phone}`,
    order.delivery_address,
    order.notes ? `Notes: ${order.notes}` : null,
    `Total: ${formatRupees(order.total_paise)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Sends the new-order notification to the kitchen's WhatsApp number.
 *
 * If WHATSAPP_CLOUD_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID are configured, uses
 * the official WhatsApp Business Cloud API. Otherwise returns a `wa.me` deep
 * link the caller can surface to staff (e.g. in the admin dashboard) so the
 * notification can be sent manually with one tap until the Cloud API app is
 * approved.
 */
export async function notifyKitchenOfNewOrder(
  order: OrderRow
): Promise<{ sent: boolean; waMeLink: string | null }> {
  const businessNumber = process.env.WHATSAPP_BUSINESS_NUMBER;
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const text = orderSummaryText(order);

  const waMeLink = businessNumber
    ? `https://wa.me/${businessNumber.replace(/[^\d]/g, "")}?text=${encodeURIComponent(text)}`
    : null;

  if (!token || !phoneNumberId || !businessNumber) {
    return { sent: false, waMeLink };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: businessNumber.replace(/[^\d]/g, ""),
          type: "text",
          text: { body: text },
        }),
      }
    );

    if (!res.ok) {
      console.error("WhatsApp Cloud API error", await res.text());
      return { sent: false, waMeLink };
    }
    return { sent: true, waMeLink };
  } catch (err) {
    console.error("WhatsApp Cloud API request failed", err);
    return { sent: false, waMeLink };
  }
}
