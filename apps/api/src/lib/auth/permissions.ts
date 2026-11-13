import { createAccessControl } from "better-auth/plugins/access";
import {
	adminAc,
	defaultStatements,
	ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Single source of truth for organization RBAC statements and roles.
 * Spreads Better Auth's built-in `member` statements (`create`, `update`, `delete`)
 * so built-in endpoints (`removeMember`, `updateMemberRole`) function alongside custom actions.
 */
export const statements = {
	...defaultStatements,
	ai: ["read", "execute", "manage"],
	apiKey: ["create", "read", "revoke"],
	audit: ["read", "export"],
	billing: ["read", "manage"],
	document: ["create", "read", "update", "delete"],
	member: [...defaultStatements.member, "invite", "remove", "update_role"],
	notification: ["read", "manage"],
	project: ["create", "read", "update", "delete"],
	role: ["create", "read", "update", "delete", "assign"],
	setting: ["read", "update"],
	storage: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
	owner: ac.newRole({
		...ownerAc.statements,
		ai: ["read", "execute", "manage"],
		apiKey: ["create", "read", "revoke"],
		audit: ["read", "export"],
		billing: ["read", "manage"],
		document: ["create", "read", "update", "delete"],
		member: [...ownerAc.statements.member, "invite", "remove", "update_role"],
		notification: ["read", "manage"],
		project: ["create", "read", "update", "delete"],
		role: ["create", "read", "update", "delete", "assign"],
		setting: ["read", "update"],
		storage: ["create", "read", "update", "delete"],
	}),
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
		role: ["create", "read", "update"],
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

export type PermissionResource = keyof typeof statements;

export function roleAllows(
	roleName: OrganizationRoleName,
	resource: string,
	action: string
): boolean {
	const roleStatements = roles[roleName].statements as Record<
		string,
		readonly string[] | undefined
	>;
	const actions = roleStatements[resource];
	return Boolean(actions?.includes(action));
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

/**
 * UI permission matrix derived directly from `roles` so the Roles Settings UI
 * always stays synchronized with API enforcement.
 */
export const PERMISSION_MATRIX: readonly PermissionMatrixEntry[] = [
	{
		category: "Workspace & Governance",
		description: "View organization profile, slug, and settings",
		resource: "View Workspace Settings",
		viewer: roleAllows("viewer", "setting", "read"),
		member: roleAllows("member", "setting", "read"),
		admin: roleAllows("admin", "setting", "read"),
		owner: roleAllows("owner", "setting", "read"),
	},
	{
		category: "Workspace & Governance",
		description: "Modify workspace profile name, slug, and branding",
		resource: "Update Workspace Settings",
		viewer: roleAllows("viewer", "organization", "update"),
		member: roleAllows("member", "organization", "update"),
		admin: roleAllows("admin", "organization", "update"),
		owner: roleAllows("owner", "organization", "update"),
	},
	{
		category: "Workspace & Governance",
		description:
			"Transfer primary workspace ownership to an active administrator",
		resource: "Transfer Ownership",
		viewer: false,
		member: false,
		admin: false,
		owner: true,
	},
	{
		category: "Workspace & Governance",
		description: "Permanently delete the organization and all associated data",
		resource: "Delete Workspace",
		viewer: roleAllows("viewer", "organization", "delete"),
		member: roleAllows("member", "organization", "delete"),
		admin: roleAllows("admin", "organization", "delete"),
		owner: roleAllows("owner", "organization", "delete"),
	},
	{
		category: "Team & Access",
		description: "Send workspace invitations and cancel pending invitations",
		resource: "Invite Members",
		viewer: roleAllows("viewer", "member", "invite"),
		member: roleAllows("member", "member", "invite"),
		admin: roleAllows("admin", "member", "invite"),
		owner: roleAllows("owner", "member", "invite"),
	},
	{
		category: "Team & Access",
		description: "Remove members from the organization",
		resource: "Remove Members",
		viewer: roleAllows("viewer", "member", "delete"),
		member: roleAllows("member", "member", "delete"),
		admin: roleAllows("admin", "member", "delete"),
		owner: roleAllows("owner", "member", "delete"),
	},
	{
		category: "Team & Access",
		description: "Promote or demote member roles across the workspace",
		resource: "Update Member Roles",
		viewer: roleAllows("viewer", "member", "update"),
		member: roleAllows("member", "member", "update"),
		admin: roleAllows("admin", "member", "update"),
		owner: roleAllows("owner", "member", "update"),
	},
	{
		category: "Content & Storage",
		description: "Create and modify workspace projects",
		resource: "Manage Projects",
		viewer: roleAllows("viewer", "project", "create"),
		member: roleAllows("member", "project", "create"),
		admin: roleAllows("admin", "project", "create"),
		owner: roleAllows("owner", "project", "create"),
	},
	{
		category: "Content & Storage",
		description: "Permanently delete workspace projects",
		resource: "Delete Projects",
		viewer: roleAllows("viewer", "project", "delete"),
		member: roleAllows("member", "project", "delete"),
		admin: roleAllows("admin", "project", "delete"),
		owner: roleAllows("owner", "project", "delete"),
	},
	{
		category: "Content & Storage",
		description: "Upload files via presigned storage URLs",
		resource: "Upload Storage Assets",
		viewer: roleAllows("viewer", "storage", "create"),
		member: roleAllows("member", "storage", "create"),
		admin: roleAllows("admin", "storage", "create"),
		owner: roleAllows("owner", "storage", "create"),
	},
	{
		category: "Content & Storage",
		description: "Read and download private workspace files",
		resource: "Read Storage Assets",
		viewer: roleAllows("viewer", "storage", "read"),
		member: roleAllows("member", "storage", "read"),
		admin: roleAllows("admin", "storage", "read"),
		owner: roleAllows("owner", "storage", "read"),
	},
	{
		category: "Content & Storage",
		description: "Delete uploaded files from workspace storage",
		resource: "Delete Storage Assets",
		viewer: roleAllows("viewer", "storage", "delete"),
		member: roleAllows("member", "storage", "delete"),
		admin: roleAllows("admin", "storage", "delete"),
		owner: roleAllows("owner", "storage", "delete"),
	},
	{
		category: "Operations & Billing",
		description: "Inspect workspace audit trails",
		resource: "Read Audit Logs",
		viewer: roleAllows("viewer", "audit", "read"),
		member: roleAllows("member", "audit", "read"),
		admin: roleAllows("admin", "audit", "read"),
		owner: roleAllows("owner", "audit", "read"),
	},
	{
		category: "Operations & Billing",
		description: "View workspace billing details and invoices",
		resource: "Read Billing",
		viewer: roleAllows("viewer", "billing", "read"),
		member: roleAllows("member", "billing", "read"),
		admin: roleAllows("admin", "billing", "read"),
		owner: roleAllows("owner", "billing", "read"),
	},
	{
		category: "Operations & Billing",
		description: "Manage billing plans and payment methods",
		resource: "Manage Billing",
		viewer: roleAllows("viewer", "billing", "manage"),
		member: roleAllows("member", "billing", "manage"),
		admin: roleAllows("admin", "billing", "manage"),
		owner: roleAllows("owner", "billing", "manage"),
	},
	{
		category: "AI & Agents",
		description: "View available AI agents and workspace chat history",
		resource: "Read AI Assistant",
		viewer: roleAllows("viewer", "ai", "read"),
		member: roleAllows("member", "ai", "read"),
		admin: roleAllows("admin", "ai", "read"),
		owner: roleAllows("owner", "ai", "read"),
	},
	{
		category: "AI & Agents",
		description: "Chat with AI agents and invoke workspace tools",
		resource: "Run AI Chat",
		viewer: roleAllows("viewer", "ai", "execute"),
		member: roleAllows("member", "ai", "execute"),
		admin: roleAllows("admin", "ai", "execute"),
		owner: roleAllows("owner", "ai", "execute"),
	},
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
