"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * A profile picture, or the initials when there isn't one.
 *
 * This exists because the two platforms fail differently and the page must not.
 * GitHub's avatar URL is derived from the handle and effectively always works.
 * The X one goes through a third party (see `avatarUrl` in lib/cards.ts) that is
 * rate limited per visitor and answers 404 when it cannot resolve the account —
 * so a missing picture is a normal Tuesday, not an error, and it has to land on
 * the initials rather than a browser's broken-image glyph.
 *
 * WHY THE FAILURE IS TRACKED BY URL and not as a boolean: this component is
 * reused across a list, and in the send flow the same instance is handed a new
 * handle when the reader checks another one. A bare `failed` flag would carry
 * one person's missing picture onto the next person's row — the same class of
 * bug as a form still pointed at the record it loaded a moment ago.
 */
export default function Avatar({
  src,
  handle,
  size = 44,
  className = "",
}: {
  /** null when the platform gives us no picture at all. */
  src: string | null;
  /** Used for the initials, and read out to nobody: the image is decorative. */
  handle: string;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);

  const box = `shrink-0 rounded-full border border-line ${className}`;

  if (!src || broken === src) {
    return (
      <span
        aria-hidden
        className={`grid place-items-center bg-raised font-bold text-mute ${box}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(11, Math.round(size * 0.3)),
        }}
      >
        {handle.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={box}
      style={{ width: size, height: size }}
      onError={() => setBroken(src)}
      unoptimized
    />
  );
}
