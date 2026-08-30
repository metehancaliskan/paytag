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
      NEXT_PUBLIC_USDC_SAC_ID:
        "CBU7HRUSXSVPI7QHA73G67UDRQTKSEOICFHWOMWSPOZ2S3R3DIWUCPKI",
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
