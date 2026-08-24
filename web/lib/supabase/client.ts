import { createBrowserClient } from "@supabase/ssr";
import { AUTH_ENABLED, SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";

/**
 * Browser Supabase client, or null when this deployment has no Supabase
 * project configured.
 *
 * Returning null rather than throwing is the point: the send flow does not
 * need an account, so a missing Supabase project should disable claiming, not
 * break the app. Every caller has to handle the null, which is exactly the
 * reminder needed.
 */
export function browserSupabase() {
  if (!AUTH_ENABLED) return null;
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
