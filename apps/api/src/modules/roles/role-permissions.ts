import { db } from "@workspace/db";
import {
	member,
	organizationRole,
	organizationRolePermission,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { env } from "../../env";
import {
	type EffectiveOrganizationPermissions,
	NON_DELEGABLE_PERMISSIONS,
	normalizeRoleSlug,
	type OrganizationPermissionGroup,
	PERMISSION_CATALOG_ENTRIES,
	parseMemberRoles,
	VALID_PERMISSION_KEYS,
} from "../../lib/auth/permissions";
import { AppError, NotFoundError, ValidationError } from "../../lib/errors";
import { redis } from "../../lib/redis/client";
import { scopedWhere } from "../../lib/tenant";

export type PermissionKey = `${string}:${string}`;
export type DbExecutor = Pick<typeof db, "delete" | "insert" | "update">;

const ROLE_PERMISSION_CACHE_TTL_SECONDS = 60;

function rolePermissionCacheKey(
	organizationId: string,
	roleSlug: string
): string {
	return `${env.REDIS_PREFIX}:org-role-permissions:${organizationId}:${roleSlug}`;
}

export function formatPermissionKey(permission: {
	action: string;
	resource: string;
}): PermissionKey {
	return `${permission.resource}:${permission.action}`;
}

export function splitPermission(permission: string): {
	action: string;
	resource: string;
} {
	const [resource, action] = permission.split(":");
	if (!(resource && action)) {
		throw new ValidationError(
			"Permission must be in format 'resource:action'",
			"permission"
		);
	}
	return { action, resource };
}

export function assertKnownPermissions(permissions: string[]): PermissionKey[] {
	const unique = [...new Set(permissions)];
	const unknown = unique.filter(
		(permission) => !VALID_PERMISSION_KEYS.has(permission)
	);

	if (unknown.length > 0) {
		throw new AppError(
			`Unknown permissions: ${unknown.join(", ")}`,
			400,
			"UNKNOWN_PERMISSION",
			["permissions"]
		);
	}

	const nonDelegable = unique.filter((permission) =>
		NON_DELEGABLE_PERMISSIONS.has(permission)
	);
	if (nonDelegable.length > 0) {
		throw new AppError(
			`Permissions reserved for workspace owners: ${nonDelegable.join(", ")}`,
			403,
			"NON_DELEGABLE_PERMISSION",
			["permissions"]
		);
	}

	return unique as PermissionKey[];
}

export function getPermissionCatalog(): OrganizationPermissionGroup[] {
	return PERMISSION_CATALOG_ENTRIES.flatMap(({ resource, actions }) => {
		const permissions = actions
			.filter(
				(action) => !NON_DELEGABLE_PERMISSIONS.has(`${resource}:${action}`)
			)
			.map((action) => ({
				action,
				key: `${resource}:${action}`,
				resource,
			}));

		return permissions.length > 0 ? [{ permissions, resource }] : [];
	});
}

export async function invalidateRolePermissionCache(
	organizationId: string,
	roleSlug: string
): Promise<void> {
	try {
		await redis.del(rolePermissionCacheKey(organizationId, roleSlug));
	} catch {
		// Authorization must keep working if Redis is briefly unavailable.
	}
}

async function getOrCachePermissionKeys(
	organizationId: string,
	roleSlug: string,
	factory: () => Promise<string[] | null>
): Promise<string[]> {
	const key = rolePermissionCacheKey(organizationId, roleSlug);

	try {
		const raw = await redis.get(key);
		if (raw) {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(entry): entry is string => typeof entry === "string"
				);
			}
		}
	} catch {
		// Fall through to database.
	}

	const fresh = await factory();
	if (fresh === null) {
		return [];
	}

	try {
		await redis.set(
			key,
			JSON.stringify(fresh),
			"EX",
			ROLE_PERMISSION_CACHE_TTL_SECONDS
		);
	} catch {
		// Cache is an optimization only.
	}

	return fresh;
}

export async function insertRolePermissions(
	executor: DbExecutor,
	roleId: string,
	permissions: string[]
): Promise<void> {
	if (permissions.length === 0) {
		return;
	}

	const values = permissions.map((permission) => ({
		...splitPermission(permission),
		roleId,
	}));

	await executor
		.insert(organizationRolePermission)
		.values(values)
		.onConflictDoNothing({
			target: [
				organizationRolePermission.roleId,
				organizationRolePermission.resource,
				organizationRolePermission.action,
			],
		});
}

export async function findRoleBySlug(organizationId: string, roleSlug: string) {
	return await db.query.organizationRole.findFirst({
		where: and(
			scopedWhere(organizationRole, organizationId),
			eq(organizationRole.slug, normalizeRoleSlug(roleSlug))
		),
		with: {
			permissions: true,
		},
	});
}

