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
 * They are typographic marks in each asset's own colour, not the projects'
 * trademarked logos: a redrawn logo that is slightly wrong looks worse than an
 * honest glyph, and a payment screen is the wrong place to be approximate about
 * whose asset this is. The colours are hardcoded rather than themed because
 * they identify the asset, not the interface — USDC is that blue in both
 * themes, the way a bank card is the same colour in any light.
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
        // A four-pointed star: the shape lumens are written with, and the one
        // part of Stellar's mark that is a glyph rather than a logo.
        <svg
          viewBox="0 0 24 24"
          width={size * 0.56}
          height={size * 0.56}
          fill="currentColor"
        >
          <path d="M12 1.5c.5 4.6 1.4 6.9 3.4 8.6 1.7 1.4 3.9 1.9 7.1 2.4-4.6.5-6.9 1.4-8.6 3.4-1.4 1.7-1.9 3.9-2.4 7.1-.5-4.6-1.4-6.9-3.4-8.6-1.7-1.4-3.9-1.9-7.1-2.4 4.6-.5 6.9-1.4 8.6-3.4C11 7.4 11.5 5.2 12 1.5Z" />
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
