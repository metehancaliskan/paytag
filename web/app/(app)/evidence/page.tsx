import type { Metadata } from "next";
import CopyButton from "@/components/CopyButton";
import { CheckMark } from "@/components/icons";
import {
  ACCOUNTS,
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
    "Every deposit, claim and refund this deployment has made, with transaction hashes anyone can open in an explorer.",
};

// The chain is the source of truth, but re-reading it on every request would
// make the page slow for no gain. A minute is fresh enough for a record page.
export const revalidate = 60;

/**
 * The proof page, written for somebody who has never opened a block explorer.
 *
 * The old version led with five 56-character addresses, which reads as noise to
 * anyone who does not already know what they are looking at. So the order is
 * inverted: the three things that happened first, in a sentence each, then the
 * full record, and the hex last — behind a disclosure, where a reviewer who
 * wants it will still find it and nobody else has to scroll past it.
 */
export default async function EvidencePage() {
  // If the RPC endpoint is down, the historical record still renders. A page
  // whose whole job is to be verifiable should not go blank because one live
  // read failed.
  let config: EscrowConfig | null = null;
  let configError: string | null = null;
  try {
    config = await getConfig();
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Proof</h1>
        <p className="mt-2 text-dim">
          Three things had to work. All three happened on the Stellar{" "}
          {NETWORK} — open any link and check for yourself.
        </p>
      </header>

      {/* ------------------------------------------------------ the story */}
      <ol className="grid gap-4 lg:grid-cols-3">
        {HIGHLIGHTS.map((h, i) => (
          <li key={h.hash} className="card flex flex-col p-5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-accent-fg"
              >
                <CheckMark size={12} />
              </span>
              <span className="menu-label">Step {i + 1}</span>
            </div>
            <h2 className="mt-3 font-semibold leading-snug">{h.title}</h2>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-mute">
              {h.body}
            </p>
            <a
              className="link mt-4 text-sm font-medium"
              href={explorerTx(h.hash)}
              target="_blank"
              rel="noreferrer"
            >
              See it on the explorer →
            </a>
          </li>
        ))}
      </ol>

      {/* ------------------------------------------------ what this means */}
      <section className="card p-5">
        <div className="grid gap-5 sm:grid-cols-3">
          <Plain term="Who held the money">
            A contract, not a company. It can only pay the verified owner or
            refund the sender.
          </Plain>
          <Plain term="What a hash is">
            A receipt number. Anyone can look it up on the public network and
            see the same thing you do.
          </Plain>
          <Plain term="Why it is worth nothing">
            This is the test network. Real money is not involved anywhere on
            this page.
          </Plain>
        </div>
      </section>

      {/* ------------------------------------------------ the full record */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">The full record</h2>

        {EVIDENCE.map((group) => (
          <details
            key={`${group.phase}-${group.title}`}
            className="card p-5"
            open={group.txs.length > 4}
          >
            <summary className="cursor-pointer">
              <span className="font-semibold">{group.title}</span>
              <span className="num ml-2 text-xs text-mute">
                {group.txs.length}{" "}
                {group.txs.length === 1 ? "transaction" : "transactions"} ·{" "}
                {group.date}
              </span>
            </summary>

            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-dim">
              {group.summary}
            </p>

            <ul className="mt-4 space-y-3">
              {group.txs.map((tx) => (
                <li
                  key={tx.hash}
                  className="divider pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{tx.what}</span>
                    <a
                      className="mono link text-mute"
                      href={explorerTx(tx.hash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddr(tx.hash, 10, 6)}
                    </a>
                  </div>
                  {tx.note && (
                    <p className="mt-1 text-xs leading-relaxed text-mute">
                      {tx.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {group.footnote && (
              <p className="mt-4 divider pt-4 text-xs leading-relaxed text-mute">
                {group.footnote}
              </p>
            )}
          </details>
        ))}
      </section>

      {/* ------------------------------------------------------ the honesty */}
      <section className="card p-5">
        <h2 className="font-semibold">Not proven yet</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-dim">
          {EVIDENCE_GAPS.map((gap) => (
            <li key={gap} className="flex gap-2">
              <span aria-hidden className="text-line-strong">
                —
              </span>
              <span>{gap}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-mute">
          A record that only shows what worked is a brochure.
        </p>
      </section>

      {/* --------------------------------------------------------- the hex */}
      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">
          Addresses and keys
          <span className="ml-2 text-xs font-normal text-mute">
            for anyone who wants to verify the deployment itself
          </span>
        </summary>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Addr
            label="The escrow contract"
            value={ESCROW_ID}
            href={explorerContract(ESCROW_ID)}
          />
          <Addr
            label={`Money it holds (${DEFAULT_TOKEN.symbol})`}
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
                  <span className="mt-1 block text-xs text-warn">
                    Rotated since the evidence file was written (it records{" "}
                    {VERIFIER_PUBLIC_KEY.slice(0, 12)}…).
                  </span>
                )}
              </Addr>
              <Row label="Default claim window">
                <span className="num">
                  {config.defaultExpiryLedgers.toLocaleString("en-US")} ledgers
                </span>{" "}
                <span className="text-mute">(~30 days)</span>
              </Row>
            </>
          ) : (
            <Row label="Live contract settings">
              <span className="text-sm text-warn">
                Could not read them right now. {configError}
              </span>
            </Row>
          )}
        </dl>

        <div className="mt-5 divider pt-4">
          <p className="menu-label">Accounts used in the demo</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {ACCOUNTS.map((a) => (
              <li
                key={a.address}
                className="flex flex-wrap items-baseline gap-x-3"
              >
                <span className="text-mute">{a.role}</span>
                <a
                  className="mono link"
                  href={explorerAccount(a.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddr(a.address, 8, 6)}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mute">
            Funded by Friendbot, the testnet faucet.
          </p>
        </div>

        <p className="mt-5 divider pt-4 text-xs leading-relaxed text-mute">
          The admin can rotate the verifier key with{" "}
          <span className="mono">set_verifier</span>, and could therefore
          authorize any claim. A real hole in &quot;the money is not ours&quot;
          — SPEC §6.4, and a mainnet blocker.
        </p>
      </details>
    </div>
  );
}

function Plain({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">{term}</p>
      <p className="mt-1 text-sm leading-relaxed text-mute">{children}</p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-mute">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * A long value shown short, with the full one a click away in the clipboard.
 * Truncating without a copy button would be hiding evidence; printing all 56
 * characters five times over is what made the old page unreadable.
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
    <div className="min-w-0">
      <dt className="text-xs text-mute">{label}</dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
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
