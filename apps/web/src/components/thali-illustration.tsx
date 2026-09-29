/**
 * A thali, drawn.
 *
 * This is illustration, not photography, and that is a deliberate interim choice rather
 * than a placeholder: a food site with no imagery at all converts badly, and bad stock
 * photography of someone else's food is worse than honest drawing for a brand whose
 * whole claim is "this is actually home food".
 *
 * Replace it with real photographs of the real thali as soon as there is one to
 * photograph — ideally the week the kitchen starts test cooking. Until then this reads
 * as designed rather than as something missing.
 */
export function ThaliIllustration({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 320"
      className={className}
      role="img"
      aria-label="A steel thali with rice, dal, two vegetables, roti, salad and pickle"
    >
      <defs>
        <radialGradient id="plate" cx="38%" cy="32%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#eeece8" />
          <stop offset="100%" stopColor="#ddd9d2" />
        </radialGradient>
        <radialGradient id="katori" cx="38%" cy="30%">
          <stop offset="0%" stopColor="#f7f6f4" />
          <stop offset="100%" stopColor="#ddd9d2" />
        </radialGradient>
      </defs>

      {/* The steel plate */}
      <circle cx="160" cy="160" r="150" fill="url(#plate)" />
      <circle cx="160" cy="160" r="150" fill="none" stroke="#a39c91" strokeWidth="2" opacity="0.5" />
      <circle cx="160" cy="160" r="136" fill="none" stroke="#a39c91" strokeWidth="1" opacity="0.35" />

      {/* Rice, centre-left — the mound everything else is eaten with */}
      <ellipse cx="128" cy="178" rx="52" ry="44" fill="#fdf6ed" />
      <ellipse cx="128" cy="172" rx="44" ry="36" fill="#ffffff" opacity="0.85" />

      {/* Dal */}
      <circle cx="222" cy="96" r="38" fill="url(#katori)" />
      <circle cx="222" cy="96" r="31" fill="#e6a95f" />
      <circle cx="214" cy="88" r="7" fill="#f0cb98" opacity="0.7" />

      {/* Seasonal vegetable */}
      <circle cx="252" cy="178" r="34" fill="url(#katori)" />
      <circle cx="252" cy="178" r="27" fill="#4b7f52" />
      <circle cx="246" cy="171" r="5" fill="#7aa87f" opacity="0.8" />

      {/* Saag */}
      <circle cx="206" cy="246" r="30" fill="url(#katori)" />
      <circle cx="206" cy="246" r="23" fill="#3b6742" />

      {/* Roti, top-left, slightly overlapping the rim the way it always does */}
      <ellipse cx="96" cy="86" rx="50" ry="42" fill="#f8e7cd" />
      <ellipse cx="96" cy="86" rx="50" ry="42" fill="none" stroke="#e6a95f" strokeWidth="1.5" opacity="0.6" />
      <circle cx="82" cy="76" r="4" fill="#dd8c38" opacity="0.5" />
      <circle cx="108" cy="94" r="3" fill="#dd8c38" opacity="0.4" />
      <circle cx="96" cy="66" r="2.5" fill="#dd8c38" opacity="0.35" />

      {/* Salad and pickle, bottom-left */}
      <circle cx="84" cy="248" r="26" fill="url(#katori)" />
      <circle cx="76" cy="244" r="8" fill="#c96f1d" opacity="0.85" />
      <circle cx="92" cy="252" r="7" fill="#4b7f52" opacity="0.8" />
      <circle cx="88" cy="238" r="6" fill="#f0cb98" />

      {/* Papad */}
      <ellipse cx="160" cy="58" rx="30" ry="12" fill="#f0cb98" opacity="0.9" />
    </svg>
  );
}

/**
 * A small motif used on menu cards in place of a photograph.
 *
 * Derived from the dish name so the same dish always gets the same mark — which makes a
 * long menu feel deliberate rather than randomly decorated, and gives the eye something
 * to navigate by when scanning for the item ordered last time.
 */
export function DishMark({ seed, foodType }: { seed: string; foodType: string }) {
  const hash = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const palette =
    foodType === 'NON_VEG'
      ? ['#853f16', '#a85516', '#dd8c38']
      : foodType === 'EGG'
        ? ['#a85516', '#dd8c38', '#f0cb98']
        : ['#3b6742', '#4b7f52', '#e6a95f'];

  return (
    <svg viewBox="0 0 64 64" className="h-12 w-12 shrink-0" aria-hidden>
      <circle cx="32" cy="32" r="30" fill="#f7f6f4" />
      <circle cx="32" cy="32" r="22" fill={palette[0]} opacity="0.12" />
      <circle cx={32 + Math.cos(hash) * 9} cy={32 + Math.sin(hash) * 9} r="9" fill={palette[0]} opacity="0.85" />
      <circle cx={32 + Math.cos(hash + 2.1) * 9} cy={32 + Math.sin(hash + 2.1) * 9} r="7" fill={palette[1]} opacity="0.8" />
      <circle cx={32 + Math.cos(hash + 4.2) * 9} cy={32 + Math.sin(hash + 4.2) * 9} r="6" fill={palette[2]} opacity="0.8" />
    </svg>
  );
}
