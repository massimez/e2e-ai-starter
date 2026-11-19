import type { NextRequest } from "next/server";
import { getInternalApiUrl } from "@/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailers",
	"transfer-encoding",
	"upgrade",
]);

const STRIPPED_REQUEST_HEADERS = new Set([
	...HOP_BY_HOP_HEADERS,
	"accept-encoding",
	"content-length",
	"host",
]);

const TRAILING_COLON_PATTERN = /:$/u;
const TRAILING_SLASHES_PATTERN = /\/+$/u;

type DuplexRequestInit = RequestInit & { duplex?: "half" };

function buildUpstreamHeaders(request: NextRequest, incomingUrl: URL): Headers {
	const headers = new Headers();
	request.headers.forEach((value, key) => {
		if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) {
			headers.append(key, value);
		}
	});

	const originalHost = request.headers.get("host");
	if (originalHost && !headers.has("x-forwarded-host")) {
		headers.set("x-forwarded-host", originalHost);
	}
	if (!headers.has("x-forwarded-proto")) {
		headers.set(
			"x-forwarded-proto",
			incomingUrl.protocol.replace(TRAILING_COLON_PATTERN, "")
		);
	}

	return headers;
}

function buildDownstreamHeaders(upstreamHeaders: Headers): Headers {
	const headers = new Headers();
	upstreamHeaders.forEach((value, key) => {
		const lowerKey = key.toLowerCase();
		if (HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === "set-cookie") {
			return;
		}
		headers.append(key, value);
	});

	const setCookies =
		typeof upstreamHeaders.getSetCookie === "function"
			? upstreamHeaders.getSetCookie()
			: [];
	if (setCookies.length > 0) {
		for (const cookie of setCookies) {
			headers.append("set-cookie", cookie);
		}
	} else {
		const fallbackCookie = upstreamHeaders.get("set-cookie");
		if (fallbackCookie) {
			headers.append("set-cookie", fallbackCookie);
		}
	}

	return headers;
}

async function proxyApiRequest(request: NextRequest): Promise<Response> {
	const incomingUrl = new URL(request.url);
	const upstreamBase = getInternalApiUrl().replace(
		TRAILING_SLASHES_PATTERN,
		""
	);
	const targetUrl = `${upstreamBase}${incomingUrl.pathname}${incomingUrl.search}`;

	const init: DuplexRequestInit = {
		headers: buildUpstreamHeaders(request, incomingUrl),
		method: request.method,
		redirect: "manual",
		signal: request.signal,
	};

	if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
		init.body = request.body;
		init.duplex = "half";
	}

	try {
		const upstream = await fetch(targetUrl, init);
		return new Response(upstream.body, {
			headers: buildDownstreamHeaders(upstream.headers),
			status: upstream.status,
			statusText: upstream.statusText,
		});
	} catch (error) {
		if (request.signal.aborted) {
			return new Response(null, { status: 499 });
		}
		const message =
			error instanceof Error && error.message
				? `Upstream API request failed: ${error.message}`
				: "Upstream API service is unavailable";
		return Response.json(
			{
				error: {
					message,
					name: "BadGatewayError",
				},
				success: false,
			},
			{ status: 502 }
		);
	}
}

export const GET = proxyApiRequest;
export const POST = proxyApiRequest;
export const PUT = proxyApiRequest;
export const PATCH = proxyApiRequest;
export const DELETE = proxyApiRequest;
export const OPTIONS = proxyApiRequest;
export const HEAD = proxyApiRequest;
