import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only`'s default entry throws by design, so that a client
      // bundle importing it fails the build. Under Node there is no such
      // distinction; the package ships an empty module for exactly this, and
      // pointing at it is what lets the signing code — the code that most
      // needs testing — be imported at all.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // `lib/config.ts` throws on a missing variable, by design — a deployment
    // that cannot name its contract should fail loudly. Vitest does not read
    // .env.local, so the public testnet values are set here. Nothing secret
    // belongs in this block; the signing tests set VERIFIER_SECRET themselves.
    env: {
      NEXT_PUBLIC_STELLAR_NETWORK: "testnet",
      NEXT_PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      NEXT_PUBLIC_ESCROW_CONTRACT_ID:
        "CDN2BQNGHWCC22IXLAKBAVIOL5ID4MTH4FNYISVEARWQ4HZ27ZA7OZ3B",
      // The TR mock anchor's USDC — the asset the ramp actually moves.
      NEXT_PUBLIC_USDC_SAC_ID:
        "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      // The USDC we issued ourselves, which earlier payments are still in.
      NEXT_PUBLIC_USDC_LEGACY_SAC_ID:
        "CBU7HRUSXSVPI7QHA73G67UDRQTKSEOICFHWOMWSPOZ2S3R3DIWUCPKI",
      // The anchor. No test reaches it — the network half is the anchor's
      // behaviour, not ours — but the asset check that guards the ramp is
      // arithmetic over these values, and it is tested.
      NEXT_PUBLIC_ANCHOR_HOME_DOMAIN: "tr-mock-anchor.fly.dev",
      // The Blend pool. No test reaches it either; the arithmetic that is ours
      // to get wrong is tested, the calls are not.
      NEXT_PUBLIC_BLEND_POOL_ID:
        "CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW",
      NEXT_PUBLIC_XOXNO_CONTROLLER:
        "CCXRWJ6SIU2WPFEGLFGJVITPL57QAYIMIO6OAM2NBGNDQSSCK2FFV3F3",
      NEXT_PUBLIC_XOXNO_POSITION_NFT:
        "CDVN5JU675MEDPVRPCYC45AHFC275UH57WEU5OTFE4WFGZBNN7HTLPSY",
      // The real testnet native SAC, the same value CI builds with. No test
      // reads the chain, so any non-empty value would do, but a wrong one here
      // would be a wrong answer waiting for the first test that does.
      // Derived with `stellar contract id asset --asset native --network testnet`.
      NEXT_PUBLIC_XLM_SAC_ID:
        "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    },
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
