"use client";

import { ac, roles } from "@workspace/shared/permissions";
import {
	adminClient,
	emailOTPClient,
	inferAdditionalFields,
	organizationClient,
	twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

function getAuthBaseUrl(): string {
	if (typeof window !== "undefined") {
		return window.location.origin;
	}
	return (
		process.env.NEXT_PUBLIC_APP_URL ||
		process.env.NEXT_PUBLIC_API_URL ||
		"http://localhost:3000"
	);
}

export const authClient = createAuthClient({
	baseURL: getAuthBaseUrl(),
	plugins: [
		adminClient(),
		organizationClient({
			ac,
			dynamicAccessControl: {
				enabled: true,
			},
			roles,
		}),
		emailOTPClient(),
		twoFactorClient(),
		inferAdditionalFields({
			user: {
				firstName: {
					required: false,
					type: "string",
				},
				lastName: {
					required: false,
					type: "string",
				},
				locale: {
					required: false,
					type: "string",
				},
			},
		}),
	],
});

export function getSessionImpersonatedBy(
	sessionData: { session?: unknown } | null | undefined
): string | null {
	const value = (
		sessionData?.session as { impersonatedBy?: unknown } | undefined
	)?.impersonatedBy;
	return typeof value === "string" && value.length > 0 ? value : null;
}

export const { signOut, useSession } = authClient;
