"use client";

import { useEffect, useState } from "react";

/**
 * Copy-to-clipboard with a confirmation that decays on its own.
 *
 * Addresses, identity keys and transaction hashes all need to be moved into a
 * wallet, an explorer or a chat window. Selecting 64 characters of hex by hand
 * is the kind of thing that fails silently and expensively.
 */
export default function CopyButton({
  value,
  label = "Copy",
  className = "btn btn-quiet",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      // navigator.clipboard is unavailable on insecure origins and in a few
      // embedded browsers; say so instead of appearing to have worked.
      await navigator.clipboard.writeText(value);
      setState("done");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={className}
      aria-live="polite"
      title={`Copy ${value.length > 24 ? `${value.slice(0, 10)}…` : value}`}
    >
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
