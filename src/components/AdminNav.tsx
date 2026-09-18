"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `px-3 py-2 text-sm font-semibold rounded-full ${
      pathname === href ? "bg-maroon text-cream" : "text-indigo hover:bg-mustard/10"
    }`;

  return (
    <nav className="flex items-center justify-between border-b border-mustard/30 bg-white px-4 py-3">
      <div className="flex gap-2">
        <Link href="/admin" className={linkClass("/admin")}>
          Dashboard
        </Link>
        <Link href="/delivery" className={linkClass("/delivery")}>
          Delivery
        </Link>
      </div>
      <button onClick={handleSignOut} className="text-sm font-semibold text-maroon">
        Sign out
      </button>
    </nav>
  );
}
