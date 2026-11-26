import { headers } from "next/headers";
import { cache } from "react";
import { getInternalApiUrl } from "@/env";

export interface ServerSession {
	session: {
		activeOrganizationId?: string | null;
		id: string;
		impersonatedBy?: string | null;
	};
	user: {
		banExpires?: string | Date | null;
		banned?: boolean | null;
		createdAt: string | Date;
		email: string;
		id: string;
		image?: string | null;
		name: string;
		role?: string | null;
	};
}

export interface ServerOrganization {
	id: string;
	logo?: string | null;
	name: string;
	slug: string;
}

async function fetchInternalAuthJson<T>(
	path: string,
	organizationId?: string
): Promise<T | null> {
	const headerList = await headers();
	const cookieHeader = headerList.get("cookie") ?? "";
	if (!cookieHeader) {
		return null;
	}

	try {
		const res = await fetch(`${getInternalApiUrl()}${path}`, {
			cache: "no-store",
			headers: {
				cookie: cookieHeader,
				...(organizationId ? { "x-organization-id": organizationId } : {}),
			},
			signal: AbortSignal.timeout(5000),
		});

		if (!res.ok) {
			return null;
		}

		return (await res.json()) as T;
	} catch {
		return null;
	}
}

export async function fetchInternalApiData<T>(
	path: string,
	organizationId?: string
): Promise<T | null> {
	const payload = await fetchInternalAuthJson<{ data?: T; success?: boolean }>(
		path,
		organizationId
	);
	return payload?.success && payload.data !== undefined ? payload.data : null;
}

/**
 * Deduplicated per-request session lookup forwarded to the Hono backend API.
 */
export const getServerSession = cache(
	async (): Promise<ServerSession | null> => {
		const data = await fetchInternalAuthJson<ServerSession | null>(
			"/api/auth/get-session"
		);
		return data?.user ? data : null;
	}
);

/**
 * Deduplicated per-request organization membership lookup.
 * Returns `null` when unavailable so transient errors do not trigger false onboarding redirects.
 */
export const getServerOrganizations = cache(
	async (): Promise<ServerOrganization[] | null> => {
		const data = await fetchInternalAuthJson<ServerOrganization[] | unknown>(
			"/api/auth/organization/list"
		);
		return Array.isArray(data) ? (data as ServerOrganization[]) : null;
	}
);

/**
 * Deduplicated lookup for the user's persisted default organization ID.
 */
export const getServerDefaultOrganizationId = cache(
	async (): Promise<string | null> => {
		const payload = await fetchInternalAuthJson<{
			data?: { defaultOrganizationId?: string | null };
		}>("/api/organizations/default");
		return payload?.data?.defaultOrganizationId ?? null;
	}
);
