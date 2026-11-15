import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAMES = [
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
];

function extractOrigin(rawUrl: string | undefined): string | null {
	if (!rawUrl) {
		return null;
	}
	try {
		return new URL(rawUrl).origin;
	} catch {
		return null;
	}
}

function buildContentSecurityPolicy(nonce: string, prodEnv: boolean): string {
	const connectSources = new Set<string>(["'self'"]);
	const imageSources = new Set<string>([
		"'self'",
		"data:",
		"blob:",
		"https://lh3.googleusercontent.com",
	]);

	for (const candidate of [
		process.env.NEXT_PUBLIC_API_URL,
		process.env.NEXT_PUBLIC_STORAGE_ORIGIN,
		process.env.S3_ENDPOINT,
		process.env.S3_PUBLIC_URL,
	]) {
		const origin = extractOrigin(candidate);
		if (origin) {
			connectSources.add(origin);
			imageSources.add(origin);
		}
	}

	if (!prodEnv) {
		connectSources.add("http://localhost:3001");
		connectSources.add("http://localhost:9000");
		connectSources.add("http://127.0.0.1:9000");
		imageSources.add("http://localhost:9000");
		imageSources.add("http://127.0.0.1:9000");
	}

	const scriptDirectives = prodEnv
		? `'self' 'nonce-${nonce}' 'strict-dynamic'`
		: "'self' 'unsafe-inline' 'unsafe-eval'";

	return [
		"default-src 'self'",
		`script-src ${scriptDirectives}`,
		"style-src 'self' 'unsafe-inline'",
		`img-src ${Array.from(imageSources).join(" ")}`,
		"font-src 'self' data:",
		`connect-src ${Array.from(connectSources).join(" ")}`,
		"worker-src 'self'",
		"manifest-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");
}

function hasSessionCookie(request: NextRequest): boolean {
	return SESSION_COOKIE_NAMES.some((name) =>
		Boolean(request.cookies.get(name)?.value)
	);
}

function isProtectedRoute(pathname: string): boolean {
	return (
		pathname === "/dashboard" ||
		pathname.startsWith("/dashboard/") ||
		pathname === "/onboarding" ||
		pathname.startsWith("/onboarding/")
	);
}

/**
 * Optimistic Next.js 16 proxy check for protected routes + per-request nonce CSP.
 * Full cryptographic session verification still runs in server layouts/pages.
 */
export function proxy(request: NextRequest) {
	const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
	const cspHeader = buildContentSecurityPolicy(
		nonce,
		process.env.NODE_ENV === "production"
	);

	if (
		isProtectedRoute(request.nextUrl.pathname) &&
		!hasSessionCookie(request)
	) {
		const targetPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		const signInUrl = new URL("/", request.url);
		signInUrl.searchParams.set("auth", "signin");
		signInUrl.searchParams.set("callbackUrl", targetPath);
		const response = NextResponse.redirect(signInUrl);
		response.headers.set("Content-Security-Policy", cspHeader);
		return response;
	}

	const requestHeaders = new Headers(request.headers);
	requestHeaders.set("x-nonce", nonce);
	requestHeaders.set("Content-Security-Policy", cspHeader);

	const response = NextResponse.next({
		request: {
			headers: requestHeaders,
		},
	});
	response.headers.set("Content-Security-Policy", cspHeader);
	return response;
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
	],
};
