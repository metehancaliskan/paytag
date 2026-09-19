/**
 * The two or three marks the interface actually needs, inlined.
 *
 * No icon package: three shapes are not worth a dependency, and an inline
 * `currentColor` path is the only version that follows the theme tokens without
 * a second asset per theme.
 */

type IconProps = { className?: string; size?: number };

export function GithubMark({ className, size = 18 }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.07-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function XMark({ className, size = 16 }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function ChevronRight({ className, size = 14 }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronDown({ className, size = 14 }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Settings. Sliders rather than a gear: two strokes and two knobs carry the
 * meaning at 16px, where a gear's teeth turn into a grey blob.
 */
export function Sliders({ className, size = 17 }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <path d="M3 8h4M13 8h8M3 16h8M17 16h4" />
      <circle cx="10" cy="8" r="2.6" />
      <circle cx="14" cy="16" r="2.6" />
    </svg>
  );
}

export function CheckMark({ className, size = 12 }: IconProps) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

/**
 * The mark beside an amount: XLM, USDC, or Turkish lira.
 *
 * Drawn here rather than fetched, for the same reason as every other icon in
 * this file — an inline shape follows the theme, needs no second asset for dark
 * mode, and cannot fail to load beside a number that means money.
 *
 * XLM is Stellar's own mark — the ring cut by two bars — drawn to its actual
 * geometry rather than approximated: a payment screen is the wrong place to be
 * vague about whose asset this is, and the first version of this file used a
 * four-pointed star that is not Stellar's logo at all. The dollar and lira are
 * currency glyphs, which is what those two currencies are identified by.
 *
 * The colours are hardcoded rather than themed because they identify the asset,
 * not the interface — USDC is that blue in both themes, the way a bank card is
 * the same colour in any light.
 */
export function AssetMark({
  asset,
  size = 26,
  className = "",
}: {
  asset: "XLM" | "USDC" | "TRY";
  size?: number;
  className?: string;
}) {
  const skin = {
    // Stellar's own palette is black and white, which disappears into one
    // theme or the other; this slate keeps the mark legible in both.
    XLM: { bg: "#38435c", fg: "#ffffff" },
    USDC: { bg: "#2775ca", fg: "#ffffff" },
    TRY: { bg: "#c8323f", fg: "#ffffff" },
  }[asset];

  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: skin.bg,
        color: skin.fg,
      }}
    >
      {asset === "XLM" ? (
        // Stellar's mark: a ring with two parallel bars cut through it, the
        // whole thing tilted. Built from four stroked arcs and two bars rather
        // than one traced path — the arcs stop exactly where the bars pass, and
        // the two small nubs left at the sides are part of the shape, not a
        // rendering accident.
        <svg
          viewBox="0 0 24 24"
          width={size * 0.62}
          height={size * 0.62}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <g transform="rotate(-27 12 12)">
            {/* over the top */}
            <path d="M4.76 5.85A9.5 9.5 0 0 1 19.24 5.85" />
            {/* under the bottom */}
            <path d="M19.24 18.15A9.5 9.5 0 0 1 4.76 18.15" />
            {/* the two nubs the bars leave behind, left and right */}
            <path d="M21.44 10.95A9.5 9.5 0 0 1 21.44 13.05" />
            <path d="M2.56 13.05A9.5 9.5 0 0 1 2.56 10.95" />
            <rect x="-6" y="6.95" width="36" height="2.9" fill="currentColor" stroke="none" />
            <rect x="-6" y="14.15" width="36" height="2.9" fill="currentColor" stroke="none" />
          </g>
        </svg>
      ) : (
        <span
          className="font-bold leading-none"
          style={{ fontSize: size * 0.52 }}
        >
          {asset === "USDC" ? "$" : "₺"}
        </span>
      )}
    </span>
  );
}
