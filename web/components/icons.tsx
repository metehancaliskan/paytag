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
 * Each one is the real thing rather than a redrawing. Two attempts at
 * approximating Stellar's mark by hand — a four-pointed star, then arcs and
 * bars built to measured angles — both came out recognisably wrong, which is
 * the argument against approximating a logo at all: the eye knows before it
 * can say why. XLM and USDC are the published outlines; the lira is its own
 * currency symbol in a ring, which is what that mark is.
 *
 * Inline rather than fetched, like every other icon in this file: an inline
 * shape needs no second asset for dark mode and cannot fail to load beside a
 * number that means money.
 *
 * USDC brings its own blue disc, so it is drawn at full size with no chip
 * behind it. The other two sit on a coloured one — Stellar's own palette is
 * black and white, which disappears into one theme or the other, and the lira
 * has no colour of its own at all.
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
  if (asset === "USDC") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 32 32"
        width={size}
        height={size}
        className={`shrink-0 ${className}`}
      >
        {/* #2775CA is USDC's own blue, in both themes — it identifies the
            asset, not the interface, the way a bank card is the same colour
            in any light. */}
        <circle cx="16" cy="16" r="16" fill="#2775CA" />
        <g fill="#fff">
          <path d="M20.022 18.124c0-2.124-1.28-2.852-3.84-3.156-1.828-.243-2.193-.728-2.193-1.578 0-.85.61-1.396 1.828-1.396 1.097 0 1.707.364 2.011 1.275a.458.458 0 00.427.303h.975a.416.416 0 00.427-.425v-.06a3.04 3.04 0 00-2.743-2.489V9.142c0-.243-.183-.425-.487-.486h-.915c-.243 0-.426.182-.487.486v1.396c-1.829.242-2.986 1.456-2.986 2.974 0 2.002 1.218 2.791 3.778 3.095 1.707.303 2.255.668 2.255 1.639 0 .97-.853 1.638-2.011 1.638-1.585 0-2.133-.667-2.316-1.578-.06-.242-.244-.364-.427-.364h-1.036a.416.416 0 00-.426.425v.06c.243 1.518 1.219 2.61 3.23 2.914v1.457c0 .242.183.425.487.485h.915c.243 0 .426-.182.487-.485V21.34c1.829-.303 3.047-1.578 3.047-3.217z" />
          <path d="M12.892 24.497c-4.754-1.7-7.192-6.98-5.424-11.653.914-2.55 2.925-4.491 5.424-5.402.244-.121.365-.303.365-.607v-.85c0-.242-.121-.424-.365-.485-.061 0-.183 0-.244.06a10.895 10.895 0 00-7.13 13.717c1.096 3.4 3.717 6.01 7.13 7.102.244.121.488 0 .548-.243.061-.06.061-.122.061-.243v-.85c0-.182-.182-.424-.365-.546zm6.46-18.936c-.244-.122-.488 0-.548.242-.061.061-.061.122-.061.243v.85c0 .243.182.485.365.607 4.754 1.7 7.192 6.98 5.424 11.653-.914 2.55-2.925 4.491-5.424 5.402-.244.121-.365.303-.365.607v.85c0 .242.121.424.365.485.061 0 .183 0 .244-.06a10.895 10.895 0 007.13-13.717c-1.096-3.46-3.778-6.07-7.13-7.162z" />
        </g>
      </svg>
    );
  }

  const bg = asset === "XLM" ? "#38435c" : "#c8323f";

  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full ${className}`}
      style={{ width: size, height: size, background: bg, color: "#fff" }}
    >
      {asset === "XLM" ? (
        <svg
          viewBox="0 0 24 24"
          width={size * 0.66}
          height={size * 0.66}
          fill="currentColor"
        >
          <path d="M12.003 1.716c-1.37 0-2.7.27-3.948.78A10.18 10.18 0 0 0 2.66 7.901a10.136 10.136 0 0 0-.797 3.954c0 .258.01.516.027.775a1.942 1.942 0 0 1-1.055 1.88L0 14.934v1.902l2.463-1.26.072-.032v.005l.77-.39.758-.385.066-.039 14.807-7.56 1.666-.847 3.392-1.732V2.694L17.792 5.86 3.744 13.025l-.104.055-.017-.115a8.286 8.286 0 0 1-.071-1.105c0-2.255.88-4.377 2.474-5.977a8.462 8.462 0 0 1 2.71-1.82 8.513 8.513 0 0 1 3.2-.654h.067a8.41 8.41 0 0 1 4.09 1.055l1.628-.83.126-.066a10.11 10.11 0 0 0-5.845-1.853zM24 7.143 5.047 16.808l-1.666.847L0 19.382v1.902l3.282-1.671 2.91-1.485 14.058-7.153.105-.055.016.115c.05.369.072.743.072 1.11 0 2.255-.88 4.383-2.475 5.978a8.461 8.461 0 0 1-2.71 1.82 8.305 8.305 0 0 1-3.2.654h-.06c-1.441 0-2.86-.369-4.102-1.061l-.066.033-1.683.857c.594.418 1.232.776 1.903 1.062a10.11 10.11 0 0 0 3.947.797 10.09 10.09 0 0 0 7.17-2.975 10.136 10.136 0 0 0 2.969-7.18c0-.259-.005-.523-.027-.781a1.942 1.942 0 0 1 1.055-1.88L24 9.044z" />
        </svg>
      ) : (
        // The lira in a ring. The ring is a border rather than a drawn circle
        // so it stays one crisp pixel at every size the interface uses it at.
        <span
          className="grid place-items-center rounded-full border font-bold leading-none"
          style={{
            width: size * 0.8,
            height: size * 0.8,
            fontSize: size * 0.44,
            borderColor: "currentColor",
          }}
        >
          ₺
        </span>
      )}
    </span>
  );
}
