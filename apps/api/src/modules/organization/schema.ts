import { z } from "zod";

const ORGANIZATION_SLUG_REGEX = /^[a-z0-9-]+$/u;

export const transferOwnershipSchema = z.object({
	newOwnerUserId: z.string().trim().min(1, "New owner user ID is required"),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

export const updateOrganizationSchema = z
	.object({
		logo: z.string().trim().max(2048).nullable().optional(),
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
