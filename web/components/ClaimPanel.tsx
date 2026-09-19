"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "./WalletProvider";
import { useIdentity, identityList } from "./useIdentity";
import { usePayout } from "./usePayout";
import { PROVIDERS } from "./providers";
import ClaimedDialog, { type Claimed } from "./ClaimedDialog";
import Avatar from "./Avatar";
import { AssetMark } from "./icons";
import { avatarUrl } from "@/lib/cards";
import { describeAuthError } from "@/lib/auth-errors";
import {
  buildClaim,
  latestLedger,
  listPaymentsForIdentity,
  submitSigned,
  STATUS,
} from "@/lib/contract";
import { describeEscrowError } from "@/lib/stellar";
import { sign, networkMismatch } from "@/lib/freighter";
import { fromHex, kindUrlPrefix, type IdentityKind } from "@/lib/identity";
import { claimDestination } from "@/lib/payout";
import {
  anyUnits,
  groupByAsset,
  named,
  unnamed,
  type AssetTotal,
  type NamedAsset,
} from "@/lib/assets";
import { displayUnits, fromUnits, ledgersToHuman, shortAddr } from "@/lib/format";
import { DEFAULT_TOKEN, X_ENABLED } from "@/lib/config";

/**
 * Claiming, as a list rather than a wizard.
 *
 * The old version was three numbered steps with a segmented control inside the
 * first one, which meant a person with two handles could see one escrow at a
 * time and had to remember to look at the other. But the two are separate
 * pools: money paid to `github.com/you` and money paid to `x.com/you` are
 * different tags with different keys, and the only interesting question on this
 * page is "how much is on each of mine".
 *
 * So: one row per identity, both totals on screen at once, a Claim button on
 * whichever row has something. A provider you have not verified is a row too —
 * with a Verify button, because an empty row is how you learn the other half
 * exists.
 *
 * And within a row, one line per asset. The escrow is asset-agnostic, so a
 * handle can hold XLM and USDC at the same time; the page used to show the
 * default asset and filter the rest out of existence, which meant money on
 * chain that no screen in the product would admit to. Each asset now states
 * itself and carries its own button — separate buttons rather than one, because
 * a claim is atomic: batching an asset the wallet cannot yet hold would take
 * the asset it can hold down with it.
 */

/** What the chain says about one identity, asset by asset. */
type Escrow = {
  assets: AssetTotal[];
  /** Earliest expiry ledger, per token contract id. */
  soonest: Record<string, number>;
};

