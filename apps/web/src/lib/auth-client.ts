"use client";

import { ac, roles } from "@workspace/api/permissions";
import {
	adminClient,
	emailOTPClient,
	inferAdditionalFields,
	organizationClient,
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
			roles,
		}),
		emailOTPClient(),
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

export const {
	organization,
	signIn,
	signOut,
	signUp,
	useActiveOrganization,
	useSession,
} = authClient;
