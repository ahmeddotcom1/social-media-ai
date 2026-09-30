import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Gate every page and API route behind the login session. Unauthenticated
// page requests are redirected to /login; API requests get a 401.
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except the login page, the login/logout endpoints, and static assets.
  matcher: ["/((?!login|api/auth/|_next/static|_next/image|favicon.ico).*)"],
};
