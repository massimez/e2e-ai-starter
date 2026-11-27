"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type EffectiveOrganizationPermissions,
	getStaticRolePermissions,
	normalizeRoleSlug,
	type OrganizationRoleName,
	type OrganizationRoleSummary,
	PERMISSION_CATALOG_ENTRIES,
	parseMemberRoles,
	SYSTEM_ROLE_META,
	SYSTEM_ROLE_SLUGS,
} from "@workspace/shared/permissions";
import { toast } from "sonner";
import { authClient } from "./auth-client";

interface DynamicRoleRecord {
	createdAt?: Date | string;
	id: string;
	organizationId: string;
	permission: Record<string, string[]>;
	role: string;
	updatedAt?: Date | string;
}

export const organizationKeys = {
	all: ["organizations"] as const,
	detail: (organizationId: string) =>
		[...organizationKeys.all, "detail", organizationId] as const,
	myPermissions: (organizationId: string, roleKey: string) =>
		[...organizationKeys.all, "roles", organizationId, "me", roleKey] as const,
	roles: (organizationId: string) =>
		[...organizationKeys.all, "roles", organizationId] as const,
	wallet: (organizationId: string, userId?: string) =>
		userId
			? ([...organizationKeys.all, "wallet", organizationId, userId] as const)
			: ([...organizationKeys.all, "wallet", organizationId] as const),
};

export function unwrapAuthResult<T>(
	res: { data?: T; error?: { message?: string } | null },
	fallback: string
): T {
	if (res.error) {
		throw new Error(res.error.message || fallback);
	}
	return res.data as T;
}

const ROLE_SLUG_SEPARATOR_REGEX = /[-_]+/u;
const SYSTEM_ROLE_SET = new Set<string>(SYSTEM_ROLE_SLUGS);

function formatCustomRoleName(slug: string): string {
	return slug
		.split(ROLE_SLUG_SEPARATOR_REGEX)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function permissionMapToKeys(
	map: Record<string, readonly string[] | undefined> | null | undefined
): string[] {
	if (!map) {
		return [];
	}
	const keys: string[] = [];
	for (const [resource, actions] of Object.entries(map)) {
		if (!actions) {
			continue;
		}
		for (const action of actions) {
			keys.push(`${resource}:${action}`);
		}
	}
	return keys;
}

function permissionKeysToMap(
	keys: readonly string[]
): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const key of keys) {
		const [resource, action] = key.split(":");
		if (!(resource && action)) {
			continue;
		}
		const existing = result[resource] ?? [];
		if (!existing.includes(action)) {
			result[resource] = [...existing, action];
		}
	}
	return result;
}

function getSystemRolesList(): OrganizationRoleSummary[] {
	return SYSTEM_ROLE_SLUGS.map((slug: OrganizationRoleName) => ({
		description: SYSTEM_ROLE_META[slug].description,
		id: `system:${slug}`,
		isDefault: slug === "member",
		isSystem: true,
		name: SYSTEM_ROLE_META[slug].name,
		permissions: getStaticRolePermissions(slug),
		slug,
	}));
}

function mapDynamicRoleToSummary(
	record: DynamicRoleRecord
): OrganizationRoleSummary {
	return {
		description: null,
		id: record.id,
		isDefault: false,
		isSystem: false,
		name: formatCustomRoleName(record.role),
		permissions: permissionMapToKeys(record.permission),
		slug: record.role,
	};
}

async function resolveCustomRolePermissions(
	organizationId: string,
	roleSlug: string
): Promise<string[]> {
	const roleResult = await authClient.organization.getRole({
		query: { organizationId, roleName: roleSlug },
	});
	if (!roleResult.error && roleResult.data) {
		const record = roleResult.data as unknown as DynamicRoleRecord;
		return permissionMapToKeys(record.permission);
	}

	const checks = await Promise.all(
		PERMISSION_CATALOG_ENTRIES.flatMap((entry) =>
			entry.actions.map(async (action) => {
				const res = await authClient.organization.hasPermission({
					organizationId,
					permissions: { [entry.resource]: [action] } as never,
				});
				return res.data?.success ? `${entry.resource}:${action}` : null;
			})
		)
	);
	return checks.filter((key): key is string => key !== null);
}

