import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class names, resolving any conflicts.
 *
 * @param inputs - An array of class names to merge.
 * @returns A string of merged and optimized class names.
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/**
 * Safely retrieves a nested property from an object using dot notation.
 */
export function getProperty(obj: unknown, key: string): unknown {
	let current: unknown = obj;
	for (const segment of key.split(".")) {
		if (current === null || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/**
 * Extracts a human-readable error message from a Fetch API Response.
 */
export async function extractErrorMessage(
	res: Response,
	fallbackMessage?: string
): Promise<string> {
	const fallback =
		fallbackMessage || res.statusText || `Request failed (${res.status})`;
	const rawText = await res.text().catch(() => "");
	if (!rawText) {
		return fallback;
	}

	try {
		const errorData = JSON.parse(rawText) as {
			error?:
				| {
						issues?: Array<{ message?: string }>;
						message?: string;
				  }
				| string;
			message?: string;
		};

		if (typeof errorData.error === "object" && errorData.error !== null) {
			const firstIssue = errorData.error.issues?.[0];
			if (firstIssue?.message) {
				return firstIssue.message;
			}
			if (errorData.error.message) {
				return errorData.error.message;
			}
		}

		if (typeof errorData.error === "string" && errorData.error.trim()) {
			return errorData.error;
		}

		if (typeof errorData.message === "string" && errorData.message.trim()) {
			return errorData.message;
		}

		return fallback;
	} catch {
		return rawText.slice(0, 200) || fallback;
	}
}

export function removeNulls<T>(obj: T): T {
	if (Array.isArray(obj)) {
		return obj
			.map((item) => removeNulls(item))
			.filter((item) => item !== null && item !== undefined) as unknown as T;
	}

	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (value === null || value === undefined) {
				continue;
			}
			const cleaned = removeNulls(value);
			if (cleaned !== null && cleaned !== undefined) {
				result[key] = cleaned;
			}
		}
		return result as T;
	}

	return obj;
}

/**
 * Accepts only same-site app-relative paths (starting with `/` and not `//`).
 * Rejects protocol-relative URLs and external hosts to prevent open redirects.
 */
export function sanitizeInternalRedirect(rawUrl: unknown): string | undefined {
	if (typeof rawUrl !== "string") {
		return undefined;
	}
	if (rawUrl.startsWith("/") && !rawUrl.startsWith("//")) {
		return rawUrl;
	}
	return undefined;
}

/**
 * Extracts a safe path+query+hash for same-origin relative or absolute URLs in browser contexts.
 */
export function sanitizeSameOriginPath(rawUrl: unknown): string | null {
	const internal = sanitizeInternalRedirect(rawUrl);
	if (internal) {
		return internal;
	}
	if (typeof rawUrl !== "string" || typeof window === "undefined") {
		return null;
	}
	try {
		const parsed = new URL(rawUrl, window.location.origin);
		if (parsed.origin === window.location.origin) {
			return `${parsed.pathname}${parsed.search}${parsed.hash}`;
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * Resolves a safe same-origin full URL, falling back when external or malformed.
 */
export function resolveSameOriginUrl(
	rawUrl: unknown,
	fallback: string
): string {
	if (typeof window === "undefined") {
		return fallback;
	}
	const safePath = sanitizeSameOriginPath(rawUrl);
	return safePath ? `${window.location.origin}${safePath}` : fallback;
}
