"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { useIdentity, identityList } from "./useIdentity";
import PersonCardView from "./PersonCard";
import CopyButton from "./CopyButton";
import { GithubMark, XMark } from "./icons";
import { KIND, kindLabel, kindUrlPrefix, slugOf } from "@/lib/identity";
import { parseLink, type PersonCard } from "@/lib/cards";
import {
  ECOSYSTEMS,
  HEADLINE_MAX,
  HEADLINE_MIN,
  MAX_ECOSYSTEMS,
  MAX_LINKS,
  ROLE_LIST,
  SUMMARY_MAX,
  SUMMARY_MIN,
  isRoleKey,
  type RoleKey,
} from "@/lib/roles";

type Loaded = {
  identityId: string;
  profileId: string;
  /** Null when this person has no card yet. */
  existing: {
    role: RoleKey | null;
    headline: string;
    summary: string;
    ecosystems: string[];
    links: string[];
    published: boolean;
  } | null;
};

/**
 * Where a developer or an amplifier writes what they do.
 *
 * The card is a shop window, nothing more: the money is bound to the handle's
 * identity key on chain, so a card cannot redirect a payment and losing one
 * costs nobody a cent. That is why this form writes with the reader's own
 * session and not the service role — row level security is enough here, and
 * the weaker credential is the correct one.
 *
 * Verification comes first (SPEC §2): the card hangs off a verified identity
 * row, which is what stops anyone from writing a page in someone else's name.
 */
