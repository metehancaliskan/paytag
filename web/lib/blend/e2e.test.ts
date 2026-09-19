import { describe, expect, it } from "vitest";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { networkPassphrase } from "../stellar";
import { submitSigned } from "../contract";
import { tokenByKey } from "../config";
import {
  accruedRewards,
  buildSupply,
  buildWithdraw,
  loadPositions,
  loadReserve,
  reserveAssets,
  supplyEmissionId,
} from "./pool";

/**
 * Lending and taking it back, against the live Blend pool. OFF by default.
 *
 * `BLEND_E2E=1 pnpm test` runs it. Same bargain as the anchor's end-to-end
 * test: it needs the network, a funded throwaway account and half a minute,
 * so it does not run in CI or in an ordinary `pnpm test`.
 *
 * What it is for: the arithmetic in `pool.test.ts` is ours and runs offline,
 * but the part that actually breaks in an integration like this is the shape
 * of a request — a struct field encoded as the wrong type, an argument in the
 * wrong position, a request type off by one. None of that shows up until a
 * real pool rejects it, which is what this does.
 */

const RUN = process.env.BLEND_E2E === "1";

describe.skipIf(!RUN)("lending on Blend, end to end", () => {
  it(
    "lends XLM and takes it back with what it earned",
    { timeout: 180_000 },
    async () => {
      const kp = Keypair.random();
      const me = kp.publicKey();
      await fetch(`https://friendbot.stellar.org?addr=${me}`);

      const send = async (tx: { toXdr: () => string }) => {
        const parsed = TransactionBuilder.fromXdr(tx.toXdr(), networkPassphrase);
        parsed.sign(kp);
        return submitSigned(parsed.toXdr());
      };

      // The pool decides which assets it takes and what it calls them; the
      // index is positional, so reading it rather than assuming it is the
      // difference between supplying XLM and supplying whatever is at slot 0.
      const assets = await reserveAssets();
      const xlm = tokenByKey("XLM").contractId;
      const index = assets.indexOf(xlm);
      expect(index).toBeGreaterThanOrEqual(0);

      const reserve = await loadReserve(xlm, index);
      // A rate that starts at 1.0 and only climbs. Below it, something is wrong.
      expect(reserve.bRate).toBeGreaterThanOrEqual(1_000_000_000_000n);

      expect(await loadPositions(me, [reserve])).toEqual([]);

      const lend = 50_000_000n; // 5 XLM
      await send(await buildSupply(me, xlm, lend));

      const after = await loadPositions(me, [reserve]);
      expect(after).toHaveLength(1);
      expect(after[0].asset).toBe(xlm);
      // Worth what was put in, give or take the rounding of one stroop.
      expect(lend - after[0].underlying).toBeLessThanOrEqual(2n);
      // Plain supply, not collateral: this app never pledges anything.
      expect(after[0].collateral).toBe(0n);
      expect(after[0].supply).toBe(after[0].underlying);

      // Rewards are readable without claiming them — a simulation of the call
      // that would pay them out.
      const accrued = await accruedRewards(me, [supplyEmissionId(index)]);
      expect(accrued).toBeGreaterThanOrEqual(0n);

      // Asking for more than the position holds empties it instead of failing.
      await send(
        await buildWithdraw(me, xlm, {
          supply: after[0].supply * 2n,
          collateral: 0n,
        }),
      );
      expect(await loadPositions(me, [reserve])).toEqual([]);
    },
  );
});
