"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Avatar from "./Avatar";
import SendForm from "./SendForm";
import { avatarUrl } from "@/lib/cards";
import { browserSupabase } from "@/lib/supabase/client";
import { lookupGithub, type GithubProfile } from "@/lib/github";
import { lookupXHandle } from "@/lib/x-client";
import { useWallet } from "./WalletProvider";
import { latestLedger } from "@/lib/contract";
import {
  KIND,
  identityKey,
  kindHint,
  kindLabel,
  kindMaxLength,
  kindUrlPrefix,
  normalizeHandle,
  profileUrl,
  slugOf,
  toHex,
  type IdentityKind,
} from "@/lib/identity";

/**
 * Send to a handle on ONE platform: type it, check it, then send.
 *
 * The check is the point of this component. Money bound to
 * `sha256(kind ‖ handle)` cannot be recalled by us — only the owner of that
 * handle can claim it, and only the sender can refund it, and only after the
 * window closes. A typo is therefore not a typo, it is somebody else's money for
 * a week. So nothing can be sent until the reader has pressed **Check** and read
 * what came back.
 *
 * WHY A BUTTON AND NOT AS-YOU-TYPE. Checking on every keystroke would fire a
 * request per character — a dozen lookups to type one handle, most of them for
 * prefixes of it. On GitHub that would burn an unauthenticated rate limit (60
 * per hour) in two handles; on a paid API it would be a dozen times the bill for
 * one answer. One press, one lookup.
 *
 * Where the lookups actually happen, and what each costs (docs/API-COSTS.md has
 * the arithmetic and the sources):
 *
 *   GitHub  → api.github.com, FROM THE BROWSER. It sends
 *             `Access-Control-Allow-Origin: *`, so the request never touches our
 *             server and the 60-per-hour limit is counted against the visitor's
 *             own IP. $0 at any traffic level, and it cannot be exhausted by
 *             other people's traffic. Repeat presses on one handle are served
 *             from the per-tab cache in lib/github.ts.
 *   X       → /api/x/lookup, OUR server, because X will only answer a request
 *             carrying an app-only token and it bills us $0.010 for doing so.
 *             That price is why the endpoint is built the way it is rather than
 *             mirrored off the GitHub path: a metered existence check reachable
 *             by anyone with curl is a $36-an-hour hole. Four gates stand in
 *             front of it — a connected wallet, a per-caller window, a
 *             thirty-day cache and a monthly ceiling — and any of them being
 *             hit degrades to `unavailable`, which prints what this page
 *             printed before the endpoint existed. The profile picture
 *             (lib/cards.ts, a free third-party URL loaded by the reader's own
 *             browser) and the link to the profile carry it in that case, and a
 *             missing photo is itself a signal. A handle already verified on
 *             Paytag skips the call entirely: OAuth proved both that the
 *             account exists and who holds it, so the metered question has
 *             nothing left to add.
 *   Paytag  → our own `identities` table, which is world readable. Free, and the
 *             most useful line of the three: it says whether this handle can
 *             claim today or whether the money will sit until somebody verifies.
 *
 * A definite "no such account" refuses. An unreachable GitHub does not: our own
 * outage is not evidence about their account, and the escrow is safe either way
 * — but it is said out loud rather than passed off as a pass.
 */
type Checked = {
  handle: string;
  identityHex: string;
  /** GitHub only. */
  profile: GithubProfile | null;
  /** X only: the name on the account, when X told us one. */
  xDisplayName: string | null;
  /** True when we asked and could not get an answer. */
  unreachable: boolean;
  /** X only: does this deployment offer the paid check at all? */
  xCheckOffered: boolean;
  /** Has somebody verified this handle on Paytag? */
  verified: boolean | null;
  ledger: number | null;
};