export default function CardEditor() {
  const supabase = useMemo(() => browserSupabase(), []);
  const { identity } = useIdentity();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [role, setRole] = useState<RoleKey | null>(null);
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [ecosystems, setEcosystems] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>(["", "", ""]);
  const [published, setPublished] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // A card hangs off ONE identity (db/schema.sql: cards.identity_id), so a
  // person with both a GitHub and an X handle writes two cards — separate
  // texts, separate escrows. Which one is being edited is therefore a choice
  // the writer makes, not something inferred from an ordering.
  const mine = identityList(identity);
  const [pick, setPick] = useState(0);
  const chosen = mine[Math.min(pick, Math.max(mine.length - 1, 0))] ?? null;
  const handle = chosen?.handle ?? null;
  const kind = chosen?.kind ?? KIND.GithubUser;

  // Load the identity row and any card already on it. Both reads are ordinary
  // authenticated reads: `identities` is world readable, and RLS on `cards`
  // shows an unpublished card to its owner only.
  useEffect(() => {
    if (!supabase || !handle) return;
    let alive = true;

    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error("no session");

        const { data: id, error: idError } = await supabase
          .from("identities")
          .select("id")
          .eq("profile_id", auth.user.id)
          .eq("kind", kind)
          .maybeSingle();
        if (idError || !id?.id) throw idError ?? new Error("no identity");

        const { data: card } = await supabase
          .from("cards")
          .select("role, headline, summary, ecosystems, links, published")
          .eq("identity_id", id.id)
          .maybeSingle();

        if (!alive) return;

        const existing = card
          ? {
              role: isRoleKey(card.role) ? card.role : null,
              headline: typeof card.headline === "string" ? card.headline : "",
              summary: typeof card.summary === "string" ? card.summary : "",
              ecosystems: Array.isArray(card.ecosystems)
                ? card.ecosystems.filter((e): e is string => typeof e === "string")
                : [],
              links: Array.isArray(card.links)
                ? card.links
                    .map((l) => parseLink(l)?.url ?? "")
                    .filter((u) => u !== "")
                : [],
              published: card.published !== false,
            }
          : null;

        setLoaded({
          identityId: id.id as string,
          profileId: auth.user.id,
          existing,
        });

        // Also resets when there is no card for this identity: switching from a
        // filled GitHub card to an empty X one must not leave the old text in
        // the form and quietly save it under the other handle.
        setRole(existing?.role ?? null);
        setHeadline(existing?.headline ?? "");
        setSummary(existing?.summary ?? "");
        setEcosystems(existing?.ecosystems ?? []);
        setLinks([
          existing?.links[0] ?? "",
          existing?.links[1] ?? "",
          existing?.links[2] ?? "",
        ]);
        setPublished(existing?.published ?? true);
        setSavedAt(null);
      } catch {
        if (alive) setLoadFailed(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, [supabase, handle, kind]);

  const toggleEcosystem = useCallback((name: string) => {
    setEcosystems((current) =>
      current.includes(name)
        ? current.filter((e) => e !== name)
        : current.length >= MAX_ECOSYSTEMS
          ? current
          : [...current, name],
    );
  }, []);

  // Validation lives here rather than at submit time so the button can say why
  // it is disabled instead of failing after a click.
  const cleanLinks = links.map(parseLink).filter((l) => l !== null);
  const badLink = links.some((l) => l.trim() !== "" && parseLink(l) === null);
  const problem =
    role === null
      ? "Pick what you do."
      : headline.trim().length < HEADLINE_MIN
        ? "The headline is too short."
        : headline.trim().length > HEADLINE_MAX
          ? "The headline is too long."
          : summary.trim().length < SUMMARY_MIN
            ? `A couple more words — ${SUMMARY_MIN - summary.trim().length} to go.`
            : summary.trim().length > SUMMARY_MAX
              ? "The description is too long."
              : badLink
                ? "One of the links is not a full http(s) address."
                : null;

  const preview: PersonCard | null = handle
    ? {
        kind,
        handle,
        identityKey: "",
        displayName: null,
        role,
        headline: headline.trim() || null,
        summary: summary.trim() || null,
        ecosystems,
        links: cleanLinks.map((l) => l!),
        updatedAt: null,
        hasCard: true,
        linked: [],
      }
    : null;

  async function save() {
    if (!supabase || !loaded || problem) return;
    setError(null);
    setBusy(true);
    try {
      const { error: e } = await supabase.from("cards").upsert(
        {
          identity_id: loaded.identityId,
          profile_id: loaded.profileId,
          role,
          headline: headline.trim(),
          summary: summary.trim(),
          ecosystems,
          links: cleanLinks.map((l) => ({ url: l!.url })),
          published,
        },
        { onConflict: "identity_id" },
      );
      if (e) throw new Error(e.message);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------ gates first

  if (identity.status === "off") {
    return (
      <p className="card p-5 text-sm text-mute">
        No Supabase project is configured here, so cards cannot be written. See{" "}
        <span className="mono">docs/SETUP-AUTH.md</span>.
      </p>
    );
  }

  if (identity.status === "loading") {
    return <div className="skeleton h-48 w-full" />;
  }

  if (identity.status === "anon") {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-bold">Connect an account first</h2>
        <p className="mt-1.5 text-sm text-mute">
          A card hangs off a verified handle. That is what stops anyone from
          writing a page in your name — and it is one click.
        </p>
        <Link className="btn btn-primary mt-4" href="/connect">
          <GithubMark size={16} />
          Connect GitHub or X
        </Link>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <p role="alert" className="card p-5 text-sm text-danger">
        Could not read your card. Reload the page — nothing was changed.
      </p>
    );
  }

  // -------------------------------------------------------------- the form

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-start">
      <div className="space-y-4">
        {mine.length > 1 && (
          <section className="card flex flex-wrap items-center gap-3 p-4">
            <span className="menu-label">Card for</span>
            <div className="segmented">
              {mine.map((v, i) => (
                <button
                  key={v.identityHex}
                  aria-pressed={v.identityHex === chosen?.identityHex}
                  onClick={() => setPick(i)}
                >
                  {v.kind === KIND.XUser ? (
                    <XMark size={12} className="mr-1 inline align-[-1px]" />
                  ) : (
                    <GithubMark size={12} className="mr-1 inline align-[-1px]" />
                  )}
                  @{v.handle}
                </button>
              ))}
            </div>
            <span className="text-xs text-mute">
              Each identity keeps its own card and its own escrow.
            </span>
          </section>
        )}

        {/* ------------------------------------------------------- role */}
        <section className="card p-5">
          <h2 className="font-semibold">What do you do?</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ROLE_LIST.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={role === r.key}
                onClick={() => setRole(r.key)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  role === r.key
                    ? "border-accent bg-raised"
                    : "border-line hover:border-line-strong"
                }`}
              >
                <span className="block font-semibold">{r.pick}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-mute">
                  {r.blurb}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------- the words */}
        <section className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="headline">
              One line about your work
            </label>
            <input
              id="headline"
              className="field"
              value={headline}
              maxLength={HEADLINE_MAX}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Soroban contracts and the tooling around them"
            />
            <p className="mt-1 text-right text-xs text-mute">
              <span className="num">{headline.trim().length}</span>/
              {HEADLINE_MAX}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="summary">
              What have you actually shipped?
            </label>
            <textarea
              id="summary"
              className="field min-h-28"
              value={summary}
              maxLength={SUMMARY_MAX}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Two or three sentences. Concrete beats broad: what you built, where it runs, what it saved someone."
            />
            <p className="mt-1 text-right text-xs text-mute">
              <span className="num">{summary.trim().length}</span>/{SUMMARY_MAX}
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------- the tags */}
        <section className="card p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">Where you work</h2>
            <span className="text-xs text-mute">
              up to <span className="num">{MAX_ECOSYSTEMS}</span>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {ECOSYSTEMS.map((e) => {
              const on = ecosystems.includes(e);
              return (
                <button
                  key={e}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleEcosystem(e)}
                  disabled={!on && ecosystems.length >= MAX_ECOSYSTEMS}
                  className={`rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors disabled:opacity-40 ${
                    on
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line text-mute hover:border-line-strong hover:text-text"
                  }`}
                >
                  {e}
                </button>
              );
            })}
          </div>
        </section>

        {/* --------------------------------------------------- the links */}
        <section className="card p-5">
          <h2 className="font-semibold">
            Links{" "}
            <span className="font-normal text-mute">
              — optional, up to {MAX_LINKS}
            </span>
          </h2>
          <div className="mt-3 space-y-2">
            {links.map((value, i) => {
              const invalid = value.trim() !== "" && parseLink(value) === null;
              return (
                <input
                  key={i}
                  className="field"
                  value={value}
                  inputMode="url"
                  aria-invalid={invalid || undefined}
                  aria-label={`Link ${i + 1}`}
                  onChange={(e) =>
                    setLinks((cur) =>
                      cur.map((v, j) => (j === i ? e.target.value : v)),
                    )
                  }
                  placeholder={
                    i === 0
                      ? "https://github.com/you/your-project"
                      : "https://…"
                  }
                />
              );
            })}
          </div>
        </section>

        {/* -------------------------------------------------------- save */}
        <section className="card p-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-semibold">Show me in the directory</span>
              <span className="mt-0.5 block text-xs text-mute">
                Off keeps it a draft. Your handle stays payable either way.
              </span>
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="btn btn-primary btn-lg"
              onClick={save}
              disabled={busy || problem !== null}
            >
              {busy && <span className="spinner" aria-hidden />}
              {busy
                ? "Saving…"
                : loaded?.existing
                  ? "Save changes"
                  : "Publish my card"}
            </button>
            <span className="text-sm text-mute">{problem}</span>
          </div>

          {savedAt !== null && (
            <div
              aria-live="polite"
              className="mt-4 border-t border-line pt-4 text-sm"
            >
              <p className="font-semibold text-accent-text">
                {published ? "Your card is live." : "Draft saved."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Link
                  className="btn btn-ghost btn-sm"
                  href={`/p/${slugOf(kind)}/${handle}`}
                >
                  View my page
                </Link>
                {published && (
                  <Link className="btn btn-ghost btn-sm" href="/app">
                    See the directory
                  </Link>
                )}
                <CopyButton
                  value={
                    typeof window === "undefined"
                      ? `/p/${slugOf(kind)}/${handle}`
                      : `${window.location.origin}/p/${slugOf(kind)}/${handle}`
                  }
                  label="Copy my link"
                  className="btn btn-quiet btn-sm"
                />
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </section>
      </div>

      {/* ----------------------------------------------------- preview */}
      <aside className="space-y-2 lg:sticky lg:top-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-mute">
          How people will see you
        </p>
        {preview && <PersonCardView card={preview} preview />}
        <p className="text-xs leading-relaxed text-mute">
          {kindUrlPrefix(kind)}
          {handle} is the {kindLabel(kind)} tag money is bound to. The card only
          describes it.
        </p>
      </aside>
    </div>
  );
}
