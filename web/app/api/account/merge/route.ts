import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { serverSupabase } from "@/lib/supabase/server";
import {
  MERGE_COOKIE,
  MERGE_TTL_SECONDS,
  mintMergeIntent,
} from "@/lib/merge-intent";

export const runtime = "nodejs";

/**
 * Arms a merge: "join whatever account I sign in as next into this one."
 *
 * It writes one HttpOnly cookie and nothing else — no database write, nothing
 * irreversible. The actual move happens in the OAuth callback, which needs both
 * halves of the proof: this token for the account being kept, and the provider's
 * own answer for the account arriving (`lib/merge-intent.ts`).
 *
 * Ten minutes, and one round trip. DELETE cancels it, because an armed merge
 * that outlives the reader's decision is a surprise waiting for the next
 * sign-in.
 */
export async function POST() {
  const supabase = await serverSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "This deployment has no accounts." },
      { status: 503 },
    );
  }

  // Revalidated with Supabase, not read off the cookie: this token is the only
  // evidence that the browser held this account, so it may not be mintable from
  // a stale one.
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let token: string;
  try {
    token = mintMergeIntent(user.id, Math.floor(Date.now() / 1000));
  } catch {
    return NextResponse.json(
      { error: "This deployment cannot merge accounts." },
      { status: 503 },
    );
  }

  const store = await cookies();
  store.set(MERGE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MERGE_TTL_SECONDS,
  });

  return NextResponse.json({ armed: true, seconds: MERGE_TTL_SECONDS });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(MERGE_COOKIE);
  return NextResponse.json({ armed: false });
}
