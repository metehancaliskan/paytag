/**
 * The Paytag mark: a price tag with an @ punched through it.
 *
 * The two halves are the product — a tag is the money waiting, an @ is the
 * person it is waiting for — so the mark says what the app does without a word
 * of copy. Both motifs recur in the interface: @ wherever an identity is shown,
 * the tag wherever escrow is.
 *
 * Every part is a path. A logo must not depend on a font: the `@` glyph is
 * drawn differently on macOS, Windows and Android, and a brand that changes
 * shape per platform is not a brand.
 *
 * Two cuts, on purpose:
 *   full  — the @ with its tail. Header, app icon, avatars. Needs ~24px+.
 *   tight — the @ reduced to its ring. 16–20px, where the tail turns to mush.
 *
 * Both cuts keep the punched hole: it is the one detail that makes the shape
 * read as a price tag instead of a shield, and it holds at 16px.
 */

type Props = {
  /** Side of the rounded badge, in pixels. */
  size?: number;
  className?: string;
  /** Drop the @'s tail. Default below 24px, since that is where it blurs. */
  tight?: boolean;
};

export default function Logo({ size = 32, className, tight }: Props) {
  const small = tight ?? size < 24;
  const radius = Math.round(size * 0.28);

  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--accent)",
        flex: "none",
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {/* the tag */}
        <path
          fill="#fff"
          d="M52 14h30a6 6 0 0 1 6 6v30a6 6 0 0 1-1.76 4.24L56.24 84.24a6 6 0 0 1-8.48 0L15.76 52.24a6 6 0 0 1 0-8.48L47.76 15.76A6 6 0 0 1 52 14Z"
        />
        {/* The punched hole. One dot is what makes it read as a *price tag*
            rather than a shield, and it survives all the way down to 16px. */}
        <circle cx="77" cy="25" r="4.5" fill="var(--accent)" />
        {small ? (
          <circle
            cx="50"
            cy="50"
            r="14"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="9"
          />
        ) : (
          <>
            <g
              fill="none"
              stroke="var(--accent)"
              strokeWidth="7.5"
              strokeLinecap="round"
            >
              <path d="M64.5 62.5a17 17 0 1 1 2-19.5" />
              <path d="M66.5 43v17c0 4 5 4.5 6.5 1.5" />
            </g>
            <circle cx="50" cy="50" r="6.5" fill="var(--accent)" />
          </>
        )}
      </svg>
    </span>
  );
}

/** Mark plus name, as it appears in both headers. */
export function Wordmark({ size = 32 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="text-lg font-bold tracking-tight">Paytag</span>
    </span>
  );
}
