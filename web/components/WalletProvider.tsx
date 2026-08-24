"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as freighter from "@/lib/freighter";

type WalletState = {
  address: string | null;
  installed: boolean | null; // null = we haven't looked yet
  connecting: boolean;
  error: string | null;
  /** Set when the wallet is on a different network than the app. */
  mismatch: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
};

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await freighter.isInstalled();
      if (!alive) return;
      setInstalled(ok);
      if (!ok) return;
      // If access was granted before, connect silently — nobody should have to
      // click again in every new tab.
      const addr = await freighter.silentAddress();
      if (!alive) return;
      if (addr) {
        setAddress(addr);
        // Surface a wrong-network wallet immediately rather than at the moment
        // of signing, when the user has already typed an amount.
        setMismatch(await freighter.networkMismatch());
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const problem = await freighter.networkMismatch();
      setMismatch(problem);
      if (problem) throw new Error(problem);
      setAddress(await freighter.connect());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  /**
   * Forgets the address in this tab only. It cannot revoke the extension's
   * permission — that lives in Freighter — so the UI says "disconnect here"
   * rather than pretending to more authority than it has.
   */
  const disconnect = useCallback(() => {
    setAddress(null);
    setError(null);
    setMismatch(null);
  }, []);

  return (
    <Ctx.Provider
      value={{
        address,
        installed,
        connecting,
        error,
        mismatch,
        connect,
        disconnect,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside a WalletProvider.");
  return v;
}
