import AdminNav from "@/components/AdminNav";

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </div>
  );
}
