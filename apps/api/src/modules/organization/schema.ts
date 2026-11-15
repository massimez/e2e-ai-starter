import { z } from "zod";

const ORGANIZATION_SLUG_REGEX = /^[a-z0-9-]+$/u;

function isSafeOrganizationLogo(value: string): boolean {
	if (value === "") {
		return true;
	}
	for (let i = 0; i < value.length; i += 1) {
		const code = value.charCodeAt(i);
		// Reject ASCII control characters and backslashes
		if (code <= 31 || code === 127 || code === 92) {
			return false;
		}
	}
	if (value.startsWith("/api/")) {
		return !value.startsWith("//");
	}
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export const transferOwnershipSchema = z.object({
	newOwnerUserId: z.string().trim().min(1, "New owner user ID is required"),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

export const updateOrganizationSchema = z
	.object({
		logo: z
			.string()
			.trim()
			.max(2048)
			.refine(isSafeOrganizationLogo, {
				message:
					"Logo must be an https:// URL, a relative /api/ path, or empty",
			})
			.nullable()
			.optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		name: z
			.string()
			.trim()
			.min(1, "Organization name is required")
			.max(120)
			.optional(),
		slug: z
			.string()
			.trim()
			.toLowerCase()
			.min(1, "Organization slug is required")
			.max(120)
			.regex(
				ORGANIZATION_SLUG_REGEX,
				"Slug may only contain lowercase letters, numbers, and hyphens"
			)
			.optional(),
	})
	.refine(
		(value) =>
			value.name !== undefined ||
			value.slug !== undefined ||
			value.logo !== undefined ||
			value.metadata !== undefined,
		{ message: "At least one field must be provided to update" }
	);

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
