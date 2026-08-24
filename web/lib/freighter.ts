// Freighter wallet bridge.
//
// Freighter is a browser extension: it exists only on the client, and only if
// the extension is installed. So every call goes through a dynamic import —
// otherwise `window` gets looked up during server rendering and the build
// breaks.

import { networkPassphrase } from "./stellar";
import { NETWORK } from "./config";

async function api() {
  return await import("@stellar/freighter-api");
}

export async function isInstalled(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { isConnected } = await api();
    const res = await isConnected();
    return Boolean(res.isConnected);
  } catch {
    return false;
  }
}

/** Returns the address the user approved; opens the extension if they haven't. */
export async function connect(): Promise<string> {
  const { requestAccess } = await api();
  const res = await requestAccess();
  if (res.error) throw new Error(String(res.error));
  if (!res.address) throw new Error("No wallet address was returned.");
  return res.address;
}

/** Returns the address silently if access was already granted, else null. */
export async function silentAddress(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { isAllowed, getAddress } = await api();
    const allowed = await isAllowed();
    if (!allowed.isAllowed) return null;
    const res = await getAddress();
    if (res.error || !res.address) return null;
    return res.address;
  } catch {
    return null;
  }
}

/**
 * Is the wallet on the same network we are?
 *
 * On a mismatch the signature is still valid but goes to a different network —
 * the user sends money to the wrong chain. So we check BEFORE signing.
 */
export async function networkMismatch(): Promise<string | null> {
  const { getNetworkDetails } = await api();
  const d = await getNetworkDetails();
  if (d.error) return null; // extension told us nothing; signing will catch it
  if (d.networkPassphrase && d.networkPassphrase !== networkPassphrase) {
    return `Your wallet is on "${d.network}" but this app is on ${NETWORK}. Switch networks in Freighter.`;
  }
  return null;
}

export async function sign(xdrString: string, address: string): Promise<string> {
  const { signTransaction } = await api();
  const res = await signTransaction(xdrString, { networkPassphrase, address });
  if (res.error) throw new Error(String(res.error));
  return res.signedTxXdr;
}
