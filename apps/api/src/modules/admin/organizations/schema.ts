import { z } from "zod";
import { adminPaginationFields, optionalTrimmed } from "../shared";

export const MIN_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024 * 1024; // 10 TB

export const listAdminOrganizationsQuerySchema = z.object({
	...adminPaginationFields,
	search: optionalTrimmed(120),
});

export const organizationIdParamSchema = z.object({
	organizationId: z.string().trim().min(1).max(128),
});

export const updateStorageLimitBodySchema = z.object({
	storageLimitBytes: z
		.number()
		.int("Storage limit must be a whole number of bytes")
		.min(
			MIN_STORAGE_LIMIT_BYTES,
			"Storage limit must be at least 10 MB (10,485,760 bytes)"
		)
		.max(MAX_STORAGE_LIMIT_BYTES, "Storage limit cannot exceed 10 TB"),
});

export type ListAdminOrganizationsQuery = z.infer<
	typeof listAdminOrganizationsQuerySchema
>;
export type UpdateStorageLimitBody = z.infer<
	typeof updateStorageLimitBodySchema
>;
