// Environment configuration.
//
// Next.js inlines `process.env.NEXT_PUBLIC_*` as literal text at BUILD time.
// That is why every variable below is spelled out in full; a dynamic lookup
// like `process.env[name]` comes back `undefined` in the browser.
//
// Nothing without a NEXT_PUBLIC_ prefix belongs in this file: it is part of
// the client bundle.

function need(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing environment variable: ${name}. Fill it in web/.env.local — ` +
        `see .env.example for the full list.`,
    );
  }
  return value.trim();
}

export const NETWORK = (
  process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet"
).trim();

/** True on anything that is not mainnet — the money here is play money. */
export const IS_TESTNET = NETWORK !== "mainnet";

export const RPC_URL = need(
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
  "NEXT_PUBLIC_STELLAR_RPC_URL",
);

export const ESCROW_ID = need(
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID,
  "NEXT_PUBLIC_ESCROW_CONTRACT_ID",
);

/**
 * The tokens this deployment offers.
 *
 * The escrow takes the token address as a `deposit` argument and moves money
 * over the SEP-41 interface, so it is token-agnostic by construction — nothing
 * in the contract knows or cares which asset this is. That is why adding XLM
 * needed no contract change and no redeploy.
 *
 * XLM first, and for one concrete reason: native XLM needs no trustline. An
 * issued asset like USDC cannot even be held by an account that has not opened
 * a trustline for it first, which is a wall in front of the very people this
 * product is for — the ones who have never used Stellar. Native XLM has no
 * such wall.
 *
 * Get the native contract id from the CLI rather than pasting a remembered
 * one; it is derived from the network passphrase and differs per network:
 *   stellar contract id asset --asset native --network testnet
 */
export type TokenKey = "XLM" | "USDC";

export type TokenConfig = {
  key: TokenKey;
  /** What the wallet and the chain call it. */
  symbol: string;
  contractId: string;
  /** Stellar assets are 7 decimals across the board, native included. */
  decimals: number;
  /** Issued assets need a trustline before an account can hold them. */
  needsTrustline: boolean;
  /** Is one unit worth one dollar by construction? */
  isDollarPegged: boolean;
};

export const XLM_SAC_ID = need(
  process.env.NEXT_PUBLIC_XLM_SAC_ID,
  "NEXT_PUBLIC_XLM_SAC_ID",
);

/** Optional: leave the variable empty and the UI simply does not offer USDC. */
export const USDC_SAC_ID = (process.env.NEXT_PUBLIC_USDC_SAC_ID ?? "").trim();

export const TOKENS: TokenConfig[] = [
  {
    key: "XLM",
    symbol: "XLM",
    contractId: XLM_SAC_ID,
    decimals: 7,
    needsTrustline: false,
    isDollarPegged: false,
  },
  ...(USDC_SAC_ID
    ? [
        {
          key: "USDC" as const,
          symbol: "USDC",
          contractId: USDC_SAC_ID,
          decimals: 7,
          needsTrustline: true,
          isDollarPegged: true,
        },
      ]
    : []),
];

export const DEFAULT_TOKEN: TokenConfig = TOKENS[0];

export function tokenByKey(key: TokenKey): TokenConfig {
  return TOKENS.find((t) => t.key === key) ?? DEFAULT_TOKEN;
}

/**
 * Which token a payment is denominated in, resolved from the contract address
 * stored on chain. A payment list can hold several assets at once, so the row
 * cannot assume the symbol — that assumption printed "USDC" next to XLM
 * amounts before this existed.
 */
export function tokenByContractId(contractId: string): TokenConfig | null {
  return TOKENS.find((t) => t.contractId === contractId) ?? null;
}

/**
 * Supabase is OPTIONAL, unlike the values above.
 *
 * Sending money needs a wallet and a contract address, nothing else — so a
 * deployment with no Supabase project still does the main thing. Only claiming
 * needs an account, and the UI says so instead of the page crashing on a
 * missing variable.
 */
export const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
).trim();

export const SUPABASE_ANON_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
).trim();

/** Can this deployment verify identities at all? */
export const AUTH_ENABLED = SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";

/**
 * Is "Continue with X" offered?
 *
 * A flag rather than a probe, because nothing in the browser can see whether
 * the Supabase project has the X provider configured — and an enabled button
 * that dead-ends at Supabase's error page is worse than a disabled one that
 * says why. Set NEXT_PUBLIC_X_ENABLED=1 once the provider has its client id
 * and secret (docs/SETUP-AUTH.md §6).
 */
export const X_ENABLED =
  AUTH_ENABLED && (process.env.NEXT_PUBLIC_X_ENABLED ?? "").trim() === "1";

/** Longest escrow window the contract accepts (lib.rs MAX_EXPIRY_LEDGERS). */
export const MAX_EXPIRY_LEDGERS = 518_400;

/** A Stellar ledger closes roughly every 5 seconds. */
export const SECONDS_PER_LEDGER = 5;

/**
 * How long a claim authorization stays valid: 120 ledgers, about 10 minutes.
 *
 * Deliberately short. The contract refuses a reused nonce, but only while it
 * still holds the nonce record; the expiry window is the protection that does
 * not depend on storage surviving. Long enough to sign a transaction, short
 * enough that a leaked signature is worthless by the time it is found.
 */
export const CLAIM_AUTH_LEDGERS = 120;

/**
 * How long a fetched XLM price is considered current, in seconds.
 *
 * The rate is decoration, not a settlement price: the escrow holds XLM, and
 * what the recipient claims is the XLM amount, whatever it is worth by then.
 * A minute of staleness cannot cost anyone anything.
 */
export const PRICE_TTL_SECONDS = 60;

export const EXPIRY_CHOICES = [
  { label: "7 days", days: 7, ledgers: (7 * 86_400) / SECONDS_PER_LEDGER },
  { label: "30 days", days: 30, ledgers: (30 * 86_400) / SECONDS_PER_LEDGER },
] as const;

function explorerBase(): string {
  return `https://stellar.expert/explorer/${IS_TESTNET ? "testnet" : "public"}`;
}

export function explorerTx(hash: string): string {
  return `${explorerBase()}/tx/${hash}`;
}

export function explorerContract(id: string): string {
  return `${explorerBase()}/contract/${id}`;
}

export function explorerAccount(addr: string): string {
  return `${explorerBase()}/account/${addr}`;
}
