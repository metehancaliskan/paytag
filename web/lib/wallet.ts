// Which wallet signs, and how we reach it.
//
// This used to be Freighter and only Freighter, which is a browser extension —
// so on a phone the app asked people to "install Freighter" and there was
// nothing to install: iOS browsers have no extension to inject the bridge the
// library talks to, and Freighter's mobile app is a separate application that
// cannot reach an arbitrary web page. The message was wrong and the flow was a
// dead end on the device most people were holding.
//
// Stellar Wallets Kit replaces that with a picker over several wallets. The one
// that matters for a phone is Albedo: it signs on the web, in a tab, with no
// extension and no app, so a recipient on an iPhone can claim. Freighter still
// works exactly as before on a desktop, through the same kit.
//
// EVERY CALL FALLS BACK. The kit is a large dependency loaded at runtime, and
// the thing it is in the path of is signing money away. If it fails to load for
// any reason, each function here drops to the direct Freighter bridge in
// `./freighter` — which is what shipped before and is known to work.

import { networkPassphrase } from "./stellar";
import { NETWORK } from "./config";
import * as freighter from "./freighter";

/** Which wallet the reader picked last, so a new tab does not ask again. */
const PICKED = "paytag.wallet";

type Kit = typeof import("@creit.tech/stellar-wallets-kit").StellarWalletsKit;

let loading: Promise<Kit | null> | null = null;

/**
 * Loads and initialises the kit once.
 *
 * `init` is a static that may only be called once per page, so the promise —
 * not the result — is the singleton: two components mounting in the same tick
 * share one load instead of racing to initialise twice.
 */
function kit(): Promise<Kit | null> {
  if (loading) return loading;

  loading = (async () => {
    if (typeof window === "undefined") return null;
    try {
      const [
        { StellarWalletsKit },
        { FreighterModule, FREIGHTER_ID },
        { AlbedoModule },
        { xBullModule },
        { RabetModule },
        { HanaModule },
        { LobstrModule },
      ] = await Promise.all([
        import("@creit.tech/stellar-wallets-kit"),
        import("@creit.tech/stellar-wallets-kit/modules/freighter"),
        import("@creit.tech/stellar-wallets-kit/modules/albedo"),
        import("@creit.tech/stellar-wallets-kit/modules/xbull"),
        import("@creit.tech/stellar-wallets-kit/modules/rabet"),
        import("@creit.tech/stellar-wallets-kit/modules/hana"),
        import("@creit.tech/stellar-wallets-kit/modules/lobstr"),
      ]);

      StellarWalletsKit.init({
        // The kit's `Networks` enum is the passphrase itself, so the app's own
        // constant is the value — one source of truth for which chain we are on.
        network: networkPassphrase as never,
        selectedWalletId: picked() ?? FREIGHTER_ID,
        modules: [
          new FreighterModule(),
          new AlbedoModule(),
          new xBullModule(),
          new LobstrModule(),
          new RabetModule(),
          new HanaModule(),
        ],
        // A wallet that cannot be used on this device is noise, not a choice.
        authModal: { hideUnsupportedWallets: true },
      });

      return StellarWalletsKit;
    } catch {
      // No kit. Everything below falls through to the Freighter bridge.
      return null;
    }
  })();

  return loading;
}

function picked(): string | null {
  try {
    return window.localStorage.getItem(PICKED);
  } catch {
    // Private browsing, or storage blocked. The reader picks again; that is all.
    return null;
  }
}

function remember(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(PICKED, id);
    else window.localStorage.removeItem(PICKED);
  } catch {
    /* nothing to remember it with */
  }
}

/**
 * Can this browser offer a wallet at all?
 *
 * With the kit the answer is yes wherever it loads, because Albedo needs
 * nothing installed. It is false only when the kit failed AND there is no
 * Freighter — the one case where "install something" is honest advice.
 */
export async function canConnect(): Promise<boolean> {
  if (await kit()) return true;
  return freighter.isInstalled();
}

/** Opens the picker and returns the address the reader approved. */
export async function connect(): Promise<string> {
  const k = await kit();
  if (!k) return freighter.connect();

  const { address } = await k.authModal();
  if (!address) throw new Error("No wallet address was returned.");
  try {
    remember(k.selectedModule?.productId ?? null);
  } catch {
    /* the address is what matters; the shortcut for next time is a bonus */
  }
  return address;
}

/** The address from a previous visit, or null. Never opens anything. */
export async function silentAddress(): Promise<string | null> {
  const k = await kit();
  if (!k) return freighter.silentAddress();

  const id = picked();
  if (!id) return null;
  try {
    k.setWallet(id);
    const { address } = await k.getAddress();
    return address || null;
  } catch {
    return null;
  }
}

/**
 * Is the wallet on the same network we are?
 *
 * Checked BEFORE signing: on a mismatch the signature is still valid, it just
 * belongs to a different chain, and the money goes somewhere the reader cannot
 * follow.
 */
export async function networkMismatch(): Promise<string | null> {
  const k = await kit();
  if (!k) return freighter.networkMismatch();

  try {
    const d = await k.getNetwork();
    if (d.networkPassphrase && d.networkPassphrase !== networkPassphrase) {
      return `Your wallet is on "${d.network}" but this app is on ${NETWORK}. Switch networks in your wallet.`;
    }
    return null;
  } catch {
    // The wallet told us nothing. Signing will catch a real mismatch.
    return null;
  }
}

export async function sign(xdrString: string, address: string): Promise<string> {
  const k = await kit();
  if (!k) return freighter.sign(xdrString, address);

  const res = await k.signTransaction(xdrString, {
    networkPassphrase,
    address,
  });
  if (!res.signedTxXdr) throw new Error("The wallet returned no signature.");
  return res.signedTxXdr;
}

/** Forgets the choice, so the next connect asks which wallet again. */
export async function forget(): Promise<void> {
  remember(null);
  const k = await kit();
  try {
    await k?.disconnect();
  } catch {
    /* it is already as disconnected as we can make it */
  }
}
