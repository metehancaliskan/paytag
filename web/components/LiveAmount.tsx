"use client";

import { useState } from "react";
import { changedFrom } from "@/lib/blend/rewards";

/**
 * A number that shows its own movement.
 *
 * The reward this draws changes about twice a second, and a figure that
 * changes without any sign of changing reads as a rendering glitch — you
 * notice the digits are different from a moment ago and distrust both
 * readings. So the digits that turned over light up briefly and settle.
 *
 * Only the digits that MOVED animate. Flashing the whole figure on every
 * frame would be a strobe, and the eye stops reading a number that never sits
 * still; lighting the tail draws attention to exactly the thing that is
 * happening — money arriving, one stroop at a time.
 */
export default function LiveAmount({
  value,
  className = "",
}: {
  /** Already formatted. This component animates characters, not amounts. */
  value: string;
  className?: string;
}) {
  // Derived during render rather than in an effect, deliberately. An effect
  // would run AFTER the digits had already been drawn, restart their keys a
  // frame later, and cut the animation off at its first frame every time.
  const [shown, setShown] = useState(value);
  const [from, setFrom] = useState(value.length);
  const [generation, setGeneration] = useState(0);

  if (shown !== value) {
    setShown(value);
    setFrom(changedFrom(shown, value));
    setGeneration((g) => g + 1);
  }

  return (
    <span className={className}>
      {value.split("").map((char, i) => (
        <span
          // The generation is part of the key only for the characters that
          // moved: remounting a digit is what restarts its animation, and
          // remounting the ones that did not move would animate the whole
          // figure on every frame.
          key={i >= from ? `${i}-${generation}` : `${i}-still`}
          className={i >= from ? "digit-tick" : undefined}
        >
          {char}
        </span>
      ))}
    </span>
  );
}
