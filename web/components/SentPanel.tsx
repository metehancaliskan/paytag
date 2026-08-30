"use client";

import { useCallback, useEffect, useState } from "react";
import PaymentList from "./PaymentList";
import { useWallet } from "./WalletProvider";
import {
  latestLedger,
  listPaymentsFrom,
  STATUS,
  type Payment,
} from "@/lib/contract";
import { resolveRecipients, type RecipientMap } from "@/lib/sent";
import { describeEscrowError } from "@/lib/stellar";

/**
 * Everything this wallet has sent, with the refundable ones first.
 *
 * THE ORDER IS THE POINT. A person opens this page for one reason: money that
 * did not get claimed and can come back. Newest-first would bury that under
 * whatever they sent this morning, so the list is cut into three and the one
 * that can be acted on is at the top. Inside each group the newest is first,
 * which is the only sensible order once the question is settled.
 *
 * Keyed on the wallet, not on an account. Switching wallets in the extension
 * gives a different list, and it should: the payments belong to the key that
 * signed them.
 */
export default function SentPanel() {
  const { address, connect, connecting, installed } = useWallet();

  // The list is kept WITH the address it belongs to, the same shape SendForm
  // uses for a balance. Switching wallets in the extension then shows nothing
  // rather than the previous account's payments, and it does so without an
  // effect that resets state on the way in.
  const [loaded, setLoaded] = useState<{
    addr: string;
    list: Payment[];
  } | null>(null);
  const payments = loaded && loaded.addr === address ? loaded.list : null;
  const [recipients, setRecipients] = useState<RecipientMap>({});
  const [ledger, setLedger] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setReloading(true);
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!address) return;
    let alive = true;

    void (async () => {
      try {
        // The ledger is what decides whether a window has closed, so it is
        // read in the same breath as the payments rather than assumed.
        const [list, seq] = await Promise.all([
          listPaymentsFrom(address),
          latestLedger().catch(() => null),
        ]);
        if (!alive) return;
        setLoaded({ addr: address, list });
        setLedger(seq);
        setFailed(false);

        // Names arrive after the list, deliberately. They are labels; making
        // the payments wait on a database round trip would hold up the only
        // thing on this page that can be acted on.
        const names = await resolveRecipients(list);
        if (alive) setRecipients(names);
      } catch (e) {
        if (alive) {
          setLoaded({ addr: address, list: [] });
          setFailed(true);
          setError(describeEscrowError(e));
        }
      } finally {
        if (alive) setReloading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [address, tick]);

  if (installed === false) {
    return (
      <div className="card p-6 text-center">
        <p className="font-medium">A wallet is needed to look this up</p>
        <p className="mt-1 text-sm text-mute">
          The list is per wallet, because a refund is signed by the key that
          sent the money.
        </p>
        <a
          className="btn btn-ghost mt-4"
          href="https://www.freighter.app/"
          target="_blank"
          rel="noreferrer"
        >
          Install the Freighter wallet
        </a>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="card p-6 text-center">
        <p className="font-medium">Connect the wallet you sent from</p>
        <p className="mt-1 text-sm text-mute">
          A refund is signed by the key that sent the money, so this list only
          exists once a wallet is connected.
        </p>
        <button
          className="btn btn-primary mt-4"
          onClick={connect}
          disabled={connecting}
        >
          {connecting && <span className="spinner" aria-hidden />}
          {connecting ? "Connecting…" : "Connect a wallet"}
        </button>
      </div>
    );
  }

  const expired = (p: Payment) =>
    ledger !== null && p.expiryLedger - ledger < 0;

  const groups: { title: string; of: Payment[] }[] =
    payments === null
      ? []
      : [
          {
            title: "Ready to take back",
            of: payments.filter(
              (p) => p.status === STATUS.Pending && expired(p),
            ),
          },
          {
            title: "Still waiting",
            of: payments.filter(
              (p) => p.status === STATUS.Pending && !expired(p),
            ),
          },
          {
            title: "Closed",
            of: payments.filter((p) => p.status !== STATUS.Pending),
          },
        ].filter((g) => g.of.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-mute">
          {payments === null
            ? "reading from the chain"
            : `${payments.length} ${payments.length === 1 ? "payment" : "payments"} from this wallet`}
        </span>
        <button className="btn btn-quiet" onClick={refresh} disabled={reloading}>
          {reloading && <span className="spinner" aria-hidden />}
          {reloading ? "Reading…" : "Refresh"}
        </button>
      </div>

      {payments === null || groups.length === 0 ? (
        <PaymentList
          payments={payments}
          ledger={ledger}
          failed={failed}
          direction="out"
          recipients={recipients}
          onRefunded={refresh}
          empty={{
            title: "Nothing sent from this wallet yet",
            line: "Payments you send will show up here, with a way to take back the ones nobody claims.",
          }}
        />
      ) : (
        groups.map((g) => (
          <PaymentList
            key={g.title}
            title={g.title}
            payments={g.of}
            ledger={ledger}
            direction="out"
            recipients={recipients}
            onRefunded={refresh}
          />
        ))
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
