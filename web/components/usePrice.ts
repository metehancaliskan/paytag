"use client";

import { useEffect, useState } from "react";
import type { Price } from "@/lib/price";

export type PriceState =
  | { status: "loading" }
  | { status: "ready"; price: Price }
  | { status: "unavailable"; reason: string };

/**
 * The XLM/USD rate, from our own cached endpoint.
 *
 * Three states, all of them rendered: while it loads the dollar field waits,
 * and when it fails the form says so and switches to entering XLM directly.
 * A price that quietly resolves to zero would turn "$25" into "0 XLM", which
 * is the kind of silent wrongness money software cannot afford.
 */
export function usePrice(): PriceState {
  const [state, setState] = useState<PriceState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/price");
        const body = await res.json();
        if (!alive) return;
        if (!res.ok || typeof body.usdPerXlm !== "number") {
          setState({
            status: "unavailable",
            reason: body.error ?? "no rate available",
          });
          return;
        }
        setState({ status: "ready", price: body as Price });
      } catch (e) {
        if (alive) {
          setState({
            status: "unavailable",
            reason: e instanceof Error ? e.message : "no rate available",
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
