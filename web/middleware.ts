import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_ENABLED, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/config";

/**
 * Keeps the Supabase session alive.
 *
 * An access token lives about an hour. Without something touching it on
 * navigation, a reader who leaves the tab open comes back signed out — and the
 * refresh has to happen where cookies can still be written, which is here and
 * in route handlers, not in a Server Component. `getUser()` is the call that
 * performs the refresh; the response it writes cookies into is what we return.
 */
export async function middleware(request: NextRequest) {
  if (!AUTH_ENABLED) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list) {
        for (const { name, value } of list) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip static assets and images: refreshing a token for a favicon request is
  // pure latency.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
