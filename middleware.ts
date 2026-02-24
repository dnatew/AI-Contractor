import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const isAuth = !!token;
  const isLogin = request.nextUrl.pathname.startsWith("/login");

  if (isLogin && isAuth) {
    return NextResponse.redirect(new URL("/projects", request.url));
  }
  if (!isLogin && !isAuth && request.nextUrl.pathname !== "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/projects/:path*", "/login"],
};
