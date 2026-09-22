import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route protection: redirect to /login when there is no session cookie.
 * The real check happens in the API (every request is authenticated server-side);
 * this only avoids flashing protected pages to signed-out users.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("pt_session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/kits/:path*", "/practice/:path*", "/weak-spots/:path*", "/settings/:path*", "/print/:path*"],
};
