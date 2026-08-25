"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { useIdentity, identityList } from "./useIdentity";
import { PROVIDERS } from "./providers";
import PersonCardView from "./PersonCard";
import PublishedDialog from "./PublishedDialog";
import {
  KIND,
  kindLabel,
  kindUrlPrefix,
  slugOf,
  type IdentityKind,
} from "@/lib/identity";
import { parseLink, type PersonCard } from "@/lib/cards";
import { describeWriteError } from "@/lib/db-errors";
import { describeAuthError } from "@/lib/auth-errors";
import { X_ENABLED } from "@/lib/config";
import {
  ECOSYSTEMS,
  MAX_LINKS,
  HEADLINE_MAX,
  HEADLINE_MIN,
  MAX_ECOSYSTEMS,
  ROLES,
  SUMMARY_MAX,
  SUMMARY_MIN,
  roleForKind,
} from "@/lib/roles";

type Loaded = {
  identityId: string;
  profileId: string;
  /** Null when this person has no card yet. */
  existing: {
    headline: string;
    summary: string;
    ecosystems: string[];
    links: string[];
    published: boolean;
  } | null;
};

/**
 * Where a developer or a community contributor writes what they do.
 *
 * The card is a shop window, nothing more: the money is bound to the handle's
 * identity key on chain, so a card cannot redirect a payment and losing one
 * costs nobody a cent. That is why this form writes with the reader's own
 * session and not the service role — row level security is enough here, and
 * the weaker credential is the correct one.
 *
 * Verification comes first (SPEC §2), and it is enforced PER PLATFORM, here, as
 * question one. A card for x.com/you needs the X account signed in; a card for
 * github.com/you needs GitHub. Neither stands in for the other, because the two
 * are separate identities holding separate escrows — and the same name on the
 * two platforms may well be two different people (SPEC §8.4b).
 *
 * So both providers are always on screen, verified or not, and choosing the one
 * you have not proven yet replaces the form with a single Connect row instead of
 * sending you to Settings and hoping you find your way back. The return path
 * carries the choice (`?for=gh|x`), so OAuth lands on this page with question
 * one already answered.
 */
