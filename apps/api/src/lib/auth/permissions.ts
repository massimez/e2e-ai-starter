import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
} from "better-auth/plugins/organization/access";

/**
 * Single source of truth for organization RBAC statements and roles.
 * Spreads Better Auth's built-in `defaultStatements` (`organization`, `member`,
 * `invitation`, `team`, `ac`) and extends them with application resources.
 */
export const statements = {
	...defaultStatements,
	ai: ["read", "execute", "manage"],
	apiKey: ["create", "read", "revoke"],
	audit: ["read", "export"],
	billing: ["read", "manage"],
	document: ["create", "read", "update", "delete"],
	member: [...defaultStatements.member, "invite", "remove"],
	notification: ["read", "manage"],
	project: ["create", "read", "update", "delete"],
	role: ["create", "read", "update", "delete", "assign"],
	setting: ["read", "update"],
	storage: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
	owner: ac.newRole(statements),
	admin: ac.newRole({
		...adminAc.statements,
		ai: ["read", "execute", "manage"],
		apiKey: ["create", "read", "revoke"],
		audit: ["read"],
		billing: ["read"],
		document: ["create", "read", "update", "delete"],
		member: [...adminAc.statements.member, "invite", "remove"],
		notification: ["read", "manage"],
		project: ["create", "read", "update"],
		role: ["read"],
		setting: ["read", "update"],
		storage: ["create", "read", "update", "delete"],
	}),
	member: ac.newRole({
		ai: ["read", "execute"],
		document: ["create", "read", "update"],
		notification: ["read"],
		project: ["create", "read", "update"],
		role: ["read"],
		setting: ["read"],
		storage: ["create", "read"],
	}),
	viewer: ac.newRole({
		ai: ["read"],
		document: ["read"],
		notification: ["read"],
		project: ["read"],
		role: ["read"],
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
		| "Content & Storage"
		| "Operations & Billing"
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
 * UI permission matrix derived directly from `roles` so the Roles Settings UI
 * always stays synchronized with API enforcement.
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
		"delete"
	),
	matrixEntry(
		"Team & Access",
		"Update Member Roles",
		"Promote or demote member roles across the workspace",
		"member",
		"update"
	),
	matrixEntry(
		"Content & Storage",
		"Manage Projects",
		"Create and modify workspace projects",
		"project",
		"create"
	),
	matrixEntry(
		"Content & Storage",
		"Delete Projects",
		"Permanently delete workspace projects",
		"project",
		"delete"
	),
	matrixEntry(
		"Content & Storage",
		"Upload Storage Assets",
		"Upload files via presigned storage URLs",
		"storage",
		"create"
	),
	matrixEntry(
		"Content & Storage",
		"Read Storage Assets",
		"Read and download private workspace files",
		"storage",
		"read"
	),
	matrixEntry(
		"Content & Storage",
		"Delete Storage Assets",
		"Delete uploaded files from workspace storage",
		"storage",
		"delete"
	),
	matrixEntry(
		"Operations & Billing",
		"Read Audit Logs",
		"Inspect workspace audit trails",
		"audit",
		"read"
	),
	matrixEntry(
		"Operations & Billing",
		"Read Billing",
		"View workspace billing details and invoices",
		"billing",
		"read"
	),
	matrixEntry(
		"Operations & Billing",
		"Manage Billing",
		"Manage billing plans and payment methods",
		"billing",
		"manage"
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
			"Manages team members, invitations, projects, storage, and workspace profile.",
		name: "Admin",
	},
	member: {
		description:
			"Standard collaborator who can create and modify projects and upload storage assets.",
		name: "Member",
	},
	owner: {
		description:
			"Full administrative authority over workspace billing, ownership, roles, and deletion.",
		name: "Owner",
	},
	viewer: {
		description:
			"Read-only access across workspace documents, projects, and notifications.",
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

const ALL_PERMISSION_KEYS = PERMISSION_CATALOG_ENTRIES.flatMap(
	({ resource, actions }) => actions.map((action) => `${resource}:${action}`)
);

export const VALID_PERMISSION_KEYS = new Set(ALL_PERMISSION_KEYS);

export const NON_DELEGABLE_PERMISSIONS = new Set(
	ALL_PERMISSION_KEYS.filter(
		(key) =>
			key.startsWith("role:") ||
			key.startsWith("member:") ||
			key === "organization:delete"
	)
);

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
	memberCount: number;
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
