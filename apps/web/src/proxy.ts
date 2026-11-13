import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAMES = [
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
];

function hasSessionCookie(request: NextRequest): boolean {
	return SESSION_COOKIE_NAMES.some((name) =>
		Boolean(request.cookies.get(name)?.value)
	);
}

/**
 * Optimistic Next.js 16 proxy check for protected dashboard routes.
 * Full cryptographic session verification still runs in server layouts/pages.
 */
export function proxy(request: NextRequest) {
	if (!hasSessionCookie(request)) {
		const targetPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		const signInUrl = new URL("/", request.url);
		signInUrl.searchParams.set("auth", "signin");
		signInUrl.searchParams.set("callbackUrl", targetPath);
		return NextResponse.redirect(signInUrl);
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/dashboard/:path*", "/onboarding"],
};
