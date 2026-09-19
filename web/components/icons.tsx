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
        // Stellar's actual mark, not a redrawing of it. Two attempts at
        // approximating this shape by hand — a four-pointed star, then arcs
        // and bars built to measured angles — both came out recognisably
        // wrong, which is the whole argument against approximating a logo: the
        // eye knows it before it can say why.
        //
        // The path is the official outline as published in Simple Icons (the
        // icon files there are CC0; the mark itself is Stellar's, used here to
        // identify Stellar's own asset, which is what a trademark is for).
        <svg
          viewBox="0 0 24 24"
          width={size * 0.66}
          height={size * 0.66}
          fill="currentColor"
        >
          <path d="M12.003 1.716c-1.37 0-2.7.27-3.948.78A10.18 10.18 0 0 0 2.66 7.901a10.136 10.136 0 0 0-.797 3.954c0 .258.01.516.027.775a1.942 1.942 0 0 1-1.055 1.88L0 14.934v1.902l2.463-1.26.072-.032v.005l.77-.39.758-.385.066-.039 14.807-7.56 1.666-.847 3.392-1.732V2.694L17.792 5.86 3.744 13.025l-.104.055-.017-.115a8.286 8.286 0 0 1-.071-1.105c0-2.255.88-4.377 2.474-5.977a8.462 8.462 0 0 1 2.71-1.82 8.513 8.513 0 0 1 3.2-.654h.067a8.41 8.41 0 0 1 4.09 1.055l1.628-.83.126-.066a10.11 10.11 0 0 0-5.845-1.853zM24 7.143 5.047 16.808l-1.666.847L0 19.382v1.902l3.282-1.671 2.91-1.485 14.058-7.153.105-.055.016.115c.05.369.072.743.072 1.11 0 2.255-.88 4.383-2.475 5.978a8.461 8.461 0 0 1-2.71 1.82 8.305 8.305 0 0 1-3.2.654h-.06c-1.441 0-2.86-.369-4.102-1.061l-.066.033-1.683.857c.594.418 1.232.776 1.903 1.062a10.11 10.11 0 0 0 3.947.797 10.09 10.09 0 0 0 7.17-2.975 10.136 10.136 0 0 0 2.969-7.18c0-.259-.005-.523-.027-.781a1.942 1.942 0 0 1 1.055-1.88L24 9.044z" />
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
