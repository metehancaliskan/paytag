"use client";

import Link from "next/link";
import { useIdentity, identityList, PROVIDER_KIND } from "./useIdentity";
import { PROVIDERS } from "./providers";
import { CheckMark } from "./icons";
import { X_ENABLED } from "@/lib/config";

/**
 * GitHub and X, in the header rather than inside the account menu.
 *
 * Who you have proved you are decides whether any of the money on this product
 * is yours, so it belongs where a reader can see it without opening anything.
 * It used to live in the wallet dropdown, next to an address and a balance,
 * which put the two unrelated halves of the product in one list.
 *
 * Both providers always show, connected or not: money can be waiting for an X
 * handle, and a header that only ever mentions GitHub never says so.
 *
 * The handle itself appears from `lg` up. Below that the mark and its check are
 * the whole chip — at 390px a header cannot carry two handles, a balance and
 * three links, and of those the handle is the one already repeated on the page
 * you land on when you tap it.
 */
export default function IdentityChips({
  className = "",
}: {
  className?: string;
}) {
  const { identity, signIn } = useIdentity();

  // Nothing to show, and nothing to offer: this deployment cannot verify.
  if (identity.status === "off") return null;

  if (identity.status === "loading") {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <div className="skeleton h-8 w-8 rounded-xl" />
        <div className="skeleton h-8 w-8 rounded-xl" />
      </div>
    );
  }

  const mine = identityList(identity);

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {PROVIDERS.map((p) => {
        const v = mine.find((m) => m.kind === PROVIDER_KIND[p.key]);
        const usable = p.key !== "x" || X_ENABLED;

        if (v) {
          return (
            <Link
              key={p.key}
              href="/profile"
              title={`@${v.handle} — verified on ${p.label}`}
              className="idchip idchip-on"
            >
              {p.mark}
              <span className="hidden max-w-[11ch] truncate lg:inline">
                @{v.handle}
              </span>
              <CheckMark size={10} className="shrink-0 text-accent-text" />
            </Link>
          );
        }

        return (
          <button
            key={p.key}
            type="button"
            disabled={!usable}
            title={
              usable
                ? `Connect ${p.label} to claim money sent to your handle`
                : "X sign-in is not enabled here"
            }
            onClick={() => void signIn(p.key, "/profile")}
            className="idchip"
          >
            {p.icon}
            <span className="hidden lg:inline">Connect</span>
          </button>
        );
      })}
    </div>
  );
}
