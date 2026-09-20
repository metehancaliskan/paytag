# Screenshots

Captured from the app running against **Stellar testnet**, with a real wallet
(`GAIWV5QE…SLBA`) and real on-chain data. Headless Chrome answers Freighter's
own message protocol with that address and the testnet passphrase, and nothing
else — no signing, no transactions. Every balance, quote and position below was
read from the network at capture time.

| File | What it shows |
| --- | --- |
| `send-handle-check.png` | A GitHub handle checked before paying it, and the notice that the money waits until the account is proven |
| `dashboard.png` | The directory of people who can be paid, with a connected wallet |
| `onramp-quote.png` | SEP-38 quote on the way in: 2000 TRY → ≈40.79 USDC, fee 9.96 TRY |
| `offramp-quote.png` | SEP-38 quote on the way out: 50 USDC → ≈2427.05 TRY, fee 0.25 USDC |
| `earn-blend-xoxno.png` | Blend and XOXNO on the claim screen: 6 USDC supplied, BLND accruing live |

Reproduce with the dev server running and
`scratchpad/shoot.mjs` (see the session notes) — or simply open
[paytag-six.vercel.app](https://paytag-six.vercel.app) with Freighter on testnet.
