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

export default function HandleSearch({
  big = false,
  showExamples = false,
}: {
  big?: boolean;
  showExamples?: boolean;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState<KindSlug>("gh");
  const [raw, setRaw] = useState("");
  // Errors stay quiet until the field has been left or submitted once.
  // Validating every keystroke from the first character means telling someone
  // their input is invalid while they are still typing it.
  const [touched, setTouched] = useState(false);
  const [pending, startTransition] = useTransition();

  const kind = KIND_SLUG[slug];
  const errorId = useId();
  const hintId = useId();

  // One validation path for the live hint and for submit, so the two can never
  // disagree. Recomputed when the kind changes too: `elon-musk` is a valid
  // GitHub handle and an invalid X one.
  const { handle, problem } = useMemo(() => {
    if (raw.trim() === "") return { handle: null, problem: null };
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
    if (!handle) return;
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

        {showExamples && (
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
          <span className="input-prefix">{kindUrlPrefix(kind)}</span>
          <input
            className={`input-bare ${big ? "py-3.5 text-base" : ""}`}
            placeholder="username"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => setTouched(true)}
            maxLength={kindMaxLength(kind) + 24} // room for a pasted full URL
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={showError ? "true" : undefined}
            aria-describedby={showError ? errorId : hintId}
          />
        </div>
        <button
          type="submit"
          className={`btn btn-primary ${big ? "btn-lg" : ""}`}
          disabled={raw.trim() === "" || pending}
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
          {handle && handle !== raw.trim() ? (
            <>
              reads as <span className="mono text-dim">{handle}</span> — a
              full URL, an @ prefix or capitals all resolve to the same identity
            </>
          ) : (
            kindHint(kind)
          )}
        </p>
      )}
    </form>
  );
}