export default function SendTo({ kind }: { kind: IdentityKind }) {
  const supabase = useMemo(() => browserSupabase(), []);
  // The wallet is what buys an X lookup — see app/api/x/lookup/route.ts for why
  // a connected address rather than an account, and what that is and is not
  // worth. Nothing else on this component needs it; the send form has its own.
  const { address } = useWallet();
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);

  const label = kindLabel(kind);

  async function check() {
    setBusy(true);
    setProblem(null);
    setChecked(null);
    try {
      let handle: string;
      try {
        handle = normalizeHandle(raw, kind);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "That is not a handle.");
        return;
      }

      // The tag, computed the same way the contract does. Everything below is
      // about the same 32 bytes.
      const identityHex = toHex(await identityKey(handle, kind));

      // The free questions first, and one of them settles the expensive one.
      // GitHub's lookup is free and runs from the visitor's own browser, so it
      // goes in this batch; X's is not, and it waits below.
      const [gh, verified, ledger] = await Promise.all([
        kind === KIND.GithubUser ? lookupGithub(handle) : null,
        (async () => {
          if (!supabase) return null;
          const { data, error } = await supabase
            .from("identities")
            .select("handle")
            .eq("kind", kind)
            .eq("handle", handle)
            .maybeSingle();
          return error ? null : data !== null;
        })(),
        latestLedger().catch(() => null),
      ]);

      /**
       * A VERIFIED HANDLE NEVER BUYS AN X LOOKUP.
       *
       * The paid call answers "is there an account with this name". Somebody
       * verified on Paytag went through the provider's own OAuth, which
       * answers that AND says who holds it. Spending $0.010 to learn less than
       * we already know is money for nothing, and on the handles people pay
       * most often — the ones the directory links to, which are verified by
       * definition — it would have been most of the bill.
       *
       * `null` here means "we did not need to ask", which is why it reads
       * differently below from an X lookup that came back empty.
       */
      const x =
        kind === KIND.XUser && verified !== true
          ? await lookupXHandle(handle, address)
          : null;

      // A definite "no such account" refuses, on either platform. This is the
      // whole reason the check exists: money bound to a handle nobody holds is
      // not lost, but it is locked up until the refund window opens, and the
      // sender finds out a week later.
      if (gh?.status === "missing" || x?.status === "missing") {
        setProblem(
          `No ${label} account called ${handle}. Check the spelling. Money sent to a handle nobody holds waits until the refund window opens.`,
        );
        return;
      }

      setChecked({
        handle,
        identityHex,
        profile: gh?.status === "found" ? gh.profile : null,
        xDisplayName: x?.status === "found" ? x.displayName : null,
        unreachable: gh?.status === "unreachable" || x?.status === "unreachable",
        xCheckOffered: x?.configured === true,
        verified,
        ledger,
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Any edit throws the check away. Without this, typing a new handle after a
   * check would leave the Send form pointing at the tag of the OLD one — the
   * same shape of bug as a form that writes to the row it loaded a moment ago,
   * and here it would be somebody else's money.
   */
  function onType(value: string) {
    setRaw(value);
    if (checked !== null) setChecked(null);
    if (problem !== null) setProblem(null);
  }

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">{kindUrlPrefix(kind).replace("/", "")}</h2>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="input-group flex-1" aria-invalid={problem ? "true" : undefined}>
          <span className="input-prefix">{kindUrlPrefix(kind)}</span>
          <input
            className="input-bare"
            placeholder="username"
            value={raw}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && raw.trim() !== "") void check();
            }}
            maxLength={kindMaxLength(kind) + 24}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={problem ? "true" : undefined}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={() => void check()}
          disabled={busy || raw.trim() === "" || checked !== null}
        >
          {busy && <span className="spinner" aria-hidden />}
          {busy ? "Checking…" : checked ? "Checked" : "Check"}
        </button>
      </div>

      {problem ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      ) : (
        !checked && <p className="mt-2 text-xs text-mute">{kindHint(kind)}</p>
      )}

      {checked && (
        <>
          {/* What came back. The reader decides from this, so it says what it
              knows and what it does not. */}
          <div className="mt-4 flex items-start gap-3 border-t border-line pt-4">
            <Avatar
              src={
                checked.profile?.avatarUrl ??
                avatarUrl({ kind, handle: checked.handle })
              }
              handle={checked.handle}
            />

            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {checked.profile?.name ?? checked.xDisplayName ?? checked.handle}
              </p>
              <a
                className="mono text-sm text-mute hover:text-text"
                href={profileUrl(kind, checked.handle)}
                target="_blank"
                rel="noreferrer"
              >
                {kindUrlPrefix(kind)}
                {checked.handle} ↗
              </a>

              {checked.profile && (
                <p className="num mt-1 text-xs text-mute">
                  {checked.profile.followers} followers ·{" "}
                  {checked.profile.publicRepos} repos · since{" "}
                  {new Date(checked.profile.createdAt).getFullYear()}
                </p>
              )}

              {/* The line that actually changes what happens next. */}
              <p className="mt-2 text-xs">
                {checked.verified === true ? (
                  <span className="text-accent-text">
                    Verified on Paytag. They can claim this today.
                  </span>
                ) : (
                  <span className="text-mute">
                    Not verified on Paytag yet. The money waits until they
                    prove the account is theirs.
                  </span>
                )}
              </p>

              {/* Only the one case that is actually unusual gets a line of its
                  own: we asked GitHub and GitHub did not answer. The X section
                  used to carry a permanent warning saying we cannot confirm the
                  account — permanent, so it was wallpaper rather than a warning,
                  and it appeared under a card that already shows the picture and
                  links the profile. What replaced it is the picture: if the
                  account does not resolve, there is no photo, and the reader can
                  see that faster than they can read a sentence. */}
              {/* Only the one case that is actually unusual gets a line: we
                  asked and got nothing back.

                  AND ONLY WHEN IT STILL MEANS SOMETHING. A handle verified on
                  Paytag is one whose owner signed in through the provider, so
                  the account exists and we know who holds it. Printing "this
                  account is unconfirmed" underneath "verified on Paytag" put
                  two lines that contradict each other in front of somebody
                  about to send money, and the alarming one was the one that
                  knew less: a rate-limited GitHub says nothing about an
                  account OAuth already proved.

                  On X the line is suppressed for a second reason too — when
                  the deployment does not offer the paid check at all, a warning
                  that is permanently on screen is wallpaper, and this page used
                  to carry exactly that. */}
              {checked.unreachable &&
                checked.verified !== true &&
                (kind === KIND.GithubUser || checked.xCheckOffered) && (
                  <p className="mt-2 text-xs text-warn">
                    {kind === KIND.GithubUser
                      ? "GitHub would not answer, so this account is unconfirmed. Open the profile above before sending."
                      : address
                        ? "We could not confirm this account with X. Open the profile above before sending."
                        : "Connect a wallet and check again to confirm this account with X. Sending works either way."}
                  </p>
                )}
            </div>

            <Link
              className="btn btn-quiet btn-sm shrink-0"
              href={`/p/${slugOf(kind)}/${checked.handle}`}
            >
              Their page
            </Link>
          </div>

          <div className="mt-4">
            <SendForm
              handle={checked.handle}
              kind={kind}
              identityHex={checked.identityHex}
              ledger={checked.ledger}
              onSent={() => {}}
            />
          </div>
        </>
      )}
    </section>
  );
}
