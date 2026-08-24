import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AUTH_ENABLED, SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";

/**
 * The `server-only` import above is load-bearing: everything in this file
 * either reads cookies or holds the service role key, and a build that
 * accidentally pulls it into a client component should fail loudly rather
 * than ship it to a browser.
 */

/**
 * Supabase client bound to the request's cookies — this is what knows who is
 * signed in. Reads the session; also writes refreshed cookies when the access
 * token is rotated.
 */
export async function serverSupabase() {
  if (!AUTH_ENABLED) return null;
  const store = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Harmless: middleware and route handlers do the actual refreshing.
        }
      },
    },
  });
}

/**
 * Service role client. Bypasses row level security completely, which is why
 * it exists and why it never leaves the server.
 *
 * It has exactly one job: writing the `identities` row after OAuth. That write
 * must be impossible for a user to make on their own — a user who could insert
 * their own identity row could claim any handle they liked, and verification
 * would mean nothing.
 */
export function adminSupabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!AUTH_ENABLED || !key) return null;

  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
