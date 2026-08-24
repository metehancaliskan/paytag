"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";
import { useIdentity, identityList } from "./useIdentity";
import CopyButton from "./CopyButton";
import {
  CheckMark,
  ChevronDown,
  ChevronRight,
  GithubMark,
  XMark,
} from "./icons";
import { tokenBalance } from "@/lib/contract";
import { fromUnits, shortAddr } from "@/lib/format";
import { DEFAULT_TOKEN, explorerAccount } from "@/lib/config";
import { KIND } from "@/lib/identity";

/**
 * The account menu.
 *
 * It carries two unrelated things — a wallet (where money goes) and a GitHub
 * identity (who is allowed to take it) — so they are kept as two labelled
 * sections rather than one list of buttons. Mixing them was the old layout's
 * problem: "Disconnect" and "Sign out" sat side by side meaning different
 * things.
 */
export default function WalletBar() {
  const { address, installed, connecting, error, mismatch, connect, disconnect } =
    useWallet();
  const { identity } = useIdentity();
  // Both verified handles, GitHub first. A person can hold one of each.
  const mine = identityList(identity);

  // The balance is stored together with the address it belongs to. When the
  // user switches wallets, a stale balance must not appear next to the new
  // address for even one frame.
  const [info, setInfo] = useState<{ addr: string; balance: string } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The asset's name comes from the registry, not from the contract: the native
  // XLM Stellar Asset Contract answers `symbol()` with the string "native",
  // which is true on chain and meaningless to a reader looking at a balance.
  const symbol = DEFAULT_TOKEN.symbol;

  useEffect(() => {
    if (!address) return;
    let alive = true;
    (async () => {
      try {
        const bal = await tokenBalance(address);
        if (!alive) return;
        setInfo({ addr: address, balance: fromUnits(bal) });
      } catch {
        // Without a trustline the SAC can refuse to report a balance. That
        // does not deserve an error screen; we just hide the number.
      }
    })();
    return () => {
      alive = false;
    };
  }, [address]);

  // Close the menu on outside click and on Escape — a dropdown that traps the
  // page is worse than no dropdown.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = info && info.addr === address ? info : null;

  if (installed === false) {
    return (
      <div className="flex items-center gap-2">
        <GithubLink identity={identity} />
        <a
          className="btn btn-ghost"
          href="https://www.freighter.app/"
          target="_blank"
          rel="noreferrer"
        >
          Install Freighter
        </a>
      </div>
    );
  }

  // No wallet yet. The identity still needs a way in, so it keeps its own
  // icon-sized entry next to the primary action instead of hiding inside a
  // menu that does not exist yet.
  if (!address) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <GithubLink identity={identity} />
          <button
            className="btn btn-primary"
            onClick={connect}
            disabled={connecting}
          >
            {connecting && <span className="spinner" aria-hidden />}
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
        {error && (
          <span role="alert" className="max-w-xs text-right text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1.5 pl-2.5 pr-2 transition-colors hover:border-line-strong"
      >
        {mismatch && (
          <span className="badge badge-pending" title={mismatch}>
            wrong network
          </span>
        )}
        {shown && (
          <span className="num text-sm font-semibold text-accent-text">
            {shown.balance} {symbol}
          </span>
        )}
        <span className="mono text-dim">{shortAddr(address)}</span>
        {identity.status === "verified" && (
          <span
            title={mine.map((v) => `@${v.handle}`).join(" · ")}
            className="grid h-4 w-4 place-items-center rounded-full bg-accent text-accent-fg"
          >
            <CheckMark size={9} />
          </span>
        )}
        <ChevronDown className="text-mute" />
      </button>

      {open && (
        <div role="menu" className="menu absolute right-0 z-20 mt-2 w-80">
          {/* ------------------------------------------------ identity */}
          {identity.status === "verified" ? (
            // Links, not labels: signing out lives on /profile, and these are
            // the rows a reader looking for it will press.
            mine.map((v) => (
              <Link
                key={v.identityHex}
                href="/profile"
                className="menu-item"
                onClick={() => setOpen(false)}
              >
                {v.kind === KIND.XUser ? (
                  <XMark size={16} className="text-dim" />
                ) : (
                  <GithubMark className="text-dim" />
                )}
                <span className="truncate font-semibold">@{v.handle}</span>
                <span className="badge badge-claimed ml-auto shrink-0">
                  <CheckMark />
                  verified
                </span>
              </Link>
            ))
          ) : identity.status === "loading" ? (
            <div className="menu-row">
              <div className="skeleton h-4 w-36" />
            </div>
          ) : identity.status === "off" ? (
            <p className="menu-row text-xs text-mute">
              Identity verification is not configured here.
            </p>
          ) : (
            <Link
              href="/profile"
              className="menu-item"
              onClick={() => setOpen(false)}
            >
              <GithubMark className="text-dim" />
              <span className="min-w-0">
                <span className="block font-semibold">Connect an account</span>
                <span className="block text-xs text-mute">
                  GitHub or X — needed to claim what is paid to you
                </span>
              </span>
              <ChevronRight className="ml-auto shrink-0 text-mute" />
            </Link>
          )}

          {identity.status === "verified" && (
            <>
              <Link
                href="/app/submit"
                className="menu-item"
                onClick={() => setOpen(false)}
              >
                Your card
                <ChevronRight className="ml-auto shrink-0 text-mute" />
              </Link>
              <Link
                href="/claim"
                className="menu-item"
                onClick={() => setOpen(false)}
              >
                Claim your escrow
                <ChevronRight className="ml-auto shrink-0 text-mute" />
              </Link>
            </>
          )}

          <div className="menu-sep" />

          {/* -------------------------------------------------- wallet */}
          <div className="menu-row justify-between">
            <span className="menu-label">Wallet</span>
            {shown && (
              <span className="num text-base font-bold text-accent-text">
                {shown.balance}{" "}
                <span className="text-xs font-semibold text-dim">{symbol}</span>
              </span>
            )}
          </div>

          <div className="mx-1 rounded-lg border border-line bg-raised px-2.5 py-2">
            <p className="mono text-dim">{address}</p>
          </div>

          {mismatch && (
            <p role="alert" className="menu-row text-xs leading-relaxed text-warn">
              {mismatch}
            </p>
          )}

          <div className="mb-0.5 mt-1.5 flex items-center gap-1 px-1">
            <CopyButton
              value={address}
              label="Copy"
              className="btn btn-ghost btn-sm"
            />
            <a
              className="btn btn-ghost btn-sm"
              href={explorerAccount(address)}
              target="_blank"
              rel="noreferrer"
            >
              Explorer
            </a>
            <button
              className="btn btn-quiet btn-sm ml-auto"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              title="Forgets the address in this browser. Freighter keeps its own permission."
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The identity entry for the states with no wallet menu to put it in. Icon
 * only: the header has no room for a second labelled button, and the tooltip
 * plus aria-label carry the name.
 */
function GithubLink({
  identity,
}: {
  identity: ReturnType<typeof useIdentity>["identity"];
}) {
  if (identity.status === "off" || identity.status === "loading") return null;

  const verified = identity.status === "verified";
  return (
    <Link
      href="/profile"
      title={verified ? `Verified as @${identity.handle}` : "Connect GitHub or X"}
      aria-label={
        verified ? `Verified as @${identity.handle}` : "Connect GitHub or X"
      }
      className="relative grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-dim transition-colors hover:border-line-strong hover:text-text"
    >
      <GithubMark />
      {verified && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-accent text-accent-fg ring-2 ring-surface"
        >
          <CheckMark size={8} />
        </span>
      )}
    </Link>
  );
}
