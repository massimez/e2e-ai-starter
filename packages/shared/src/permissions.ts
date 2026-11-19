import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
} from "better-auth/plugins/organization/access";

/**
 * Single source of truth for organization RBAC statements and roles.
 * Extends Better Auth's built-in `defaultStatements` with application resources.
 */
export const statements = {
	...defaultStatements,
	ai: ["read", "execute", "manage"],
	audit: ["read", "export"],
	member: [...defaultStatements.member, "invite", "remove"],
	notification: ["read", "manage"],
	setting: ["read", "update"],
	storage: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
	owner: ac.newRole(statements),
	admin: ac.newRole({
		...adminAc.statements,
		ai: ["read", "execute", "manage"],
		audit: ["read"],
		member: [...adminAc.statements.member, "invite", "remove"],
		notification: ["read", "manage"],
		setting: ["read", "update"],
		storage: ["create", "read", "update", "delete"],
	}),
	member: ac.newRole({
		ai: ["read", "execute"],
		notification: ["read"],
		setting: ["read"],
		storage: ["create", "read"],
	}),
	viewer: ac.newRole({
		ai: ["read"],
		notification: ["read"],
		setting: ["read"],
		storage: ["read"],
	}),
} as const;

export type OrganizationRoleName = keyof typeof roles;

export function roleAllows(
	roleName: OrganizationRoleName,
	resource: string,
	action: string
): boolean {
	const roleStatements = roles[roleName].statements as Record<
		string,
		readonly string[] | undefined
	>;
	return Boolean(roleStatements[resource]?.includes(action));
}

export interface PermissionMatrixEntry {
	admin: boolean;
	category:
		| "Workspace & Governance"
		| "Team & Access"
		| "Storage"
		| "AI & Agents";
	description: string;
	member: boolean;
	owner: boolean;
	resource: string;
	viewer: boolean;
}

function matrixEntry(
	category: PermissionMatrixEntry["category"],
	resource: string,
	description: string,
	statementResource: keyof typeof statements,
	action: string
): PermissionMatrixEntry {
	return {
		admin: roleAllows("admin", statementResource, action),
		category,
		description,
		member: roleAllows("member", statementResource, action),
		owner: roleAllows("owner", statementResource, action),
		resource,
		viewer: roleAllows("viewer", statementResource, action),
	};
}

/**
 * UI permission matrix derived directly from `roles` so Settings stays synchronized
 * with Better Auth RBAC enforcement.
 */
export const PERMISSION_MATRIX: readonly PermissionMatrixEntry[] = [
	matrixEntry(
		"Workspace & Governance",
		"View Workspace Settings",
		"View organization profile, slug, and settings",
		"setting",
		"read"
	),
	matrixEntry(
		"Workspace & Governance",
		"Update Workspace Settings",
		"Modify workspace profile name, slug, and branding",
		"organization",
		"update"
	),
	{
		admin: false,
		category: "Workspace & Governance",
		description:
			"Transfer primary workspace ownership to an active administrator",
		member: false,
		owner: true,
		resource: "Transfer Ownership",
		viewer: false,
	},
	matrixEntry(
		"Workspace & Governance",
		"Delete Workspace",
		"Permanently delete the organization and all associated data",
		"organization",
		"delete"
	),
	matrixEntry(
		"Team & Access",
		"Invite Members",
		"Send workspace invitations and cancel pending invitations",
		"member",
		"invite"
	),
	matrixEntry(
		"Team & Access",
		"Remove Members",
		"Remove members from the organization",
		"member",
		"remove"
	),
	matrixEntry(
		"Team & Access",
		"Update Member Roles",
		"Promote or demote member roles across the workspace",
		"member",
		"update"
	),
	matrixEntry(
		"Team & Access",
		"Manage Custom Roles",
		"Create, update, and delete dynamic organization roles",
		"ac",
		"create"
	),
	matrixEntry(
		"Storage",
		"Upload Storage Assets",
		"Upload files via presigned S3/MinIO storage endpoints",
		"storage",
		"create"
	),
	matrixEntry(
		"Storage",
		"Read Storage Assets",
		"Read and download private workspace files",
		"storage",
		"read"
	),
	matrixEntry(
		"Storage",
		"Delete Storage Assets",
		"Delete uploaded files from workspace storage",
		"storage",
		"delete"
	),
	matrixEntry(
		"AI & Agents",
		"Read AI Assistant",
		"View available AI agents and workspace chat history",
		"ai",
		"read"
	),
	matrixEntry(
		"AI & Agents",
		"Run AI Chat",
		"Chat with AI agents and invoke workspace tools",
		"ai",
		"execute"
	),
	matrixEntry(
		"Workspace & Governance",
		"View Audit Logs",
		"Inspect workspace security and activity audit logs",
		"audit",
		"read"
	),
];

export function parseMemberRoles(role: string | null | undefined): string[] {
	if (!role) {
		return [];
	}
	return role
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

export function isOrgAdminRole(role: string | null | undefined): boolean {
	const parsed = parseMemberRoles(role);
	return parsed.includes("owner") || parsed.includes("admin");
}

export const SYSTEM_ROLE_SLUGS = [
	"owner",
	"admin",
	"member",
	"viewer",
] as const;

export const SYSTEM_ROLE_META: Record<
	OrganizationRoleName,
	{ description: string; name: string }
> = {
	admin: {
		description:
			"Manages team members, invitations, storage, and workspace profile.",
		name: "Admin",
	},
	member: {
		description:
			"Standard collaborator who can execute AI workflows and upload storage assets.",
		name: "Member",
	},
	owner: {
		description:
			"Full administrative authority over workspace ownership, roles, and deletion.",
		name: "Owner",
	},
	viewer: {
		description:
			"Read-only access across AI history, workspace settings, and storage.",
		name: "Viewer",
	},
};

export type PermissionStatementMap = Record<string, readonly string[]>;

export const PERMISSION_CATALOG_ENTRIES = Object.entries(
	statements as PermissionStatementMap
).map(([resource, actions]) => ({
	actions: [...actions],
	resource,
}));

export interface OrganizationPermissionItem {
	action: string;
	key: string;
	resource: string;
}

export interface OrganizationPermissionGroup {
	permissions: OrganizationPermissionItem[];
	resource: string;
}

export interface OrganizationRoleSummary {
	description: string | null;
	id: string;
	isDefault: boolean;
	isSystem: boolean;
	name: string;
	permissions: string[];
	slug: string;
}

export interface EffectiveOrganizationPermissions {
	isOwner: boolean;
	permissions: string[];
	roleSlug: string | null;
}

export function normalizeRoleSlug(role: string | null | undefined): string {
	const parsed = parseMemberRoles(role);
	return (parsed[0] ?? "member").trim().toLowerCase();
}

export function getStaticRolePermissions(roleName: string): string[] {
	if (!Object.hasOwn(roles, roleName)) {
		return [];
	}
	const roleDef = roles[roleName as OrganizationRoleName];
	const result: string[] = [];
	for (const [resource, actions] of Object.entries(
		roleDef.statements as PermissionStatementMap
	)) {
		for (const action of actions) {
			result.push(`${resource}:${action}`);
		}
	}
	return result;
}