export async function assertOrganizationMember(
	organizationId: string,
	userId: string
): Promise<{ id: string; role: string }> {
	const foundMember = await db.query.member.findFirst({
		columns: { id: true, role: true },
		where: and(scopedWhere(member, organizationId), eq(member.userId, userId)),
	});

	if (!foundMember) {
		throw new AppError(
			"You are not a member of this organization",
			403,
			"NOT_MEMBER"
		);
	}

	return foundMember;
}

export async function assertOwner(
	organizationId: string,
	userId: string
): Promise<void> {
	const foundMember = await assertOrganizationMember(organizationId, userId);

	if (!parseMemberRoles(foundMember.role).includes("owner")) {
		throw new AppError(
			"Only the organization owner can manage roles",
			403,
			"OWNER_ROLE_REQUIRED"
		);
	}
}

export async function assertAssignableOrganizationRole(
	organizationId: string,
	roleSlug: string
) {
	const normalizedRoleSlug = normalizeRoleSlug(roleSlug);
	if (normalizedRoleSlug === "owner") {
		throw new AppError(
			"Owner role assignment is managed by ownership transfer",
			403,
			"OWNER_ASSIGNMENT_LOCKED",
			["role"]
		);
	}

	const role = await findRoleBySlug(organizationId, normalizedRoleSlug);
	if (!role) {
		throw new NotFoundError("Role", "role");
	}

	return role;
}

export async function getRolePermissionKeys(
	organizationId: string,
	roleSlug: string
): Promise<string[]> {
	const normalizedRoleSlug = normalizeRoleSlug(roleSlug);

	return await getOrCachePermissionKeys(
		organizationId,
		normalizedRoleSlug,
		async () => {
			const role = await findRoleBySlug(organizationId, normalizedRoleSlug);
			return role ? role.permissions.map(formatPermissionKey) : null;
		}
	);
}

export async function getRoleSlugsWithPermission(
	organizationId: string,
	permission: string
): Promise<string[]> {
	if (!VALID_PERMISSION_KEYS.has(permission)) {
		return [];
	}

	const { action, resource } = splitPermission(permission);
	const rows = await db
		.select({ slug: organizationRole.slug })
		.from(organizationRole)
		.innerJoin(
			organizationRolePermission,
			eq(organizationRolePermission.roleId, organizationRole.id)
		)
		.where(
			and(
				scopedWhere(organizationRole, organizationId),
				eq(organizationRolePermission.resource, resource),
				eq(organizationRolePermission.action, action)
			)
		);

	return rows.map((row) => normalizeRoleSlug(row.slug));
}

async function collectRolePermissionKeys(
	organizationId: string,
	assignedSlugs: string[]
): Promise<string[]> {
	const permissionSets = await Promise.all(
		assignedSlugs.map((slug) => getRolePermissionKeys(organizationId, slug))
	);
	return [...new Set(permissionSets.flat())];
}

export async function userHasOrganizationPermission(params: {
	memberRole?: string | null;
	organizationId: string;
	permission: string;
	userId: string;
}): Promise<boolean> {
	const { memberRole, organizationId, permission, userId } = params;

	if (!VALID_PERMISSION_KEYS.has(permission)) {
		return false;
	}

	let rawRole = memberRole;
	if (!rawRole) {
		const foundMember = await db.query.member.findFirst({
			columns: { role: true },
			where: and(
				scopedWhere(member, organizationId),
				eq(member.userId, userId)
			),
		});

		if (!foundMember) {
			return false;
		}
		rawRole = foundMember.role;
	}

	const assignedSlugs = parseMemberRoles(rawRole);
	if (assignedSlugs.includes("owner")) {
		return true;
	}

	const keys = await collectRolePermissionKeys(organizationId, assignedSlugs);
	return keys.includes(permission);
}

export async function getUserEffectivePermissions(
	organizationId: string,
	userId: string
): Promise<EffectiveOrganizationPermissions> {
	const foundMember = await assertOrganizationMember(organizationId, userId);

	const assignedSlugs = parseMemberRoles(foundMember.role);
	if (assignedSlugs.includes("owner")) {
		return {
			isOwner: true,
			permissions: [...VALID_PERMISSION_KEYS].sort(),
			roleSlug: "owner",
		};
	}

	const keys = await collectRolePermissionKeys(organizationId, assignedSlugs);
	return {
		isOwner: false,
		permissions: keys.sort(),
		roleSlug: assignedSlugs[0] ?? null,
	};
}