export default function CardEditor({
  hintKind,
  authError,
}: {
  /** Which platform to open on, from `?for=gh|x`. */
  hintKind?: IdentityKind | null;
  authError?: string;
}) {
  const supabase = useMemo(() => browserSupabase(), []);
  const { identity, error: authProblem, signIn } = useIdentity();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [ecosystems, setEcosystems] = useState<string[]>([]);
  // One input per allowed link, derived rather than typed out: the limit is
  // MAX_LINKS in one place, and a form with a different number of boxes than the
  // validator allows is a bug waiting for someone to raise the limit.
  const [links, setLinks] = useState<string[]>(() =>
    Array.from({ length: MAX_LINKS }, () => ""),
  );
  const [published, setPublished] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two flags, not one. `saved` opens the dialog and closing it puts that back
  // to false; `everSaved` is what leaves a quiet line behind afterwards, so a
  // dismissed dialog does not erase the only evidence that the save happened.
  const [saved, setSaved] = useState(false);
  const [everSaved, setEverSaved] = useState(false);

  // A card hangs off ONE identity (db/schema.sql: cards.identity_id), so a
  // person with both a GitHub and an X handle writes two cards — separate
  // texts, separate escrows. Which one is being written is therefore a choice
  // the writer makes, not something inferred from an ordering.
  //
  // Held as "the platform", not "the verified identity at index n": the choice
  // has to be expressible before the identity exists, since making it is what
  // triggers the sign-in.
  const mine = identityList(identity);
  const [picked, setPicked] = useState<IdentityKind | null>(null);
  const kind: IdentityKind =
    picked ?? hintKind ?? mine[0]?.kind ?? KIND.GithubUser;
  const chosen = mine.find((v) => v.kind === kind) ?? null;
  const handle = chosen?.handle ?? null;
  // Not asked, derived. Signing in with GitHub already said "I build"; asking
  // it again is a question with one answer. `lib/roles.ts` holds the rule.
  const role = ROLES[roleForKind(kind)];

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
          .select("headline, summary, ecosystems, links, published")
          .eq("identity_id", id.id)
          .maybeSingle();

        if (!alive) return;

        const existing = card
          ? {
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
        setHeadline(existing?.headline ?? "");
        setSummary(existing?.summary ?? "");
        setEcosystems(existing?.ecosystems ?? []);
        setLinks(
          Array.from({ length: MAX_LINKS }, (_, i) => existing?.links[i] ?? ""),
        );
        setPublished(existing?.published ?? true);
        setSaved(false);
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
    headline.trim().length < HEADLINE_MIN
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
        role: role.key,
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
    // `chosen` in the guard as well as `loaded`: the form only renders for a
    // verified platform, and the write must be impossible without one even if
    // some future render forgets that.
    if (!supabase || !loaded || !chosen || problem) return;
    setError(null);
    setBusy(true);
    try {
      const { error: e } = await supabase.from("cards").upsert(
        {
          identity_id: loaded.identityId,
          profile_id: loaded.profileId,
          role: role.key,
          headline: headline.trim(),
          summary: summary.trim(),
          ecosystems,
          links: cleanLinks.map((l) => ({ url: l!.url })),
          published,
        },
        { onConflict: "identity_id" },
      );
      if (e) throw new Error(e.message);
      setSaved(true);
      setEverSaved(true);
    } catch (e) {
      setError(describeWriteError(e));
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

  // There is no separate "you are signed out" screen any more. Signed out is
  // just the state where neither platform is verified yet, and the picker below
  // already says so on both rows — one screen instead of two, and the reader
  // chooses which handle they are here for before signing in rather than after.

  if (loadFailed) {
    return (
      <p role="alert" className="card p-5 text-sm text-danger">
        Could not read your card. Reload the page — nothing was changed.
      </p>
    );
  }

  // -------------------------------------------------------------- the form
  //
  // ONE card, and the whole of it fits on a phone screen: the handle, three
  // numbered questions, an optional disclosure, and the button. It was five
  // separate panels, which made a two-minute form look like a registration
  // process — and buried the two fields that are actually required among three
  // that are not.

  const provider = PROVIDERS.find((p) => p.kind === kind) ?? PROVIDERS[0];
  const usable = provider.key !== "x" || X_ENABLED;
  const authMessage = authProblem ?? describeAuthError(authError);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:items-start">
      <div className="card divide-y divide-line">
        {/* -------------------------------------------------- 1 the handle
            First, because it decides everything under it: which escrow the
            card advertises, which page it becomes, and — when the platform is
            not verified yet — whether there is a form at all. */}
        <fieldset className="p-5">
          <legend className="label">
            <Step n={1} /> Which handle is this card for?
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map((p) => {
              const v = mine.find((m) => m.kind === p.kind) ?? null;
              const on = p.kind === kind;
              const allowed = p.key !== "x" || X_ENABLED;
              const implied = ROLES[roleForKind(p.kind)];
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={on}
                  disabled={!allowed}
                  title={allowed ? undefined : "Not enabled on this deployment yet"}
                  onClick={() => setPicked(p.kind)}
                  className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-40 ${
                    on
                      ? "border-accent bg-raised"
                      : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {p.icon}
                    {/* The domain, so the row reads the same shape before and
                        after verification: `x.com` becomes `x.com/you`. */}
                    <span className="mono truncate text-sm font-semibold">
                      {p.domain}
                      {v ? `/${v.handle}` : ""}
                    </span>
                  </span>
                  {/* The role the platform implies, on the tile that chooses
                      it. The form no longer asks, so this is where the reader
                      finds out how they will be listed — before they write a
                      word, not after they publish. */}
                  <span className="mt-0.5 block text-xs text-mute">
                    <span className="font-semibold text-dim">
                      {implied.label}
                    </span>{" "}
                    ·{" "}
                    {!allowed
                      ? "not enabled here"
                      : v
                        ? "verified"
                        : "needs signing in"}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-mute">
                    {implied.blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {chosen === null ? (
          /* ------------------------------------------------ the hard stop
             The card describes a handle people send money to, so it cannot be
             written by somebody who has not proven they hold it. This is that
             rule, at the moment it applies, in one row. */
          <div className="p-5">
            <p className="font-semibold">
              Sign in with {kindLabel(kind)} to write this card.
            </p>
            <p className="mt-1 text-sm text-mute">
              {mine.length > 0 ? (
                <>
                  It adds {provider.domain} to this account —{" "}
                  <span className="mono">
                    {kindUrlPrefix(mine[0].kind)}
                    {mine[0].handle}
                  </span>{" "}
                  stays exactly as it is. Each handle keeps its own card and its
                  own escrow.
                </>
              ) : (
                <>
                  The card sits on a handle people pay, so the handle has to be
                  proven yours. One click, and you come back here.
                </>
              )}
            </p>

            <button
              className="btn btn-primary mt-4"
              disabled={!usable}
              title={usable ? undefined : "Not enabled on this deployment yet"}
              onClick={() =>
                void signIn(provider.key, `/app/submit?for=${slugOf(kind)}`)
              }
            >
              {provider.mark}
              Connect {provider.label}
            </button>

            {authMessage && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {authMessage}
              </p>
            )}
          </div>
        ) : (
          <>
        {/* -------------------------------------------------- 2 headline
            "What do you do?" used to be question two, and it was a question
            with one answer: somebody who signs in with GitHub has already said
            they build. The role comes from the platform now (lib/roles.ts) and
            is printed on the tile above, so the form asks two things instead of
            three. */}
        <div className="p-5">
          <label className="label" htmlFor="headline">
            <Step n={2} /> One line about your work
          </label>
          <input
            id="headline"
            className="field"
            value={headline}
            maxLength={HEADLINE_MAX}
            aria-invalid={tooShort(headline, HEADLINE_MIN) || undefined}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Soroban contracts and the tooling around them"
          />
          <Counter value={headline} min={HEADLINE_MIN} max={HEADLINE_MAX} />
        </div>

        {/* --------------------------------------------------- 3 summary */}
        <div className="p-5">
          <label className="label" htmlFor="summary">
            <Step n={3} /> What have you actually shipped?
          </label>
          <textarea
            id="summary"
            className="field min-h-24"
            value={summary}
            maxLength={SUMMARY_MAX}
            aria-invalid={tooShort(summary, SUMMARY_MIN) || undefined}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Two or three sentences. Concrete beats broad: what you built, where it runs, what it saved someone."
          />
          <Counter value={summary} min={SUMMARY_MIN} max={SUMMARY_MAX} />
        </div>

        {/* ------------------------------------------------- the optional
            Behind a disclosure, because neither tags nor links can stop the
            card from being published — and a required field is easier to find
            when it is not sitting between two that are not. */}
        <details className="p-5">
          <summary className="cursor-pointer font-semibold">
            Tags and links{" "}
            <span className="font-normal text-mute">
              — optional
              {(ecosystems.length > 0 || cleanLinks.length > 0) && (
                <>
                  {" · "}
                  <span className="num">{ecosystems.length}</span> tag
                  {ecosystems.length === 1 ? "" : "s"},{" "}
                  <span className="num">{cleanLinks.length}</span> link
                  {cleanLinks.length === 1 ? "" : "s"}
                </>
              )}
            </span>
          </summary>

          <div className="mt-4 flex flex-wrap gap-2">
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
          <p className="mt-1.5 text-xs text-mute">
            Up to <span className="num">{MAX_ECOSYSTEMS}</span>. They are the
            directory’s only filter.
          </p>

          <div className="mt-4 space-y-2">
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
        </details>

        {/* -------------------------------------------------------- save */}
        <div className="p-5">
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
              aria-describedby={problem ? "publish-blocked" : undefined}
            >
              {busy && <span className="spinner" aria-hidden />}
              {busy
                ? "Saving…"
                : loaded?.existing
                  ? "Save changes"
                  : "Publish my card"}
            </button>
            {/* The reason the button is dead, in the colour of a caution rather
                than of a caption. In mute grey beside a faded button it read as
                decoration, and the button read as broken. */}
            {problem && (
              <span
                id="publish-blocked"
                className="text-sm font-medium text-warn"
              >
                {problem}
              </span>
            )}
          </div>

          {/* Everything a publish used to say inline now says it in a dialog:
              the link was the point of this block, and at the bottom of a long
              form it was the quietest thing on the page. What stays here is one
              line, for after the dialog is dismissed. */}
          {everSaved && !saved && (
            <p aria-live="polite" className="mt-3 text-xs text-mute">
              {published ? "Saved and listed." : "Saved as a draft."}{" "}
              <Link className="link" href={`/p/${slugOf(kind)}/${handle}`}>
                View my page
              </Link>
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
          </>
        )}
      </div>

      {/* ----------------------------------------------------- preview
          Only once the handle is real. A preview card with a blank name is a
          promise about a page that does not exist yet. */}
      {preview && (
        <aside className="space-y-2 lg:sticky lg:top-6">
          <p className="menu-label">How people will see you</p>
          <PersonCardView card={preview} preview />
          <p className="text-xs leading-relaxed text-mute">
            {kindUrlPrefix(kind)}
            {handle} is the tag money is bound to. The card only describes it.
          </p>
        </aside>
      )}

      {/* Rendered closed rather than mounted on demand: `showModal()` needs an
          element that is already in the document, and a dialog that mounts and
          opens in the same commit does not animate. */}
      {handle && (
        <PublishedDialog
          open={saved}
          published={published}
          kind={kind}
          handle={handle}
          onClose={() => setSaved(false)}
        />
      )}
    </div>
  );
}

/** The step number, so three questions read as three and not as a form. */
function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="num mr-1.5 inline-grid h-4 w-4 place-items-center rounded-full bg-raised align-[-2px] text-[0.625rem] font-bold text-dim"
    >
      {n}
    </span>
  );
}

/** Non-empty but under the minimum — the state worth marking on a field. */
function tooShort(value: string, min: number): boolean {
  const n = value.trim().length;
  return n > 0 && n < min;
}

/**
 * The character count, showing whichever limit is in the reader's way.
 *
 * "9/1000" is true and useless when the field needs twenty characters: it says
 * there is room to spare while the publish button sits disabled. So below the
 * minimum the counter counts up to the MINIMUM, in the caution colour, and only
 * then goes back to counting down from the maximum.
 */
function Counter({
  value,
  min,
  max,
}: {
  value: string;
  min: number;
  max: number;
}) {
  const n = value.trim().length;
  const short = tooShort(value, min);
  return (
    <p
      className={`mt-1 text-right text-xs ${short ? "text-warn" : "text-mute"}`}
    >
      {short ? (
        <>
          <span className="num">{n}</span> / <span className="num">{min}</span>{" "}
          minimum
        </>
      ) : (
        <>
          <span className="num">{n}</span>/{max}
        </>
      )}
    </p>
  );
}
