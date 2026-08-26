"use client";

import type { ReactNode } from "react";
import { IdentityContext, useIdentityState } from "./useIdentity";

/**
 * The one place the signed-in identity is fetched.
 *
 * It wraps the app layout, so every page behind "Open app" reads the same
 * answer from the same request. `useIdentity()` throws without it, which is the
 * point: a component that fetches its own copy is a component that can
 * disagree with the header.
 */
export default function IdentityProvider({
  children,
}: {
  children: ReactNode;
}) {
  const api = useIdentityState();
  return (
    <IdentityContext.Provider value={api}>{children}</IdentityContext.Provider>
  );
}
