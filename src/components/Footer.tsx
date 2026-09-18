import { FSSAI_NUMBER, KITCHEN_CITY, KITCHEN_NAME } from "@/lib/constants";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-mustard/30 bg-indigo px-6 py-8 text-cream">
      <div className="mx-auto max-w-4xl space-y-2 text-center text-sm">
        <p className="font-display text-lg text-mustard">{KITCHEN_NAME}</p>
        <p>Home-style Bihar / Mithila thalis, cooked fresh daily in {KITCHEN_CITY}.</p>
        <p className="text-cream/80">
          FSSAI Reg. No.: {FSSAI_NUMBER || "—"}
        </p>
        <p className="text-xs text-cream/60">
          &copy; {new Date().getFullYear()} {KITCHEN_NAME}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