export default function ClaimPanel({
  hintHandle,
  hintKind,
  authError,
}: {
  /** Handle carried over by the "Is this you?" link on a profile page. */
  hintHandle?: string;
  /**
   * WHICH provider that handle is on. Not decoration: `torvalds` on GitHub and
   * `torvalds` on X are different tags with different escrows, and possibly
   * different owners. Without the kind this page would have to guess, and it
   * used to guess GitHub.
   */
  hintKind?: IdentityKind | null;
  authError?: string;
}) {
  const router = useRouter();
  const { address, connect, connecting, installed } = useWallet();
  const { identity, error: signInError, signIn, signOut } = useIdentity();
  const { savedFor } = usePayout();

  const mine = identityList(identity);
  const [escrows, setEscrows] = useState<Record<string, Escrow> | null>(null);
  const [ledger, setLedger] = useState<number | null>(null);
  // Errors are per identity. A single message under the list said "the verifier
  // refused to sign" without saying which handle it refused for — on a page
  // whose whole job is that the two are separate, that is the wrong shape.
  // `hex: null` is a failure of the page itself, not of a row.
  const [error, setError] = useState<{ hex: string | null; text: string } | null>(
    null,
  );

  /**
   * Which claim is running, and how far along it is.
   *
   * Keyed by identity AND asset (`hex:contractId`), because those are the units
   * a claim comes in now. Keyed by identity alone, starting the USDC claim
   * would put a spinner on the XLM button beside it.
   */
  const [busy, setBusy] = useState<{ key: string; step: string } | null>(null);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  // Bumped when a claim finishes: the payments it took are Claimed now, so the
  // row would otherwise keep offering money that has already moved.
  const [tick, setTick] = useState(0);

  // Every identity at once. Reading them one at a time would be the same
  // mistake the segmented control was: the page's job is the comparison.
  const keys = mine.map((v) => v.identityHex).join(",");
  useEffect(() => {
    if (keys === "") return;
    let alive = true;

    void (async () => {
      try {
        const hexes = keys.split(",");
        const [seq, ...lists] = await Promise.all([
          latestLedger(),
          ...hexes.map((h) => listPaymentsForIdentity(h)),
        ]);
        if (!alive) return;

        const next: Record<string, Escrow> = {};
        hexes.forEach((hex, i) => {
          // Everything still claimable, whatever asset it is in. The totals are
          // kept apart rather than added up: 100 XLM plus 30 USDC is not 130 of
          // anything, and the screen should never imply that it is.
          const claimable = lists[i].filter(
            (p) => p.status === STATUS.Pending && p.expiryLedger > seq,
          );

          // The claim window runs per payment, so it runs per asset too. One
          // "3 days left" under the handle would be quoting the soonest deadline
          // at every asset on the row, including the ones it has nothing to do
          // with.
          const soonest: Record<string, number> = {};
          for (const p of claimable) {
            const prev = soonest[p.token];
            if (prev === undefined || p.expiryLedger < prev) {
              soonest[p.token] = p.expiryLedger;
            }
          }

          next[hex] = { assets: groupByAsset(claimable), soonest };
        });
        setLedger(seq);
        setEscrows(next);
        setError(null);
      } catch (e) {
        if (alive) setError({ hex: null, text: describeEscrowError(e) });
      }
    })();

    return () => {
      alive = false;
    };
  }, [keys, tick]);

  async function claim(
    hex: string,
    handle: string,
    kind: IdentityKind,
    asset: NamedAsset,
  ) {
    if (asset.ids.length === 0 || !address) return;

    // The destination is per identity: a payout address locked on one handle
    // has nothing to do with the other one.
    const to = claimDestination(savedFor(kind), address).address;
    if (!to) return;

    const ids = asset.ids;
    const busyKey = `${hex}:${asset.contractId}`;
    setError(null);
    try {
      setBusy({ key: busyKey, step: "Checking the network…" });
      const mismatch = await networkMismatch();
      if (mismatch) throw new Error(mismatch);

      setBusy({ key: busyKey, step: "Getting authorization…" });
      const res = await fetch("/api/verify/claim-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, handle, recipient: to, paymentIds: ids }),
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

      setBusy({ key: busyKey, step: "Preparing…" });
      const tx = await buildClaim({
        // The connected wallet submits and pays the fee; `recipient` is where
        // the money lands, and nothing on chain requires them to be the same.
        source: address,
        paymentIds: ids,
        identity: fromHex(hex),
        recipient: to,
        nonce: fromHex(auth.nonce),
        expiresAt: auth.expiresAt,
        signature: fromHex(auth.signature),
      });

      setBusy({ key: busyKey, step: "Waiting for your wallet…" });
      const signed = await sign(tx.toXdr(), address);

      setBusy({ key: busyKey, step: "Submitting…" });
      const out = await submitSigned(signed);
      setClaimed({
        hash: out.hash,
        units: asset.units,
        // The receipt names the asset it is a receipt for. It used to print the
        // default symbol whatever had moved, which on a USDC claim was a
        // confident lie about which money had just landed.
        symbol: asset.token.symbol,
        decimals: asset.token.decimals,
        contractId: asset.contractId,
        to,
        kind,
        handle,
      });
      // The person's own page shows what is waiting in escrow, server-rendered.
      // Without this, going back to it after a claim shows the money still
      // sitting there.
      router.refresh();
    } catch (e) {
      setError({ hex, text: describeEscrowError(e, "claim") });
    } finally {
      setBusy(null);
    }
  }

  // ------------------------------------------------------------ not signed in

  const message = describeAuthError(authError) ?? signInError;

  if (identity.status === "off") {
    return (
      <p className="card p-5 text-sm text-mute">
        No Supabase project is configured here, so nobody can be verified. See{" "}
        <span className="mono">docs/SETUP-AUTH.md</span>.
      </p>
    );
  }

  if (identity.status === "loading") {
    return <div className="skeleton h-32 w-full" />;
  }

  if (mine.length === 0) {
    return (
      <div className="space-y-4">
        {hintHandle && (
          <p className="text-sm text-mute">
            Money is waiting for{" "}
            <span className="font-semibold text-text">
              {/* No default. A link that arrived without `on=` does not say
                  which platform, and printing "github.com/" over an X handle
                  sends the claimant to verify the wrong account — the exact
                  guess this component's own prop doc warns about. */}
              {hintKind !== null && hintKind !== undefined
                ? kindUrlPrefix(hintKind)
                : "@"}
              {hintHandle}
            </span>
            {hintKind !== null && hintKind !== undefined
              ? ". Sign in as that account."
              : ", on GitHub or on X. Verify whichever one is yours."}
          </p>
        )}

        <div className="card divide-y divide-line">
          {PROVIDERS.map((p) => (
            <div
              key={p.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4"
            >
              {p.icon}
              <span className="mono text-mute">{p.domain}</span>
              <button
                className="btn btn-ghost btn-sm ml-auto"
                onClick={() => void signIn(p.key, "/claim")}
                disabled={p.key === "x" && !X_ENABLED}
                title={
                  p.key === "x" && !X_ENABLED
                    ? "Not enabled on this deployment yet"
                    : undefined
                }
              >
                Verify
              </button>
            </div>
          ))}
        </div>

        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- the rows

  const anything = mine.some((v) =>
    anyUnits(escrows?.[v.identityHex]?.assets ?? []),
  );

  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-line">
        {mine.map((v) => {
          const escrow = escrows?.[v.identityHex];
          const locked = savedFor(v.kind);
          // Per identity, always: the locked address if there is one, otherwise
          // the wallet connected right now.
          const destination = claimDestination(locked, address).address;
          const assets = named(escrow?.assets ?? []);
          // Assets on this tag that this build has no name for. They are not
          // offered — an amount with no unit beside it is not an offer — but
          // they are counted, because money the interface refuses to mention is
          // the failure this whole screen was rebuilt to stop.
          const strangers = unnamed(escrow?.assets ?? []);
          const holding = assets.length > 0;

          return (
            // The handle heads the row; its assets are listed underneath it.
            // One line per asset, because that is the unit a claim comes in:
            // the claim call is atomic, so an asset the wallet cannot yet hold
            // would take the one it can hold down with it if they shared a
            // button.
            <li key={v.identityHex} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 items-center gap-3">
                  {/* The face that goes with the name. These are handles the
                      reader has proved they own, so the picture is the fastest
                      confirmation that the right account is signed in — faster
                      than reading a string of characters back. It is
                      decorative and falls back to initials: GitHub's avatar is
                      derived from the handle, X's goes through a third party
                      that answers 404 as often as not. */}
                  <Avatar
                    src={avatarUrl({ kind: v.kind, handle: v.handle })}
                    handle={v.handle}
                    size={36}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      {PROVIDERS.find((p) => p.kind === v.kind)?.icon}
                      <span className="mono truncate text-sm">
                        {kindUrlPrefix(v.kind)}
                        {v.handle}
                      </span>
                    </span>

                  {/* Where THIS handle's money goes, on the row itself. It was a
                      single line under the list, which read as one destination
                      for both — and the two can pay two different wallets. */}
                  {holding && (
                    <span className="mt-0.5 block text-xs text-mute">
                      {destination ? (
                        <>
                          pays{" "}
                          <span className="mono">{shortAddr(destination)}</span>
                          {locked && " (locked)"}
                        </>
                      ) : (
                        "connect a wallet to claim it"
                      )}
                    </span>
                  )}

                  {/* The failure sits with the handle it happened to. */}
                  {error?.hex === v.identityHex && (
                    <span
                      role="alert"
                      className="mt-1 block text-xs text-danger"
                    >
                      {error.text}
                    </span>
                  )}
                  </span>
                </span>

                {/* The empty and unread states keep the old shape: a number on
                    the right of the handle, so a row with nothing on it still
                    reads as a row about an amount. */}
                {escrows === null ? (
                  <span className="skeleton h-6 w-20 shrink-0" />
                ) : (
                  !holding && (
                    <span className="num shrink-0 text-lg font-bold text-mute">
                      0{" "}
                      <span className="text-xs font-semibold text-dim">
                        {DEFAULT_TOKEN.symbol}
                      </span>
                    </span>
                  )
                )}
              </div>

              {holding && (
                // Bordered rows rather than bare lines, the same shape the
                // send form uses for the assets it offers. Both screens are
                // answering "which asset", and a person moving between them
                // should not have to learn the answer twice.
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {assets.map((a) => {
                    const t = a.token;
                    const key = `${v.identityHex}:${a.contractId}`;
                    const running = busy?.key === key;
                    const soonest = escrow?.soonest[a.contractId];

                    return (
                      <li
                        key={a.contractId}
                        className="flex items-center gap-3 p-3"
                      >
                        <AssetMark
                          asset={t.key === "XLM" ? "XLM" : "USDC"}
                          size={24}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className="num text-lg font-bold text-accent-text"
                            title={`${fromUnits(a.units, t.decimals)} ${t.symbol}`}
                          >
                            {displayUnits(a.units, t.decimals)}{" "}
                            <span className="text-xs font-semibold text-dim">
                              {t.symbol}
                            </span>
                          </span>

                          {/* Per asset, not per handle: the claim window runs
                              per payment, so the deadline on the XLM has
                              nothing to say about the USDC beside it. */}
                          {soonest !== undefined && ledger !== null && (
                            <span className="mt-0.5 block text-xs text-mute">
                              {ledgersToHuman(soonest - ledger)} left to claim
                            </span>
                          )}
                        </span>

                        {address && (
                          <button
                            className="btn btn-primary btn-sm shrink-0"
                            onClick={() =>
                              void claim(v.identityHex, v.handle, v.kind, a)
                            }
                            disabled={busy !== null}
                          >
                            {running && <span className="spinner" aria-hidden />}
                            {running ? busy.step : `Claim ${t.symbol}`}
                          </button>
                        )}
                      </li>
                    );
                  })}

                  {/* Named only by its contract id, because that is the only
                      true thing this build knows about it. */}
                  {strangers.map((a) => (
                    <li key={a.contractId} className="p-3 text-xs text-mute">
                      {a.ids.length}{" "}
                      {a.ids.length === 1 ? "payment" : "payments"} in an asset
                      this app cannot name (
                      <span className="mono">{shortAddr(a.contractId)}</span>)
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}

        {/* The provider that is not verified yet. Money can be sitting on that
            handle and this session cannot even see it. */}
        {PROVIDERS.filter((p) => !mine.some((v) => v.kind === p.kind)).map((p) => (
          <li
            key={p.key}
            className="flex items-center justify-between gap-4 p-4"
          >
            <span className="flex items-center gap-2">
              {p.icon}
              <span className="mono text-sm text-mute">{p.domain}</span>
            </span>
            <button
              className="btn btn-ghost btn-sm shrink-0"
              onClick={() => void signIn(p.key, "/claim")}
              disabled={p.key === "x" && !X_ENABLED}
              title={
                p.key === "x" && !X_ENABLED
                  ? "Not enabled on this deployment yet"
                  : undefined
              }
            >
              Verify
            </button>
          </li>
        ))}
      </ul>

      {/* One line about the wallet, for every row that has no locked address. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-xs text-mute">
        {installed === false ? (
          <a
            className="link"
            href="https://www.freighter.app/"
            target="_blank"
            rel="noreferrer"
          >
            Install the Freighter wallet
          </a>
        ) : !address ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={connect}
            disabled={connecting}
          >
            {connecting && <span className="spinner" aria-hidden />}
            {connecting ? "Connecting…" : "Connect a wallet"}
          </button>
        ) : (
          // No address here any more: each row states its own, because a locked
          // payout on one handle says nothing about the other.
          <Link className="link" href="/profile">
            Lock an address
          </Link>
        )}

        <button
          className="btn btn-quiet btn-sm ml-auto"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>

      {escrows !== null && !anything && !error && (
        <p className="text-sm text-mute">Nothing waiting right now.</p>
      )}

      {/* Only what belongs to no row: a failed chain read, a sign-in message. */}
      {((error && error.hex === null) || message) && (
        <p role="alert" className="text-sm text-danger">
          {error?.hex === null ? error.text : message}
        </p>
      )}

      {/* The result of a claim, over the list rather than instead of it — the
          other handle's escrow is still worth seeing at that moment. */}
      <ClaimedDialog
        claimed={claimed}
        onClose={() => {
          setClaimed(null);
          setTick((n) => n + 1);
        }}
      />
    </div>
  );
}
