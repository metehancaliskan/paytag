"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition, type FormEvent } from "react";
import {
  KIND_SLUG,
  kindHint,
  kindMaxLength,
  kindUrlPrefix,
  normalizeHandle,
  type KindSlug,
} from "@/lib/identity";

const TABS: { slug: KindSlug; label: string; example: string }[] = [
  { slug: "gh", label: "GitHub", example: "torvalds" },
  { slug: "x", label: "X", example: "elonmusk" },
];

/**
 * Find a handle to pay.
 *
 * THE PLATFORM HAS NO DEFAULT, and that is the whole point of this component.
 * It used to start on GitHub. A bare username like `elonmusk` is valid under
 * both rulesets, so nothing rejected it — a donor who meant the X account and
 * did not notice the tab was sent to /p/gh/elonmusk and their money bound to
 * sha256(0x00 ‖ "elonmusk"), collectable by whoever holds that name on GitHub.
 * The tab was the load-bearing input on a money path and it looked like a
 * filter.
 *
 * So: nothing is selected until somebody selects it, and a pasted URL selects
 * it for them.
 */
export default function HandleSearch({
  showExamples = false,
}: {
  showExamples?: boolean;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState<KindSlug | null>(null);
  const [raw, setRaw] = useState("");
  // Errors stay quiet until the field has been left or submitted once.
  // Validating every keystroke from the first character means telling someone
  // their input is invalid while they are still typing it.
  const [touched, setTouched] = useState(false);
  const [pending, startTransition] = useTransition();

  const kind = slug === null ? null : KIND_SLUG[slug];
  const errorId = useId();
  const hintId = useId();

  /**
   * A pasted link answers the question by itself. `github.com/torvalds` can only
   * mean one platform, so asking after that would be pedantry — and it is the
   * paste, not the typing, that people do when they arrived from somewhere else.
   */
  function onType(value: string) {
    setRaw(value);
    const v = value.toLowerCase();
    if (/(^|\/\/|\.)github\.com\//.test(v)) setSlug("gh");
    else if (/(^|\/\/|\.)(x|twitter)\.com\//.test(v)) setSlug("x");
  }

  // One validation path for the live hint and for submit, so the two can never
  // disagree. Recomputed when the kind changes too: `elon-musk` is a valid
  // GitHub handle and an invalid X one.
  const { handle, problem } = useMemo(() => {
    if (raw.trim() === "" || kind === null) {
      return { handle: null, problem: null };
    }
    try {
      return { handle: normalizeHandle(raw, kind), problem: null };
    } catch (err) {
      return {
        handle: null,
        problem: err instanceof Error ? err.message : String(err),
      };
    }
  }, [raw, kind]);

  const showError = touched && problem !== null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    // Both, always: a handle with no platform is not a destination.
    if (!handle || slug === null) return;
    startTransition(() => router.push(`/p/${slug}/${handle}`));
  }

  return (
    <form onSubmit={onSubmit} className="w-full text-left">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="segmented" role="group" aria-label="Identity kind">
          {TABS.map((t) => (
            <button
              key={t.slug}
              type="button"
              aria-pressed={slug === t.slug}
              onClick={() => setSlug(t.slug)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {showExamples && slug !== null && (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setRaw(TABS.find((t) => t.slug === slug)!.example);
              setTouched(false);
            }}
          >
            try {TABS.find((t) => t.slug === slug)!.example}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div
          className="input-group flex-1"
          aria-invalid={showError ? "true" : undefined}
        >
          <span className="input-prefix">
            {kind === null ? "…/" : kindUrlPrefix(kind)}
          </span>
          <input
            className="input-bare"
            placeholder="username"
            value={raw}
            onBlur={() => setTouched(true)}
            onChange={(e) => onType(e.target.value)}
            maxLength={(kind === null ? 39 : kindMaxLength(kind)) + 24} // room for a pasted full URL
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={showError ? "true" : undefined}
            aria-describedby={showError ? errorId : hintId}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={raw.trim() === "" || slug === null || pending}
        >
          {pending && <span className="spinner" aria-hidden />}
          {pending ? "Opening…" : "Find"}
        </button>
      </div>

      {showError ? (
        <p id={errorId} role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      ) : (
        <p id={hintId} className="mt-2 text-xs text-mute">
          {slug === null ? (
            <>
              Pick the platform first — the same name can be two different
              people.
            </>
          ) : handle && handle !== raw.trim() ? (
            <>
              reads as <span className="mono text-dim">{handle}</span> — a
              full URL, an @ prefix or capitals all resolve to the same identity
            </>
          ) : (
            kindHint(kind!)
          )}
        </p>
      )}
    </form>
  );
}
