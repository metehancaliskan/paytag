import type { Metadata } from "next";
import CopyButton from "@/components/CopyButton";
import { CheckMark } from "@/components/icons";
import {
  EVIDENCE,
  EVIDENCE_GAPS,
  HIGHLIGHTS,
  VERIFIER_PUBLIC_KEY,
} from "@/lib/evidence";
import { getConfig, type EscrowConfig } from "@/lib/contract";
import { shortAddr } from "@/lib/format";
import {
  ESCROW_ID,
  NETWORK,
  DEFAULT_TOKEN,
  explorerAccount,
  explorerContract,
  explorerTx,
} from "@/lib/config";

export const metadata: Metadata = {
  title: "Proof — Paytag",
  description:
    "The three things that had to work, each one a transaction anyone can open in an explorer.",
};

// The chain is the source of truth, but re-reading it on every request would
// make the page slow for no gain. A minute is fresh enough for a record page.
export const revalidate = 60;

/**
 * The proof page, for somebody who has never opened a block explorer.
 *
 * Three claims and three links. Everything else — the full transaction list,
 * the addresses, the live contract settings — is behind a disclosure, because a
 * reviewer who wants hex will open it and nobody else should have to scroll
 * past it.
 *
 * Nothing was deleted to get here, only folded. A record page that drops
 * evidence to look tidy is not simpler, it is weaker, so the two things that
 * are not proven yet stay on the surface where they cannot be missed.
 */
export default async function EvidencePage() {
  // If the RPC endpoint is down, the historical record still renders. A page
  // whose whole job is to be verifiable should not go blank because one live
  // read failed.
  let config: EscrowConfig | null = null;
  try {
    config = await getConfig();
  } catch {
    config = null;
  }

  const count = EVIDENCE.reduce((n, g) => n + g.txs.length, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Proof</h1>
        <p className="mt-2 text-dim">
          Three things had to work. All three happened on Stellar {NETWORK} —
          open any link and check.
        </p>
      </header>

      <ol className="space-y-3">
        {HIGHLIGHTS.map((h) => (
          <li key={h.hash} className="card flex flex-wrap items-center gap-x-4 gap-y-2 p-5">
            <span
              aria-hidden
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
            >
              <CheckMark size={12} />
            </span>
            <h2 className="font-semibold">{h.title}</h2>
            <a
              className="link ml-auto text-sm font-medium"
              href={explorerTx(h.hash)}
              target="_blank"
              rel="noreferrer"
            >
              Open it →
            </a>
          </li>
        ))}
      </ol>

      <section className="card p-5">
        <h2 className="font-semibold">Not proven yet</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-mute">
          {EVIDENCE_GAPS.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      </section>

      {/* --------------------------------------------------- the whole list */}
      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">
          Every transaction
          <span className="num ml-2 text-xs font-normal text-mute">{count}</span>
        </summary>

        {EVIDENCE.map((group) => (
          <div key={`${group.phase}-${group.title}`} className="mt-5">
            <p className="menu-label">
              {group.title} · {group.date}
            </p>
            <ul className="mt-2 space-y-2">
              {group.txs.map((tx) => (
                <li
                  key={tx.hash}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
                >
                  <span className="text-sm">{tx.what}</span>
                  <a
                    className="mono link text-xs text-mute"
                    href={explorerTx(tx.hash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddr(tx.hash, 8, 6)}
                  </a>
                </li>
              ))}
            </ul>
            {group.footnote && (
              <p className="mt-2 text-xs leading-relaxed text-mute">
                {group.footnote}
              </p>
            )}
          </div>
        ))}
      </details>

      {/* -------------------------------------------------------- the hex */}
      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">
          Addresses and keys
        </summary>

        <dl className="mt-4 space-y-3">
          <Addr
            label="Escrow contract"
            value={ESCROW_ID}
            href={explorerContract(ESCROW_ID)}
          />
          <Addr
            label={`Token it holds (${DEFAULT_TOKEN.symbol})`}
            value={DEFAULT_TOKEN.contractId}
            href={explorerContract(DEFAULT_TOKEN.contractId)}
          />
          {config ? (
            <>
              <Addr
                label="Admin — can change settings"
                value={config.admin}
                href={explorerAccount(config.admin)}
              />
              <Addr label="Verifier key the contract trusts" value={config.verifier}>
                {config.verifier !== VERIFIER_PUBLIC_KEY && (
                  <span className="text-xs text-warn">
                    Rotated since the evidence file was written.
                  </span>
                )}
              </Addr>
            </>
          ) : (
            // Said rather than left out: the admin and verifier rows are the two
            // that matter most here, and a row that quietly vanishes when a read
            // fails reads like a row that was never there.
            <p className="text-sm text-warn">
              The admin and verifier keys come from the live contract, and it
              could not be reached just now.
            </p>
          )}
        </dl>

        <p className="divider mt-4 pt-4 text-xs leading-relaxed text-mute">
          The admin can rotate the verifier key with{" "}
          <span className="mono">set_verifier</span>, and could therefore
          authorize any claim — SPEC §6.4, and a mainnet blocker.
        </p>
      </details>
    </div>
  );
}

/**
 * A long value shown short, with the full one a click away in the clipboard.
 * Truncating without a copy button would be hiding evidence.
 */
function Addr({
  label,
  value,
  href,
  children,
}: {
  label: string;
  value: string;
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <dt className="text-sm text-mute">{label}</dt>
      <dd className="ml-auto flex flex-wrap items-center gap-2 text-sm">
        {href ? (
          <a className="mono link" href={href} target="_blank" rel="noreferrer">
            {shortAddr(value, 8, 6)}
          </a>
        ) : (
          <span className="mono">{shortAddr(value, 8, 6)}</span>
        )}
        <CopyButton value={value} label="Copy" className="btn btn-quiet btn-sm" />
        {children}
      </dd>
    </div>
  );
}
