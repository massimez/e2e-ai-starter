import type { AppType } from "@workspace/api/hc";
import { hc } from "hono/client";
import { getInternalApiUrl } from "@/env";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiErrorIssue {
	code: string;
	message: string;
	path: Array<string | number>;
}

export class ApiError extends Error {
	readonly issues?: ApiErrorIssue[];
	readonly status: number;

	constructor(
		message: string,
		status: number,
		name = "ApiError",
		issues?: ApiErrorIssue[]
	) {
		super(message);
		this.name = name;
		this.status = status;
		this.issues = issues;
	}
}

function getBrowserApiBaseUrl(): string {
	if (typeof window !== "undefined") {
		// Next.js rewrites /api/* -> Hono backend transparently on same origin
		return window.location.origin;
	}
	return getInternalApiUrl();
}

function noop(): void {
	/* intentional no-op fallback */
}

function combineSignals(
	userSignal: AbortSignal | null | undefined,
	timeoutMs: number
): { cleanup: () => void; signal: AbortSignal } {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	if (!userSignal) {
		return { cleanup: noop, signal: timeoutSignal };
	}

	if (typeof AbortSignal.any === "function") {
		return {
			cleanup: noop,
			signal: AbortSignal.any([userSignal, timeoutSignal]),
		};
	}

	const controller = new AbortController();
	const onAbort = () => controller.abort();

	if (userSignal.aborted || timeoutSignal.aborted) {
		controller.abort();
	} else {
		userSignal.addEventListener("abort", onAbort, { once: true });
		timeoutSignal.addEventListener("abort", onAbort, { once: true });
	}

	return {
		cleanup: () => {
			userSignal.removeEventListener("abort", onAbort);
			timeoutSignal.removeEventListener("abort", onAbort);
		},
		signal: controller.signal,
	};
}

export async function fetchWithTimeout(
	input: RequestInfo | URL,
	init?: RequestInit,
	timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
	const { cleanup, signal } = combineSignals(init?.signal, timeoutMs);
	try {
		return await fetch(input, {
			...init,
			signal,
		});
	} finally {
		cleanup();
	}
}

export type TypedApiClient = ReturnType<typeof hc<AppType>>;

export const client: TypedApiClient = hc<AppType>(getBrowserApiBaseUrl(), {
	fetch: (input: RequestInfo | URL, init?: RequestInit) =>
		fetchWithTimeout(input, {
			credentials: "include",
			...init,
		}),
});

export function createServerApiClient(cookieHeader?: string): TypedApiClient {
	return hc<AppType>(getInternalApiUrl(), {
		fetch: (input: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			if (cookieHeader && !headers.has("cookie")) {
				headers.set("cookie", cookieHeader);
			}
			return fetchWithTimeout(input, {
				...init,
				cache: init?.cache ?? "no-store",
				headers,
			});
		},
	});
}

export async function parseApiResponse<T>(response: Response): Promise<T> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}

	const envelope = body as {
		data?: T;
		error?: { issues?: ApiErrorIssue[]; message?: string; name?: string };
		success?: boolean;
	} | null;

	if (!response.ok || envelope?.success === false) {
		throw new ApiError(
			envelope?.error?.message ||
				`Request failed with status ${response.status}`,
			response.status,
			envelope?.error?.name || "ApiError",
			envelope?.error?.issues
		);
	}

	if (envelope && "data" in envelope && envelope.data !== undefined) {
		return envelope.data;
	}

	return body as T;
}

export type { InferRequestType, InferResponseType } from "hono/client";
