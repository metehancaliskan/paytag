"use client";

import { useIdentity } from "./useIdentity";

/**
 * Signing out, on its own, at the top of Settings.
 *
 * It used to sit in a row of three buttons inside the accounts panel, beside
 * "Submit yourself" and "Claim your escrow" — one destructive-ish action among
 * two invitations. Here it is where a settings page puts it: next to the title,
 * quiet, and nowhere near anything else.
 *
 * Nothing is rendered until there is something to sign out of.
 */
export default function SignOutButton({
  className = "",
}: {
  className?: string;
}) {
  const { identity, signOut } = useIdentity();
  if (identity.status !== "verified") return null;

  return (
    <button
      className={`btn btn-quiet btn-sm ${className}`}
      onClick={() => void signOut()}
    >
      Sign out
    </button>
  );
}
