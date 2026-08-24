// The evidence record, as data.
//
// Same content as docs/evidence/tx-hashes.md, kept here so the /evidence page
// renders it instead of asking a reviewer to read a markdown file. Contract
// addresses are NOT duplicated here — they come from the environment, so the
// page can never show an address the app is not actually talking to.
//
// Testnet is reset two to four times a year (next planned reset:
// 2026-12-16), and these explorer links die with it. That is exactly why the
// repo also keeps screenshots and command output under docs/evidence/.

export type EvidenceTx = {
  what: string;
  hash: string;
  /** Why this transaction is worth looking at. */
  note?: string;
};

export type EvidenceGroup = {
  phase: string;
  title: string;
  date: string;
  summary: string;
  txs: EvidenceTx[];
  /** Something proven without producing a transaction. */
  footnote?: string;
};

export const ACCOUNTS = [
  {
    role: "Sender / admin (paytag-dev)",
    address: "GAD3LMKOEUQ4PVF42NGCDVYZVMLZDAP4RNRRNWEZ7Y7CCXHB7MNQCKWG",
  },
  {
    role: "Recipient (paytag-alice)",
    address: "GDMQNCTLGOAZ7SJYBF7WYKMVW5WZ2BNLM3U654M7YMMCPQMMYBIA6WUA",
  },
  {
    role: "USDC issuer",
    address: "GARBYOHXSSS76ZOV2FUUZOZHQER7BAA3XNBJCMXNWJYS5M3W3XTBG3LZ",
  },
] as const;

/** Verifier public key held in contract storage. The secret never leaves the server. */
export const VERIFIER_PUBLIC_KEY =
  "dbb4d698e7febec6390f19123733b526c1851b09491e57d3529eff78222b517b";

/**
 * The story in three lines, for somebody who has never seen a block explorer.
 *
 * Each hash also appears in EVIDENCE below — this is not a second record, it is
 * the three rows of it that answer "but does the thing actually work".
 */
export const HIGHLIGHTS = [
  {
    title: "Money was left for a GitHub username",
    body: "250 test USDC tagged to github.com/torvalds. No wallet, no account, no idea Paytag exists.",
    hash: "adcce001c50127e2224546dc26008e99f540b3a7ad630aa7cbdb655682a2c629",
  },
  {
    title: "The owner of the account withdrew it",
    body: "Proved the handle was theirs, named a wallet, and the contract paid it out.",
    hash: "0a553414aeacd43400653e5711aeb6fa966012939d973014fa248f8a8b2b2270",
  },
  {
    title: "Unclaimed money went back to the sender",
    body: "Nobody claimed the second payment before its window closed, so the sender took it back.",
    hash: "4e8aaa371720a3dc15e2670dde0906550b46db8530aa8d44d729e5190b44d7b5",
  },
] as const;

export const EVIDENCE: EvidenceGroup[] = [
  {
    phase: "Phase 0.4",
    title: "Toolchain proof",
    date: "2026-08-20",
    summary:
      "Before any real logic: proof that we can build a contract and put it on chain. A throwaway with one function, since deleted.",
    txs: [
      {
        what: "Wasm upload",
        hash: "df20beb0509a8658f4711bdfb0ad8b3431e2ee7036e86c661633cf61542ef640",
        note: "Local wasm hash matched the on-chain one: b34c5a16…",
      },
      {
        what: "Contract creation",
        hash: "c5a03801aba998b3d925ab5f11142719839899875f026a2dd3ca21831883b61b",
      },
    ],
    footnote:
      "The ping call produced no transaction: read-only invocations are simulated, never submitted.",
  },
  {
    phase: "Phase 2.7",
    title: "Test USDC",
    date: "2026-08-21",
    summary:
      "Testnet has no official USDC, so we made our own to test with. The escrow accepts any standard token, XLM included.",
    txs: [
      {
        what: "Trustline — paytag-dev",
        hash: "e49b76738d80fd2ed80af872e21cd91b7eb8a405b77783369a47a7b66d2efcd9",
      },
      {
        what: "Trustline — paytag-alice",
        hash: "4ec19c19bf96cb946b2d3bf994ff24ee8e14012232b1f40ff08091314a6c8e2a",
      },
      {
        what: "USDC → Stellar Asset Contract",
        hash: "d36c742e4ab1d9617a07b4ef3458e2cb6c8b27806235f57ce85f7810bfef9348",
      },
      {
        what: "Mint 1,000 USDC → paytag-dev",
        hash: "65a1908162d14ba9e96ee789876ab6d6ac536f0adef550553c35fb191e43bbc6",
      },
    ],
    footnote:
      "Classic accounts (G…) need a trustline to hold an asset. Contract addresses (C…) keep balances in contract storage, so the escrow needs none.",
  },
  {
    phase: "Phase 2.7",
    title: "The escrow, end to end on chain",
    date: "2026-08-21",
    summary:
      "The whole promise, on chain: money left for a handle, withdrawn by the owner, and a second payment refunded once its window closed.",
    txs: [
      {
        what: "Deposit — 250 USDC to github.com/torvalds",
        hash: "adcce001c50127e2224546dc26008e99f540b3a7ad630aa7cbdb655682a2c629",
        note: "identity_key = sha256(0x00 ‖ \"torvalds\") = 9d8638cd…, payment_id 1",
      },
      {
        what: "Claim — money reaches the recipient",
        hash: "0a553414aeacd43400653e5711aeb6fa966012939d973014fa248f8a8b2b2270",
        note: "The contract rebuilt the 195-byte preimage from the arguments and checked it with ed25519_verify.",
      },
      {
        what: "Deposit — 50 USDC, short expiry",
        hash: "9f03b00cad260da21fe90f8347df1b5ea7ea906a932766afa04d26fd99ca2766",
        note: "payment_id 2, expiry set +20 ledgers",
      },
      {
        what: "Refund — after expiry, back to the sender",
        hash: "4e8aaa371720a3dc15e2670dde0906550b46db8530aa8d44d729e5190b44d7b5",
      },
      {
        what: "Deposit — 10 USDC, expiry +400 ledgers",
        hash: "fd653e5f7040dbd61a763740ed460f9ca77f0b5798658cf94d6634be094334c4",
        note: "payment_id 3, used for the early-refund test below",
      },
    ],
    footnote:
      "Refunding payment 3 early failed with Error(Contract, #8) = NotYetExpired — and has no hash on purpose: Soroban simulates first, so a doomed transaction never reaches the chain and costs nothing. The rule held live, exactly as refund_is_rejected_before_expiry says it should.",
  },
];

/**
 * Still to be recorded — stated rather than quietly omitted.
 *
 * Kept to one line each: this list is read by people deciding whether to trust
 * the rest of the page, and a gap explained at length reads like an excuse.
 * It has to stay current — a stale gap is worse than no list, because it
 * understates what actually works.
 */
export const EVIDENCE_GAPS = [
  "The escrow's own deploy and init hashes. The contract is live; those two were never captured.",
  "A claim authorized by the verifier endpoint, end to end. The code and the sign-in both work; the transaction is not on this page yet.",
];
