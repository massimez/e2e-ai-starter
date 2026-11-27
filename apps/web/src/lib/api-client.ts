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
		// Next.js proxies /api/* -> Hono backend at runtime on same origin
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

const WORKFLOW_TIMEOUT_MS = 60_000;

function resolveRequestUrl(input: RequestInfo | URL): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

export const client: TypedApiClient = hc<AppType>(getBrowserApiBaseUrl(), {
	fetch: (input: RequestInfo | URL, init?: RequestInit) => {
		const url = resolveRequestUrl(input);
		const timeoutMs = url.includes("/api/ai/workflows/")
			? WORKFLOW_TIMEOUT_MS
			: DEFAULT_TIMEOUT_MS;
		return fetchWithTimeout(
			input,
			{
				credentials: "include",
				...init,
			},
			timeoutMs
		);
	},
});

export async function parseApiResponse<T>(
	response: Pick<Response, "json" | "ok" | "status">
): Promise<T> {
	if (response.ok && response.status === 204) {
		return undefined as T;
	}

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

	if (body === null) {
		throw new ApiError(
			"Received an invalid response from the server",
			response.status,
			"InvalidResponseError"
		);
	}

	if (envelope && "data" in envelope && envelope.data !== undefined) {
		return envelope.data;
	}

	return body as T;
}

export type { InferRequestType, InferResponseType } from "hono/client";
