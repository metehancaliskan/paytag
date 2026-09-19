import { describe, expect, it } from "vitest";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { networkPassphrase } from "../stellar";
import { submitSigned } from "../contract";
import { tokenByKey } from "../config";
import {
  buildSupply,
  buildWithdrawAll,
  collateralOf,
  findAccountId,
} from "./lending";

/**
 * Lending on XOXNO and taking it back. OFF by default.
 *
 * `XOXNO_E2E=1 pnpm test` runs it. Same bargain as the other two end-to-end
 * tests: network, a funded throwaway account, half a minute.
 *
 * This one earns its keep more than most, because XOXNO's account model is
 * the part of this integration that cannot be checked by reading: supplying
 * mints an NFT, the token id is the account id, and every later call names
 * that id. A test that did not actually mint one would prove nothing about
 * the path a real person walks.
 */

const RUN = process.env.XOXNO_E2E === "1";

describe.skipIf(!RUN)("lending on XOXNO, end to end", () => {
  it(
    "mints an account, lends XLM into it, and takes it all back",
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

      const xlm = tokenByKey("XLM").contractId;

      // Nobody has an account until they supply into one.
      expect(await findAccountId(me)).toBeNull();

      const lend = 50_000_000n; // 5 XLM
      await send(await buildSupply(me, null, xlm, lend));

      // The NFT is the account, and finding it is how every later call knows
      // which position it is talking about.
      const accountId = await findAccountId(me);
      expect(accountId).not.toBeNull();

      // Supplied in the asset's own units, not the protocol's internal
      // scaling — which is the whole reason this reader uses
      // `get_collateral_amount`.
      expect(await collateralOf(accountId!, xlm)).toBe(lend);

      // Zero means all of it. This is the only withdrawal the app offers, and
      // it is the one verified to work.
      await send(await buildWithdrawAll(me, accountId!, xlm));
      expect(await collateralOf(accountId!, xlm)).toBe(0n);
    },
  );
});
