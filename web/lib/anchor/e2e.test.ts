import { describe, expect, it } from "vitest";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { networkPassphrase } from "../stellar";
import { loadAnchor } from "./toml";
import { authenticate } from "./auth";
import { priceFor } from "./sep38";
import {
  pollTransaction,
  simulateBankTransfer,
  startDeposit,
  startWithdraw,
} from "./sep6";
import { assetBalance, hasTrustline, openTrustline } from "./trustline";
import { payAnchor } from "./payment";

/**
 * The whole ramp, both directions, against the real sandbox anchor. OFF by
 * default.
 *
 * `ANCHOR_E2E=1 pnpm test` runs it. CI does not, and neither does an ordinary
 * `pnpm test`, for three reasons: it needs the network, it creates and funds a
 * throwaway account through Friendbot, and it takes the better part of a
 * minute. A test suite that cannot be run offline in under a second stops being
 * run at all.
 *
 * What it is for: every other test in this directory covers our own
 * translation of the protocol, and none of them would notice if the anchor
 * changed the shape of a response or if a request went out with a parameter in
 * the wrong place. This one walks the whole path a person walks — discover,
 * authenticate, allow the asset, deposit, simulate the bank, wait, then send
 * it back out with a memo and wait again — with a keypair standing in for the
 * wallet.
 *
 * It asserts the two things that actually matter: the USDC arrived, and the
 * lira came back.
 */

const RUN = process.env.ANCHOR_E2E === "1";

describe.skipIf(!RUN)("the fiat ramp, end to end", () => {
  it(
    "takes lira in and pays lira back out, through a fresh wallet",
    { timeout: 180_000 },
    async () => {
      const kp = Keypair.random();

      // Friendbot: the testnet faucet. A brand-new account, so this also
      // proves the flow works for somebody who has never touched Stellar —
      // which is the only kind of user this product is designed for.
      const funded = await fetch(
        `https://friendbot.stellar.org?addr=${kp.publicKey()}`,
      );
      expect(funded.ok).toBe(true);

      /** Stands in for Freighter: same contract, a key instead of a prompt. */
      const sign = async (xdr: string) => {
        const tx = TransactionBuilder.fromXdr(xdr, networkPassphrase);
        tx.sign(kp);
        return tx.toXdr();
      };

      // SEP-1: everything the anchor can do, from its domain alone. This also
      // runs the asset check — it throws if the anchor's USDC is not the USDC
      // this deployment is configured with.
      const anchor = await loadAnchor();
      expect(anchor.assetCode).toBe("USDC");
      expect(anchor.token.key).toBe("USDC");

      // SEP-38: an estimate, before committing to anything.
      const quote = await priceFor(anchor, "100");
      expect(Number(quote.buyAmount)).toBeGreaterThan(0);

      // SEP-10: one signature over a transaction that can never be submitted.
      const token = await authenticate(anchor, kp.publicKey(), sign);
      expect(token.split(".")).toHaveLength(3);

      // The trustline. Without it the anchor cannot pay and the deposit stops
      // at `pending_trust` — the wall this product spent a year avoiding, and
      // the reason the on-ramp has to be able to open it.
      expect(await hasTrustline(kp.publicKey(), "USDC", anchor.assetIssuer)).toBe(
        false,
      );
      await openTrustline(kp.publicKey(), "USDC", anchor.assetIssuer, sign);
      expect(await hasTrustline(kp.publicKey(), "USDC", anchor.assetIssuer)).toBe(
        true,
      );

      // SEP-6: ask the anchor to expect money, and read back where to send it.
      const deposit = await startDeposit(anchor, token, kp.publicKey(), "100");
      expect(deposit.id).toBeTruthy();
      // The instructions have to carry an account to pay and a reference that
      // identifies the payer. Without both, a real person cannot complete this.
      const labels = deposit.fields.map((f) => f.label.toLowerCase());
      expect(labels.some((l) => l.includes("account"))).toBe(true);
      expect(labels.some((l) => l.includes("memo") || l.includes("reference"))).toBe(
        true,
      );

      // The bank, simulated. On a real anchor this is a person in their
      // banking app, and this is the one call that does not exist there.
      await simulateBankTransfer(anchor, token, deposit.id, "100");

      const final = await pollTransaction(
        anchor,
        token,
        deposit.id,
        () => {},
      );

      expect(final.status).toBe("completed");
      expect(Number(final.amountOut)).toBeGreaterThan(0);
      expect(final.amountOutAsset).toContain(anchor.assetIssuer);

      // And the money is really there, not just claimed to be.
      const balance = await assetBalance(
        kp.publicKey(),
        "USDC",
        anchor.assetIssuer,
      );
      expect(Number(balance)).toBeGreaterThan(0);

      // ------------------------------------------------------ and back out

      // The off-ramp, on the same account and with the money the on-ramp just
      // put there. Run as one test rather than two because that is the only
      // honest way to test it: a withdrawal needs an asset balance, and an
      // asset balance is what the deposit produces.
      const out = "1";
      const withdraw = await startWithdraw(anchor, token, out);
      expect(withdraw.accountId).toBeTruthy();
      // The memo is the whole reason this is not just a payment.
      expect(withdraw.memo).toBeTruthy();
      expect(withdraw.memoType).toBe("id");

      const hash = await payAnchor(
        {
          from: kp.publicKey(),
          destination: withdraw.accountId,
          code: anchor.assetCode,
          issuer: anchor.assetIssuer,
          amount: out,
          memo: withdraw.memo,
          memoType: withdraw.memoType,
        },
        sign,
      );
      expect(hash).toHaveLength(64);

      const paidOut = await pollTransaction(
        anchor,
        token,
        withdraw.id,
        () => {},
      );

      expect(paidOut.status).toBe("completed");
      // Lira on the way out, the asset on the way in: the mirror of the
      // deposit, and the assertion that catches the two being swapped.
      expect(paidOut.amountInAsset).toContain(anchor.assetIssuer);
      expect(paidOut.amountOutAsset).toBe("iso4217:TRY");
      expect(Number(paidOut.amountOut)).toBeGreaterThan(0);
    },
  );
});