export function useMyOrganizationPermissions(
	organizationId?: string,
	memberRole?: string | null
) {
	const roleSlug = normalizeRoleSlug(memberRole);
	const memberRoles = parseMemberRoles(memberRole).map((role) =>
		role.trim().toLowerCase()
	);

	return useQuery<EffectiveOrganizationPermissions | null>({
		enabled: Boolean(organizationId && memberRole),
		queryFn: async () => {
			if (!(organizationId && memberRole)) {
				return null;
			}
			const isOwner = memberRoles.includes("owner");
			const permissionSet = new Set<string>();

			await Promise.all(
				memberRoles.map(async (slug) => {
					const perms = SYSTEM_ROLE_SET.has(slug)
						? getStaticRolePermissions(slug)
						: await resolveCustomRolePermissions(organizationId, slug);
					for (const perm of perms) {
						permissionSet.add(perm);
					}
				})
			);

			return {
				isOwner,
				permissions: Array.from(permissionSet),
				roleSlug,
			};
		},
		queryKey: organizationKeys.myPermissions(
			organizationId ?? "none",
			memberRole ?? "none"
		),
		staleTime: 30_000,
	});
}

export function useOrganizationRoles(organizationId?: string) {
	return useQuery<OrganizationRoleSummary[]>({
		enabled: Boolean(organizationId),
		queryFn: async () => {
			const systemRoles = getSystemRolesList();
			if (!organizationId) {
				return systemRoles;
			}

			const res = await authClient.organization.listRoles({
				query: { organizationId },
			});
			if (res.error || !Array.isArray(res.data)) {
				return systemRoles;
			}

			const customRoles = (res.data as unknown as DynamicRoleRecord[]).map(
				mapDynamicRoleToSummary
			);
			return [...systemRoles, ...customRoles];
		},
		queryKey: organizationKeys.roles(organizationId ?? "none"),
		staleTime: 30_000,
	});
}

function useInvalidateOrganizationRoles(organizationId?: string) {
	const queryClient = useQueryClient();
	return async () => {
		if (!organizationId) {
			await queryClient.invalidateQueries({ queryKey: organizationKeys.all });
			return;
		}
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: organizationKeys.roles(organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: [...organizationKeys.all, "roles", organizationId, "me"],
			}),
			queryClient.invalidateQueries({
				queryKey: organizationKeys.detail(organizationId),
			}),
		]);
	};
}

function useOrganizationRoleMutation<TData, TVariables>(params: {
	errorFallback: string;
	mutationFn: (orgId: string, variables: TVariables) => Promise<TData>;
	organizationId?: string;
	successMessage: (data: TData) => string;
}) {
	const invalidateRoles = useInvalidateOrganizationRoles(params.organizationId);
	return useMutation({
		mutationFn: async (variables: TVariables) => {
			if (!params.organizationId) {
				throw new Error("No active organization selected");
			}
			return await params.mutationFn(params.organizationId, variables);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : params.errorFallback
			);
		},
		onSuccess: async (data) => {
			await invalidateRoles();
			toast.success(params.successMessage(data));
		},
	});
}

export function useCreateOrganizationRole(organizationId?: string) {
	return useOrganizationRoleMutation({
		errorFallback: "Failed to create role",
		mutationFn: async (
			orgId,
			input: { permissions: string[]; slug: string }
		) => {
			const res = await authClient.organization.createRole({
				organizationId: orgId,
				permission: permissionKeysToMap(input.permissions),
				role: input.slug,
			});
			const data = unwrapAuthResult(
				res,
				"Failed to create role"
			) as unknown as {
				id?: string;
				role?: string;
			};
			return {
				id: data.id ?? "",
				name: formatCustomRoleName(data.role ?? input.slug),
				slug: data.role ?? input.slug,
			};
		},
		organizationId,
		successMessage: (role) => `Role "${role.name}" created`,
	});
}

export function useUpdateOrganizationRole(organizationId?: string) {
	return useOrganizationRoleMutation({
		errorFallback: "Failed to update role",
		mutationFn: async (
			orgId,
			{
				id,
				permissions,
				slug,
			}: {
				id: string;
				permissions?: string[];
				slug?: string;
			}
		) => {
			const res = await authClient.organization.updateRole({
				data: {
					...(permissions
						? { permission: permissionKeysToMap(permissions) }
						: {}),
					...(slug ? { roleName: slug } : {}),
				},
				organizationId: orgId,
				roleId: id,
			});
			const data = unwrapAuthResult(
				res,
				"Failed to update role"
			) as unknown as { roleData?: { role?: string } };
			const updatedSlug = data.roleData?.role ?? slug ?? "role";
			return {
				id,
				name: formatCustomRoleName(updatedSlug),
				slug: updatedSlug,
			};
		},
		organizationId,
		successMessage: (role) => `Role "${role.name}" updated`,
	});
}

export function useDeleteOrganizationRole(organizationId?: string) {
	return useOrganizationRoleMutation({
		errorFallback: "Failed to delete role",
		mutationFn: async (orgId, { id }: { id: string }) => {
			const res = await authClient.organization.deleteRole({
				organizationId: orgId,
				roleId: id,
			});
			return unwrapAuthResult(res, "Failed to delete role");
		},
		organizationId,
		successMessage: () => "Role deleted",
	});
}
