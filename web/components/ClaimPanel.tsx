"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { useIdentity, identityList } from "./useIdentity";
import CopyButton from "./CopyButton";
import { GithubMark, XMark } from "./icons";
import { describeAuthError } from "@/lib/auth-errors";
import {
  buildClaim,
  latestLedger,
  listPaymentsForIdentity,
  submitSigned,
  STATUS,
  type Payment,
} from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { sign, networkMismatch } from "@/lib/freighter";
import {
  KIND,
  fromHex,
  kindLabel,
  kindUrlPrefix,
  slugOf,
} from "@/lib/identity";
import { fromUnits, ledgersToHuman, shortAddr } from "@/lib/format";
import {
  DEFAULT_TOKEN,
  X_ENABLED,
  explorerTx,
  tokenByContractId,
} from "@/lib/config";

export default function ClaimPanel({
  hintHandle,
  authError,
}: {
  /** Handle carried over by the "Is this you?" link on a profile page. */
  hintHandle?: string;
  authError?: string;
}) {
  const { address, connect, connecting, installed } = useWallet();
  // Who is signed in is the account menu's question too, so it is answered in
  // one hook rather than twice with two OAuth calls.
  const { identity, error: signInError, signIn, signOut } = useIdentity();

  // A person can have verified both a GitHub and an X handle, and each holds
  // its own escrow. `claim` pays one identity at a time, so one is selected
  // rather than silently merged — a total spanning two identities would be a
  // number that is not any real amount of anything.
  const mine = identityList(identity);
  const [pick, setPick] = useState(0);
  const verified = mine[Math.min(pick, Math.max(mine.length - 1, 0))] ?? null;

  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [ledger, setLedger] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{
    hash: string;
    amount: string;
  } | null>(null);

  // What is waiting for the verified handle. Runs only once there is one —
  // before that there is no identity key to ask the chain about.
  const identityHex = verified?.identityHex ?? null;
  useEffect(() => {
    if (!identityHex) return;
    let alive = true;

    void (async () => {
      try {
        const [list, seq] = await Promise.all([
          listPaymentsForIdentity(identityHex),
          latestLedger(),
        ]);
        if (!alive) return;
        setPayments(list);
        setLedger(seq);
      } catch (e) {
        if (alive) setError(describeEscrowError(e));
      }
    })();

    return () => {
      alive = false;
    };
  }, [identityHex]);

  // One asset at a time: `claim` takes a list of payment ids and pays them all
  // to one recipient, and mixing assets in a single total would show a number
  // that is not any real amount of anything.
  const claimable = (payments ?? []).filter(
    (p) =>
      p.status === STATUS.Pending &&
      ledger !== null &&
      p.expiryLedger > ledger &&
      tokenByContractId(p.token)?.key === DEFAULT_TOKEN.key,
  );
  const total = claimable.reduce((acc, p) => acc + p.amount, 0n);

  async function claimAll() {
    if (!verified || !address || claimable.length === 0) return;
    const ids = claimable.map((p) => p.id);
    setError(null);
    try {
      setBusy("Checking the network…");
      const mismatch = await networkMismatch();
      if (mismatch) throw new Error(mismatch);

      setBusy("Getting authorization…");
      const res = await fetch("/api/verify/claim-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: verified.kind,
          handle: verified.handle,
          recipient: address,
          paymentIds: ids,
        }),
      });
      const auth = (await res.json()) as {
        nonce?: string;
        expiresAt?: number;
        signature?: string;
        error?: string;
      };
      if (!res.ok || !auth.signature || !auth.nonce || !auth.expiresAt) {
        throw new Error(auth.error ?? "The verifier refused to sign.");
      }

      setBusy("Preparing the transaction…");
      const tx = await buildClaim({
        source: address,
        paymentIds: ids,
        identity: fromHex(verified.identityHex),
        recipient: address,
        nonce: fromHex(auth.nonce),
        expiresAt: auth.expiresAt,
        signature: fromHex(auth.signature),
      });

      setBusy("Waiting for your wallet…");
      const signed = await sign(tx.toXdr(), address);

      setBusy("Submitting…");
      const out = await submitSigned(signed);
      setClaimed({ hash: out.hash, amount: fromUnits(total) });

      const [list, seq] = await Promise.all([
        listPaymentsForIdentity(verified.identityHex),
        latestLedger(),
      ]);
      setPayments(list);
      setLedger(seq);
    } catch (e) {
      setError(describeEscrowError(e));
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------------- done

  if (claimed) {
    return (
      <div className="card p-6">
        <span className="badge badge-claimed">claimed</span>
        <h2 className="mt-3 text-xl font-semibold">
          <span className="num">{claimed.amount}</span> {DEFAULT_TOKEN.symbol}{" "}
          is in your wallet
        </h2>
        <p className="mono mt-1 text-mute">{address}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            className="btn btn-ghost btn-sm"
            href={explorerTx(claimed.hash)}
            target="_blank"
            rel="noreferrer"
          >
            View the transaction
          </a>
          <CopyButton
            value={claimed.hash}
            label="Copy hash"
            className="btn btn-ghost btn-sm"
          />
          <button
            className="btn btn-quiet btn-sm"
            onClick={() => setClaimed(null)}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {describeAuthError(authError) && (
        <p role="alert" className="card p-4 text-sm text-danger">
          {describeAuthError(authError)}
        </p>
      )}

      {hintHandle && !verified && (
        <p className="text-sm text-mute">
          Someone paid{" "}
          <span className="font-semibold text-text">
            {kindUrlPrefix(KIND.GithubUser)}
            {hintHandle}
          </span>
          . Sign in as that account to withdraw it.
        </p>
      )}

      <Step
        n={1}
        done={verified !== null}
        title={
          verified
            ? `Verified as @${verified.handle}`
            : "Prove the account is yours"
        }
      >
        {identity.status === "off" ? (
          <p className="text-sm text-mute">
            No Supabase project is configured here, so nobody can be verified.
            See <span className="mono">docs/SETUP-AUTH.md</span>.
          </p>
        ) : identity.status === "loading" ? (
          <div className="skeleton h-9 w-44" />
        ) : verified ? (
          <div className="space-y-3">
            {/* Two verified identities means two separate escrows, so the
                choice is explicit rather than implied by an ordering. */}
            {mine.length > 1 && (
              <div className="segmented">
                {mine.map((v, i) => (
                  <button
                    key={v.identityHex}
                    aria-pressed={verified.identityHex === v.identityHex}
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
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-mute">
              <span>
                {kindLabel(verified.kind)} identity. Only a wallet you name can
                be the destination.
              </span>
              <button
                className="btn btn-quiet btn-sm"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn btn-primary"
              onClick={() => void signIn("github", "/claim")}
            >
              <GithubMark size={16} />
              Continue with GitHub
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void signIn("x", "/claim")}
              disabled={!X_ENABLED}
              title={
                X_ENABLED ? undefined : "X sign-in is not enabled — SPEC §7.4"
              }
            >
              <XMark size={14} />
              Continue with X
            </button>
          </div>
        )}
      </Step>

      <Step n={2} done={claimable.length > 0} title="What is waiting">
        {!verified ? (
          <p className="text-sm text-mute">Shown once you verify.</p>
        ) : payments === null ? (
          <div className="skeleton h-9 w-32" />
        ) : (
          <>
            <p className="num text-3xl font-bold tracking-tight text-accent-text">
              {fromUnits(total)}{" "}
              <span className="text-lg font-semibold text-dim">
                {DEFAULT_TOKEN.symbol}
              </span>
            </p>
            {claimable.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-sm">
                {claimable.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1"
                  >
                    <span className="num font-semibold">
                      {fromUnits(p.amount)}{" "}
                      <span className="text-mute">{DEFAULT_TOKEN.symbol}</span>
                    </span>
                    <span className="mono text-xs text-mute">
                      from {shortAddr(p.from)}
                    </span>
                    <span className="ml-auto text-xs text-mute">
                      {ledger !== null &&
                        `${ledgersToHuman(p.expiryLedger - ledger)} left`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-mute">
                Nothing right now.{" "}
                <Link className="link" href={`/p/${slugOf(verified.kind)}/${verified.handle}`}>
                  Full history
                </Link>
                .
              </p>
            )}
          </>
        )}
      </Step>

      <Step n={3} done={false} title="Withdraw it">
        {installed === false ? (
          <a
            className="btn btn-ghost"
            href="https://www.freighter.app/"
            target="_blank"
            rel="noreferrer"
          >
            Install the Freighter wallet
          </a>
        ) : !address ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn btn-primary"
              onClick={connect}
              disabled={connecting}
            >
              {connecting && <span className="spinner" aria-hidden />}
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            <span className="text-sm text-mute">Any Stellar wallet.</span>
          </div>
        ) : (
          <>
            <p className="mono text-dim">{address}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                className="btn btn-primary"
                onClick={claimAll}
                disabled={busy !== null || claimable.length === 0}
              >
                {busy !== null && <span className="spinner" aria-hidden />}
                {busy ?? `Claim ${fromUnits(total)} ${DEFAULT_TOKEN.symbol}`}
              </button>
              <span aria-live="polite" className="text-sm text-mute">
                {busy}
              </span>
            </div>
          </>
        )}
      </Step>

      {(error ?? signInError) && (
        <p role="alert" className="text-sm text-danger">
          {error ?? signInError}
        </p>
      )}
    </div>
  );
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-sm font-bold ${
            done
              ? "border-accent bg-accent text-accent-fg"
              : "border-line-strong text-mute"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
