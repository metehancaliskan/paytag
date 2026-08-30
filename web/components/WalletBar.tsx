"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";
import { useIdentity, identityList, PROVIDER_KIND } from "./useIdentity";
import { PROVIDERS } from "./providers";
import CopyButton from "./CopyButton";
import { CheckMark, ChevronDown, ChevronRight } from "./icons";
import { tokenBalance } from "@/lib/contract";
import { fromUnits, shortAddr, usdGlance, wholeUnits } from "@/lib/format";
import { unitsToCents } from "@/lib/price";
import { usePrice } from "./usePrice";
import { DEFAULT_TOKEN, X_ENABLED, explorerAccount } from "@/lib/config";

/**
 * The account menu.
 *
 * It carries two unrelated things — a wallet (where money goes) and the
 * identities (who is allowed to take it) — so they stay two sections with a
 * rule between them. Mixing them was the old layout's problem: "Disconnect"
 * and "Sign out" sat side by side meaning entirely different things.
 *
 * Both providers are listed whether or not they are connected, and the row for
 * an unconnected one starts OAuth from here. Everything else about the account
 * — the payout address, the cards, deleting it — is one link away under
 * Settings, because a dropdown is a place for two actions, not for settings.
 */
export default function WalletBar() {
  const { address, installed, connecting, error, mismatch, connect, disconnect } =
    useWallet();
  const { identity, signIn } = useIdentity();
  // Both verified handles, GitHub first. A person can hold one of each.
  const mine = identityList(identity);

  // The balance is stored together with the address it belongs to. When the
  // user switches wallets, a stale balance must not appear next to the new
  // address for even one frame.
  const [info, setInfo] = useState<{ addr: string; units: bigint } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // The asset's name comes from the registry, not from the contract: the native
  // XLM Stellar Asset Contract answers `symbol()` with the string "native",
  // which is true on chain and meaningless to a reader looking at a balance.
  const symbol = DEFAULT_TOKEN.symbol;

  // The dollar figure beside the balance. It is an estimate and it is labelled
  // as one by being in parentheses; nothing on chain is denominated in it, and
  // when the rate cannot be fetched the parentheses simply do not appear —
  // better than a "$0" that reads as a balance.
  const price = usePrice();

  useEffect(() => {
    if (!address) return;
    let alive = true;
    (async () => {
      try {
        const bal = await tokenBalance(address);
        if (!alive) return;
        setInfo({ addr: address, units: bal });
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
  const usd =
    shown && price.status === "ready"
      ? usdGlance(
          unitsToCents(shown.units, price.price.usdPerXlm, DEFAULT_TOKEN.decimals),
        )
      : null;

  if (installed === false) {
    return (
      <a
        className="btn btn-ghost"
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
      >
        Install Freighter
      </a>
    );
  }

  // No wallet yet, so there is no menu to hang the identity off. It does not get
  // its own header button: the Settings icon beside this one already goes to the
  // page that connects GitHub and X, and two icons that lead to /profile is one
  // icon too many.
  if (!address) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          className="btn btn-primary"
          onClick={connect}
          disabled={connecting}
        >
          {connecting && <span className="spinner" aria-hidden />}
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
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
            {wholeUnits(shown.units, DEFAULT_TOKEN.decimals)} {symbol}
            {usd && (
              <span className="ml-1.5 font-medium text-mute">({usd})</span>
            )}
          </span>
        )}
        {/* On a phone the balance and the address together wrap the chip onto
            two lines. The balance is the number worth a glance; the address is
            one tap away inside the menu. */}
        <span className="mono hidden text-dim sm:inline">
          {shortAddr(address)}
        </span>
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
          {/* ------------------------------------------------ identity
              Both providers, always, connected or not. Listing only what is
              already verified hid the other half of the product: money can be
              waiting for an X handle, and a menu that never mentions X is a
              menu that never says so. */}
          {identity.status === "loading" ? (
            <div className="menu-row">
              <div className="skeleton h-4 w-36" />
            </div>
          ) : identity.status === "off" ? (
            <p className="menu-row text-xs text-mute">
              Identity verification is not configured here.
            </p>
          ) : (
            PROVIDERS.map((p) => {
              const v = mine.find((m) => m.kind === PROVIDER_KIND[p.key]);
              const usable = p.key !== "x" || X_ENABLED;

              return v ? (
                <Link
                  key={p.key}
                  href="/profile"
                  className="menu-item"
                  onClick={() => setOpen(false)}
                >
                  {p.icon}
                  <span className="truncate font-semibold">@{v.handle}</span>
                  <CheckMark
                    size={12}
                    className="ml-auto shrink-0 text-accent-text"
                  />
                </Link>
              ) : (
                <button
                  key={p.key}
                  type="button"
                  className="menu-item"
                  disabled={!usable}
                  title={usable ? undefined : "X sign-in is not enabled here"}
                  onClick={() => {
                    setOpen(false);
                    void signIn(p.key, "/profile");
                  }}
                >
                  {p.icon}
                  <span className="text-mute">Connect {p.label}</span>
                  <ChevronRight className="ml-auto shrink-0 text-mute" />
                </button>
              );
            })
          )}

          {identity.status !== "off" && (
            <>
              <div className="menu-sep" />
              {identity.status === "verified" && (
                <Link
                  href="/claim"
                  className="menu-item"
                  onClick={() => setOpen(false)}
                >
                  Claim your money
                  <ChevronRight className="ml-auto shrink-0 text-mute" />
                </Link>
              )}
              {/* Everything else about the account is one page, and this is the
                  way to it — the menu holds the two actions, not the settings. */}
              <Link
                href="/profile"
                className="menu-item"
                onClick={() => setOpen(false)}
              >
                Settings
                <ChevronRight className="ml-auto shrink-0 text-mute" />
              </Link>
            </>
          )}

          <div className="menu-sep" />

          {/* -------------------------------------------------- wallet
              The address short rather than all 56 characters: the full one is
              in the clipboard a click away, and printing it here was most of
              the height of this menu. */}
          <div className="menu-row justify-between">
            <span className="menu-label">Wallet</span>
            <span className="mono text-dim">{shortAddr(address)}</span>
          </div>

          {/* The chip above rounds to whole XLM so it can be read at a glance.
              The exact figure belongs here, one click away — a rounded balance
              with no way to see the real one is the same mistake as a truncated
              hash with no copy button. */}
          {shown && (
            <p className="num px-2.5 pb-1 text-sm">
              {fromUnits(shown.units, DEFAULT_TOKEN.decimals)}{" "}
              <span className="text-xs font-semibold text-dim">{symbol}</span>
              {usd && <span className="ml-1.5 text-mute">· {usd}</span>}
            </p>
          )}

          {mismatch && (
            <p role="alert" className="menu-row text-xs leading-relaxed text-warn">
              {mismatch}
            </p>
          )}

          <div className="mb-0.5 flex items-center gap-1 px-1">
            <CopyButton
              value={address}
              label="Copy"
              className="btn btn-quiet btn-sm"
            />
            <a
              className="btn btn-quiet btn-sm"
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
