import { z } from "zod";

export const roleSlugSchema = z
	.string()
	.trim()
	.min(2)
	.max(80)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
		message: "Use lowercase letters, numbers, and hyphens.",
	});

export const permissionKeySchema = z
	.string()
	.trim()
	.regex(/^[a-zA-Z0-9_]+:[a-zA-Z0-9_]+$/u, {
		message: "Permission must use resource:action format.",
	});

export const createOrganizationRoleSchema = z.object({
	description: z.string().trim().max(500).optional(),
	isDefault: z.boolean().optional(),
	name: z.string().trim().min(2).max(120),
	permissions: z.array(permissionKeySchema).default([]),
	slug: roleSlugSchema.optional(),
});

export const updateOrganizationRoleSchema = z.object({
	description: z.string().trim().max(500).nullable().optional(),
	isDefault: z.boolean().optional(),
	name: z.string().trim().min(2).max(120).optional(),
	permissions: z.array(permissionKeySchema).optional(),
	slug: roleSlugSchema.optional(),
});

export const cloneOrganizationRoleSchema = z.object({
	description: z.string().trim().max(500).optional(),
	name: z.string().trim().min(2).max(120),
	slug: roleSlugSchema.optional(),
});

export const updateMemberRoleSchema = z.object({
	roleSlug: roleSlugSchema,
});

export const inviteOrganizationMemberSchema = z.object({
	email: z.string().trim().email().toLowerCase(),
	resend: z.boolean().optional(),
	role: roleSlugSchema,
});

export const roleIdParamSchema = z.object({
	id: z.string().uuid(),
});

export const memberIdParamSchema = z.object({
	memberId: z.string().min(1),
});

export const invitationIdParamSchema = z.object({
	id: z.string().min(1),
});

export type CreateOrganizationRoleInput = z.infer<
	typeof createOrganizationRoleSchema
>;
export type UpdateOrganizationRoleInput = z.infer<
	typeof updateOrganizationRoleSchema
>;
export type CloneOrganizationRoleInput = z.infer<
	typeof cloneOrganizationRoleSchema
>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type InviteOrganizationMemberInput = z.infer<
	typeof inviteOrganizationMemberSchema
>;
