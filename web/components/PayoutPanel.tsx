"use client";

import { useMemo, useState } from "react";
import { browserSupabase } from "@/lib/supabase/client";
import { useWallet } from "./WalletProvider";
import { usePayout } from "./usePayout";
import CopyButton from "./CopyButton";
import { GithubMark, XMark } from "./icons";
import { KIND } from "@/lib/identity";
import { shortAddr } from "@/lib/format";
import { describePayoutProblem, normalizePayout } from "@/lib/payout";
import { describeWriteError } from "@/lib/db-errors";
import { accountExists } from "@/lib/stellar";
import { NETWORK } from "@/lib/config";

/**
 * "Where my escrow lands."
 *
 * Two things a reader gets out of setting this. The obvious one: claim from a
 * hot wallet into a cold one, which works because the escrow contract does not
 * make the recipient sign anything. The one that matters more: once an address
 * is saved, the verifier signs for THAT address and refuses every other, so a
 * session somebody else got hold of cannot redirect the money.
 *
 * Empty is a legitimate state, not an unfinished one — it means "pay whatever
 * wallet I am holding". So the empty row reads as a default, not a warning.
 *
 * One address per identity, because a GitHub escrow and an X escrow are
 * separate pools. Written with the reader's own session: `payout_prefs` is
 * theirs alone under row level security, and the weaker credential is the
 * correct one wherever it is sufficient.
 */
export default function PayoutPanel({ empty }: { empty: string }) {
  const supabase = useMemo(() => browserSupabase(), []);
  const { address: connected } = useWallet();
  const { rows, failed, setSaved } = usePayout();

  const [pick, setPick] = useState(0);
  const row = rows === null ? null : (rows[Math.min(pick, rows.length - 1)] ?? null);

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Never a blank column. With no verified handle there is nothing to set, and
  // the section says so in one line — an empty cell beside a label reads as a
  // page that failed to load.
  if (rows !== null && rows.length === 0) {
    return <p className="text-sm text-mute">{empty}</p>;
  }

  /**
   * Switching identity abandons a half-typed address rather than carrying it
   * over — saving the GitHub draft under the X handle is the kind of mistake
   * nobody notices until the money has moved.
   *
   * Done here rather than in an effect on `pick`: the reset is part of the
   * click, not a consequence of it that React has to re-render to discover.
   */
  function choose(i: number) {
    setPick(i);
    setDraft("");
    setEditing(false);
    setError(null);
    setDone(null);
  }

  const problem = describePayoutProblem(draft);

  async function save() {
    if (!supabase || !row) return;
    const address = normalizePayout(draft);
    if (describePayoutProblem(address) !== null) return;

    setBusy(true);
    setError(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session expired. Sign in again.");

      // A definite "no such account" is refused; an unreachable RPC is not.
      // Blocking on our own outage would be worse than accepting an address the
      // reader can see is theirs.
      if ((await accountExists(address)) === false) {
        throw new Error(
          `No such account on ${NETWORK} yet. Fund it first, then save it here.`,
        );
      }

      const { error: e } = await supabase
        .from("payout_prefs")
        .upsert(
          { identity_id: row.identityId, profile_id: auth.user.id, address },
          { onConflict: "identity_id" },
        );
      if (e) throw new Error(e.message);

      setSaved(row.identityId, address);
      setEditing(false);
      setDraft("");
      setDone("Locked in.");
    } catch (e) {
      setError(describeWriteError(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!supabase || !row) return;
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase
        .from("payout_prefs")
        .delete()
        .eq("identity_id", row.identityId);
      if (e) throw new Error(e.message);

      setSaved(row.identityId, null);
      setEditing(false);
      setDraft("");
      setDone("Back to the connected wallet.");
    } catch (e) {
      setError(describeWriteError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      {rows !== null && rows.length > 1 && (
        <div className="segmented">
          {rows.map((r, i) => (
            <button
              key={r.identityId}
              aria-pressed={i === pick}
              onClick={() => choose(i)}
            >
              {r.kind === KIND.XUser ? (
                <XMark size={12} className="mr-1 inline align-[-1px]" />
              ) : (
                <GithubMark size={12} className="mr-1 inline align-[-1px]" />
              )}
              @{r.handle}
            </button>
          ))}
        </div>
      )}

      {failed ? (
        <p className="mt-3 text-sm text-danger first:mt-0">
          Could not read your payout setting. Reload the page.
        </p>
      ) : row === null ? (
        <div className="skeleton mt-3 h-9 w-64 first:mt-0" />
      ) : editing ? (
        <div className="mt-3 space-y-3 first:mt-0">
          <label className="block">
            <span className="sr-only">Payout address for @{row.handle}</span>
            <input
              className="field mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="G…"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={draft.trim() !== "" && problem !== null}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void save()}
              disabled={busy || problem !== null}
            >
              {busy && <span className="spinner" aria-hidden />}
              Lock it in
            </button>
            {connected && connected !== normalizePayout(draft) && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setDraft(connected)}
                disabled={busy}
              >
                Use connected wallet
              </button>
            )}
            <button
              className="btn btn-quiet btn-sm"
              onClick={() => {
                setEditing(false);
                setDraft("");
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>

          {draft.trim() !== "" && problem !== null && (
            <p className="text-xs text-warn">{problem}</p>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 first:mt-0">
          {row.saved ? (
            <>
              <span className="badge badge-claimed">locked</span>
              <span className="mono text-sm" title={row.saved}>
                {shortAddr(row.saved)}
              </span>
              <CopyButton
                value={row.saved}
                label="Copy"
                className="btn btn-quiet btn-sm"
              />
              <span className="ml-auto flex gap-2">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setDraft(row.saved ?? "");
                    setEditing(true);
                    setDone(null);
                  }}
                >
                  Change
                </button>
                <button
                  className="btn btn-quiet btn-sm"
                  onClick={() => void clear()}
                  disabled={busy}
                >
                  Clear
                </button>
              </span>
            </>
          ) : (
            <>
              <span className="text-sm text-mute">
                {connected ? (
                  <>
                    Pays <span className="mono">{shortAddr(connected)}</span>,
                    the wallet connected now.
                  </>
                ) : (
                  "Pays whichever wallet you connect at claim time."
                )}
              </span>
              <button
                className="btn btn-ghost btn-sm ml-auto"
                onClick={() => {
                  setDraft(connected ?? "");
                  setEditing(true);
                  setDone(null);
                }}
              >
                Pick one address
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {done !== null && error === null && !editing && (
        <p aria-live="polite" className="mt-3 text-xs text-mute">
          {done}
        </p>
      )}
    </section>
  );
}
