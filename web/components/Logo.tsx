import Image from "next/image";
import mark from "@/public/paytag-mark.png";

/**
 * The Paytag mark.
 *
 * It used to be drawn here as SVG paths, tuned per size. It is now a single
 * raster tile — `public/paytag-mark.png`, cut from the 4096px master in
 * `brand/` — because the brand asset is the artwork, and a hand-drawn
 * approximation of it in code would drift from it the first time either changed.
 *
 * What that trades away, stated rather than discovered later:
 *
 * - **No per-size cut.** The SVG had a `tight` variant that dropped the @'s tail
 *   below 24px. A raster cannot do that, so the framing is the compromise: the
 *   master carries ~21% padding on every side, which is right for an iOS app
 *   icon and far too much at 16px, so the header mark and the favicon are cut
 *   from a tighter crop of the same art (12% margin). The tab and the header
 *   then read as the same logo, which they did not with the master's framing.
 * - **The colour no longer follows `--accent`.** The tile carries its own green
 *   (#248 25e-ish, close to but not identical to the token). Changing the accent
 *   token will not change the mark; the master has to be re-exported.
 * - **One tile for both themes.** The artwork has a filled background, so it
 *   needs no light/dark variant — it sits on either page colour unchanged.
 *
 * The rounded corner is applied here rather than baked in, so the same square
 * tile can serve as an app icon (where the platform masks it) and as an inline
 * mark (where it needs the product's own radius).
 */

type Props = {
  /** Side of the rounded tile, in pixels. */
  size?: number;
  className?: string;
};

export default function Logo({ size = 32, className }: Props) {
  return (
    <Image
      src={mark}
      alt=""
      aria-hidden
      width={size}
      height={size}
      // 96px of art for a 30px mark: enough for a 3× screen. Not `unoptimized`
      // like the remote avatars — this one is a local static import, so Next
      // knows its dimensions and can serve a resized copy.
      sizes={`${size}px`}
      priority
      className={className}
      style={{
        // 28% of the side, the same rule the drawn badge used, so the mark keeps
        // its shape relationship with cards and buttons at every size.
        borderRadius: Math.round(size * 0.28),
        flex: "none",
      }}
    />
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
