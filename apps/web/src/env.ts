import { z } from "zod";

const optionalUrlSchema = z
	.string()
	.optional()
	.default("")
	.refine(
		(val) => {
			if (!val) {
				return true;
			}
			try {
				const parsed = new URL(val);
				return parsed.protocol === "http:" || parsed.protocol === "https:";
			} catch {
				return false;
			}
		},
		{ message: "Must be a valid http(s) URL" }
	);

const serverWebEnvSchema = z.object({
	INTERNAL_API_URL: optionalUrlSchema,
	NEXT_PUBLIC_API_URL: optionalUrlSchema,
	NEXT_PUBLIC_APP_URL: optionalUrlSchema,
	NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: z
		.enum(["true", "false"])
		.optional()
		.default("false"),
	NEXT_PUBLIC_STORAGE_ORIGIN: optionalUrlSchema,
	NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional().default(""),
});

export type ServerWebEnv = z.infer<typeof serverWebEnvSchema>;

/**
 * Browser-safe environment values inlined via static `process.env.NEXT_PUBLIC_*` reads.
 */
export const publicWebEnv = {
	apiUrl: process.env.NEXT_PUBLIC_API_URL || "",
	appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
	googleAuthEnabled: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
	vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "",
} as const;

export function parseServerWebEnv(
	input: Record<string, string | undefined> = process.env
): ServerWebEnv {
	return serverWebEnvSchema.parse(input);
}

export function getInternalApiUrl(): string {
	return (
		process.env.INTERNAL_API_URL ||
		process.env.NEXT_PUBLIC_API_URL ||
		"http://localhost:3001"
	);
}
