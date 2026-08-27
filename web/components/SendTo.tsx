"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Avatar from "./Avatar";
import SendForm from "./SendForm";
import { avatarUrl } from "@/lib/cards";
import { browserSupabase } from "@/lib/supabase/client";
import { lookupGithub, type GithubProfile } from "@/lib/github";
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
 *   X       → no API call, and that is a costed decision. X charges $0.010 per
 *             user lookup against our credit balance, with no free allowance, so
 *             an existence check on an anonymous page is a $36-an-hour hole for
 *             anybody with curl. What the reader gets instead is the profile
 *             picture (lib/cards.ts — a free third-party avatar URL loaded by
 *             their own browser) and a link to the profile. A face they
 *             recognise is a better check than a sentence saying we could not
 *             make one, and no photo at all is itself a signal.
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
  /** True when we asked and could not get an answer. */
  unreachable: boolean;
  /** Has somebody verified this handle on Paytag? */
  verified: boolean | null;
  ledger: number | null;
};

export default function SendTo({ kind }: { kind: IdentityKind }) {
  const supabase = useMemo(() => browserSupabase(), []);
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

      const [lookup, verified, ledger] = await Promise.all([
        kind === KIND.GithubUser
          ? lookupGithub(handle)
          : Promise.resolve({ status: "unreachable" as const }),
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

      if (lookup.status === "missing") {
        setProblem(
          `No ${label} account called ${handle}. Check the spelling — money sent to a handle nobody holds waits until the refund window opens.`,
        );
        return;
      }

      setChecked({
        handle,
        identityHex,
        profile: lookup.status === "found" ? lookup.profile : null,
        unreachable: kind === KIND.GithubUser && lookup.status === "unreachable",
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
                {checked.profile?.name ?? checked.handle}
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
                    Verified on Paytag — they can claim this today.
                  </span>
                ) : (
                  <span className="text-mute">
                    Not verified on Paytag yet. The money waits in escrow until
                    they prove the account is theirs.
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
              {checked.unreachable && (
                <p className="mt-2 text-xs text-warn">
                  GitHub would not answer, so this account is unconfirmed. Open
                  the profile above before sending.
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
