import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE, verifySession } from "@/lib/session"

/**
 * Route protection. Runs on the Edge runtime, so it only ever verifies the JWT
 * with `jose` — no bcrypt, no database. Password checking happens exclusively
 * in the Node-runtime login route handler.
 */

const LOGIN_PATH = "/login"

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  const isLoginPage = pathname === LOGIN_PATH

  // Already signed in and heading to /login → send to the dashboard.
  if (isLoginPage) {
    if (session) {
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  // Any other matched route requires a valid session.
  if (!session) {
    const url = new URL(LOGIN_PATH, req.url)
    url.searchParams.set("next", pathname + search)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  /**
   * Pages only. Next internals and static assets are excluded for the obvious
   * reason; `/api` is excluded for a subtler one.
   *
   * Redirecting an unauthenticated API call to /login answers a `fetch` with
   * the login page's HTML, which then fails to parse as JSON — so an expired
   * session, the common case, would surface in the UI as a parse error rather
   * than "you have been signed out". The route handlers guard themselves with
   * requireUser/requireAdmin and return a proper 401 or 403 as JSON, which the
   * data layer can act on.
   */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)",
  ],
}
