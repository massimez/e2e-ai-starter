import { z } from "zod";
import { adminPaginationFields, optionalTrimmed } from "../shared";

export const listAdminUsersQuerySchema = z.object({
	...adminPaginationFields,
	role: z.enum(["all", "admin", "user"]).default("all"),
	search: optionalTrimmed(120),
	status: z.enum(["all", "active", "banned"]).default("all"),
	twoFactor: z.enum(["all", "enabled", "disabled"]).default("all"),
});

export const userIdParamSchema = z.object({
	userId: z.string().trim().min(1).max(128),
});

export const userSessionParamSchema = z.object({
	sessionId: z.string().trim().min(1).max(128),
	userId: z.string().trim().min(1).max(128),
});

export const updateUserRoleBodySchema = z.object({
	role: z.enum(["admin", "user"]),
});

export const banUserBodySchema = z.object({
	expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
	reason: z
		.string()
		.trim()
		.min(3, "Ban reason must be at least 3 characters")
		.max(500, "Ban reason must be 500 characters or fewer"),
});

export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;
export type UpdateUserRoleBody = z.infer<typeof updateUserRoleBodySchema>;
export type BanUserBody = z.infer<typeof banUserBodySchema>;
