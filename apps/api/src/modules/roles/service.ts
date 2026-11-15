import { db } from "@workspace/db";
import {
	member,
	organizationRole,
	organizationRolePermission,
} from "@workspace/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import {
	NON_DELEGABLE_PERMISSIONS,
	normalizeRoleSlug,
	type OrganizationRoleSummary,
	type PermissionStatementMap,
	parseMemberRoles,
	roles,
	SYSTEM_ROLE_META,
	SYSTEM_ROLE_SLUGS,
} from "../../lib/auth/permissions";
import {
	AppError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "../../lib/errors";
import { scopedWhere } from "../../lib/tenant";
import * as invitations from "./invitations";
import * as rolePermissions from "./role-permissions";
import type {
	CloneOrganizationRoleInput,
	CreateOrganizationRoleInput,
	UpdateOrganizationRoleInput,
} from "./schema";

const {
	assertAssignableOrganizationRole,
	assertKnownPermissions,
	assertOwner,
	formatPermissionKey,
	insertRolePermissions,
	invalidateRolePermissionCache,
} = rolePermissions;
type DbExecutor = rolePermissions.DbExecutor;
type PermissionKey = rolePermissions.PermissionKey;

const NON_ALPHANUMERIC_REGEX = /[^a-z0-9]+/gu;
const EDGE_HYPHENS_REGEX = /^-+|-+$/gu;

export function slugifyRoleName(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(NON_ALPHANUMERIC_REGEX, "-")
		.replace(EDGE_HYPHENS_REGEX, "");

	if (slug.length < 2) {
		throw new ValidationError("Role name must produce a valid slug", "name");
	}

	return slug.slice(0, 80);
}

async function clearDefaultRoleFlag(
	executor: DbExecutor,
	organizationId: string
): Promise<void> {
	await executor
		.update(organizationRole)
		.set({ isDefault: false })
		.where(
			and(
				scopedWhere(organizationRole, organizationId),
				eq(organizationRole.isDefault, true)
			)
		);
}

export async function ensureDefaultOrganizationRoles(
	organizationId: string
): Promise<void> {
	await db.transaction(async (tx) => {
		const existingDefault = await tx
			.select({ id: organizationRole.id })
			.from(organizationRole)
			.where(
				and(
					scopedWhere(organizationRole, organizationId),
					eq(organizationRole.isDefault, true)
				)
			)
			.limit(1);

		const hasDefaultAlready = existingDefault.length > 0;

		await Promise.all(
			SYSTEM_ROLE_SLUGS.map(async (roleSlug) => {
				const meta = SYSTEM_ROLE_META[roleSlug];
				const statementsMap = roles[roleSlug]
					.statements as PermissionStatementMap;
				const permissionKeys = Object.entries(statementsMap).flatMap(
					([resource, actions]) =>
						actions.map((action) => formatPermissionKey({ action, resource }))
				);

				const [role] = await tx
					.insert(organizationRole)
					.values({
						description: meta.description,
						isDefault: !hasDefaultAlready && roleSlug === "member",
						isSystem: true,
						name: meta.name,
						organizationId,
						slug: roleSlug,
					})
					.onConflictDoUpdate({
						set: {
							description: meta.description,
							isSystem: true,
							name: meta.name,
						},
						target: [organizationRole.organizationId, organizationRole.slug],
					})
					.returning();

				if (!role) {
					return;
				}

				await tx
					.delete(organizationRolePermission)
					.where(eq(organizationRolePermission.roleId, role.id));
				await insertRolePermissions(tx, role.id, permissionKeys);
			})
		);
	});

	await Promise.all(
		SYSTEM_ROLE_SLUGS.map((roleSlug) =>
			invalidateRolePermissionCache(organizationId, roleSlug)
		)
	);
}

type RoleWithPermissions = typeof organizationRole.$inferSelect & {
	permissions: (typeof organizationRolePermission.$inferSelect)[];
};

function serializeRole(
	role: RoleWithPermissions,
	memberCount: number
): OrganizationRoleSummary {
	return {
		description: role.description,
		id: role.id,
		isDefault: role.isDefault,
		isSystem: role.isSystem,
		memberCount,
		name: role.name,
		permissions: role.permissions.map(formatPermissionKey).sort(),
		slug: role.slug,
	};
}

async function getRoleWithPermissions(
	organizationId: string,
	roleId: string
): Promise<RoleWithPermissions> {
	const role = await db.query.organizationRole.findFirst({
		where: and(
			eq(organizationRole.id, roleId),
			scopedWhere(organizationRole, organizationId)
		),
		with: {
			permissions: true,
		},
	});

	if (!role) {
		throw new NotFoundError("Role");
	}

	return role;
}

async function countMembersForRole(
	organizationId: string,
	roleSlug: string
): Promise<number> {
	const rows = await db
		.select({ role: member.role })
		.from(member)
		.where(scopedWhere(member, organizationId));

	return rows.filter((row) => parseMemberRoles(row.role).includes(roleSlug))
		.length;
}

async function getSerializedRole(
	organizationId: string,
	roleId: string
): Promise<OrganizationRoleSummary> {
	const role = await getRoleWithPermissions(organizationId, roleId);
	const memberCount = await countMembersForRole(organizationId, role.slug);
	return serializeRole(role, memberCount);
}

async function assertRoleSlugAvailable(
	organizationId: string,
	slug: string,
	excludeRoleId?: string
): Promise<void> {
	const existing = await db.query.organizationRole.findFirst({
		columns: { id: true },
		where: and(
			scopedWhere(organizationRole, organizationId),
			eq(organizationRole.slug, slug)
		),
	});

	if (existing && existing.id !== excludeRoleId) {
		throw new ConflictError("A role with this slug already exists", "slug");
	}
}

export async function listOrganizationRoles(
	organizationId: string
): Promise<OrganizationRoleSummary[]> {
	const [orgRoles, members] = await Promise.all([
		db.query.organizationRole.findMany({
			orderBy: [
				desc(organizationRole.isSystem),
				desc(organizationRole.isDefault),
				asc(organizationRole.name),
			],
			where: scopedWhere(organizationRole, organizationId),
			with: {
				permissions: true,
			},
		}),
		db
			.select({ role: member.role })
			.from(member)
			.where(scopedWhere(member, organizationId)),
	]);

	const memberCounts = new Map<string, number>();
	for (const row of members) {
		for (const slug of parseMemberRoles(row.role)) {
			memberCounts.set(slug, (memberCounts.get(slug) ?? 0) + 1);
		}
	}

	return orgRoles.map((role) =>
		serializeRole(role, memberCounts.get(role.slug) ?? 0)
	);
}

async function insertRoleWithPermissions(params: {
	description: string | null;
	isDefault: boolean;
	name: string;
	organizationId: string;
	permissions: PermissionKey[];
	slug: string;
}): Promise<OrganizationRoleSummary> {
	const { description, isDefault, name, organizationId, permissions, slug } =
		params;

	const created = await db.transaction(async (tx) => {
		if (isDefault) {
			await clearDefaultRoleFlag(tx, organizationId);
		}

		const [role] = await tx
			.insert(organizationRole)
			.values({
				description,
				isDefault,
				isSystem: false,
				name,
				organizationId,
				slug,
			})
			.returning();

		if (!role) {
			throw new AppError("Failed to create role", 500, "ROLE_CREATE_FAILED");
		}

		await insertRolePermissions(tx, role.id, permissions);
		return role;
	});

	await invalidateRolePermissionCache(organizationId, slug);
	return await getSerializedRole(organizationId, created.id);
}

export async function createOrganizationRole(
	organizationId: string,
	input: CreateOrganizationRoleInput,
	userId: string
): Promise<OrganizationRoleSummary> {
	await assertOwner(organizationId, userId);

	const slug = input.slug ?? slugifyRoleName(input.name);
	const permissions = assertKnownPermissions(input.permissions);
	await assertRoleSlugAvailable(organizationId, slug);

	return await insertRoleWithPermissions({
		description: input.description ?? null,
		isDefault: input.isDefault ?? false,
		name: input.name,
		organizationId,
		permissions,
		slug,
	});
}

function resolveUpdatedPermissions(
	inputPermissions: string[] | undefined,
	current: RoleWithPermissions
): PermissionKey[] | undefined {
	if (inputPermissions === undefined) {
		return undefined;
	}

	const validated = assertKnownPermissions(inputPermissions);
	if (!current.isSystem) {
		return validated;
	}

	// Retain non-delegable grants originally seeded on system roles (e.g., admin member:*).
	const preservedSystemKeys = current.permissions
		.map(formatPermissionKey)
		.filter((key) => NON_DELEGABLE_PERMISSIONS.has(key));
	return [...new Set([...preservedSystemKeys, ...validated])];
}

export async function updateOrganizationRole(
	organizationId: string,
	roleId: string,
	input: UpdateOrganizationRoleInput,
	userId: string
): Promise<OrganizationRoleSummary> {
	await assertOwner(organizationId, userId);

	const current = await getRoleWithPermissions(organizationId, roleId);

	if (current.slug === "owner") {
		throw new AppError(
			"The owner role is managed by the system",
			403,
			"OWNER_ROLE_LOCKED",
			["roleId"]
		);
	}

	if (current.isDefault && input.isDefault === false) {
		throw new AppError(
			"Select another role as default before removing the default flag",
			400,
			"DEFAULT_ROLE_REQUIRED",
			["isDefault"]
		);
	}

	const nextSlug = input.slug ?? current.slug;
	if (current.isSystem && nextSlug !== current.slug) {
		throw new AppError(
			"System role slugs cannot be changed",
			400,
			"SYSTEM_ROLE_SLUG_LOCKED",
			["slug"]
		);
	}

	if (nextSlug !== current.slug) {
		await assertRoleSlugAvailable(organizationId, nextSlug, roleId);
	}

	const nextPermissions = resolveUpdatedPermissions(input.permissions, current);

	await db.transaction(async (tx) => {
		if (input.isDefault) {
			await clearDefaultRoleFlag(tx, organizationId);
		}

		await tx
			.update(organizationRole)
			.set({
				description:
					input.description === undefined
						? current.description
						: input.description,
				isDefault: input.isDefault ?? current.isDefault,
				name: input.name ?? current.name,
				slug: nextSlug,
			})
			.where(eq(organizationRole.id, roleId));

		if (nextPermissions !== undefined) {
			await tx
				.delete(organizationRolePermission)
				.where(eq(organizationRolePermission.roleId, roleId));
			await insertRolePermissions(tx, roleId, nextPermissions);
		}
	});

	await invalidateRolePermissionCache(organizationId, current.slug);
	if (nextSlug !== current.slug) {
		await invalidateRolePermissionCache(organizationId, nextSlug);
	}

	return await getSerializedRole(organizationId, roleId);
}

export async function deleteOrganizationRole(
	organizationId: string,
	roleId: string,
	userId: string
): Promise<{
	deletedBy: string;
	deletedRoleId: string;
	deletedRoleSlug: string;
}> {
	await assertOwner(organizationId, userId);

	const role = await getRoleWithPermissions(organizationId, roleId);

	if (role.isSystem) {
		throw new AppError(
			"System roles cannot be deleted",
			403,
			"SYSTEM_ROLE_LOCKED",
			["roleId"]
		);
	}

	const memberCount = await countMembersForRole(organizationId, role.slug);
	if (memberCount > 0) {
		throw new AppError(
			"Reassign members before deleting this role",
			409,
			"ROLE_HAS_MEMBERS",
			["roleId"]
		);
	}

	await db
		.delete(organizationRole)
		.where(
			and(
				eq(organizationRole.id, role.id),
				scopedWhere(organizationRole, organizationId)
			)
		);
	await invalidateRolePermissionCache(organizationId, role.slug);

	return {
		deletedBy: userId,
		deletedRoleId: role.id,
		deletedRoleSlug: role.slug,
	};
}

export async function cloneOrganizationRole(
	organizationId: string,
	roleId: string,
	input: CloneOrganizationRoleInput,
	userId: string
): Promise<OrganizationRoleSummary> {
	await assertOwner(organizationId, userId);

	const source = await getRoleWithPermissions(organizationId, roleId);
	const delegablePermissions = source.permissions
		.map(formatPermissionKey)
		.filter((key) => !NON_DELEGABLE_PERMISSIONS.has(key));
	const permissions = assertKnownPermissions(delegablePermissions);

	const slug = input.slug ?? slugifyRoleName(input.name);
	await assertRoleSlugAvailable(organizationId, slug);

	return await insertRoleWithPermissions({
		description: input.description ?? source.description,
		isDefault: false,
		name: input.name,
		organizationId,
		permissions,
		slug,
	});
}

export async function updateOrganizationMemberRole(
	organizationId: string,
	memberId: string,
	roleSlug: string,
	actorUserId: string
) {
	await assertOwner(organizationId, actorUserId);

	const normalizedRoleSlug = normalizeRoleSlug(roleSlug);
	await assertAssignableOrganizationRole(organizationId, normalizedRoleSlug);

	const foundMember = await db.query.member.findFirst({
		where: and(eq(member.id, memberId), scopedWhere(member, organizationId)),
	});

	if (!foundMember) {
		throw new NotFoundError("Member");
	}

	if (foundMember.userId === actorUserId) {
		throw new AppError(
			"You cannot change your own role",
			403,
			"SELF_ROLE_CHANGE_DENIED",
			["memberId"]
		);
	}

	if (parseMemberRoles(foundMember.role).includes("owner")) {
		throw new AppError(
			"Cannot change the role of the organization owner",
			403,
			"OWNER_MODIFICATION_DENIED"
		);
	}

	const [updatedMember] = await db
		.update(member)
		.set({ role: normalizedRoleSlug })
		.where(and(eq(member.id, memberId), scopedWhere(member, organizationId)))
		.returning();

	return updatedMember;
}

export {
	cancelOrganizationInvitation,
	inviteOrganizationMember,
} from "./invitations";
export {
	assertAssignableOrganizationRole,
	assertOrganizationMember,
	getPermissionCatalog,
	getRolePermissionKeys,
	getRoleSlugsWithPermission,
	getUserEffectivePermissions,
	userHasOrganizationPermission,
} from "./role-permissions";

export const rolesService = {
	assertAssignableOrganizationRole:
		rolePermissions.assertAssignableOrganizationRole,
	assertOrganizationMember: rolePermissions.assertOrganizationMember,
	cancelOrganizationInvitation: invitations.cancelOrganizationInvitation,
	cloneOrganizationRole,
	createOrganizationRole,
	deleteOrganizationRole,
	ensureDefaultOrganizationRoles,
	getPermissionCatalog: rolePermissions.getPermissionCatalog,
	getRolePermissionKeys: rolePermissions.getRolePermissionKeys,
	getRoleSlugsWithPermission: rolePermissions.getRoleSlugsWithPermission,
	getUserEffectivePermissions: rolePermissions.getUserEffectivePermissions,
	inviteOrganizationMember: invitations.inviteOrganizationMember,
	listOrganizationRoles,
	updateOrganizationMemberRole,
	updateOrganizationRole,
	userHasOrganizationPermission: rolePermissions.userHasOrganizationPermission,
};
