"use client";

import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { extractErrorMessage } from "@workspace/ui/lib/utils";
import {
	ApiError,
	client,
	type InferResponseType,
	parseApiResponse,
} from "./api-client";

export type AdminOverviewResponse = InferResponseType<
	typeof client.api.admin.overview.$get,
	200
>["data"];
export type AdminUsersPageResponse = InferResponseType<
	typeof client.api.admin.users.$get,
	200
>["data"];
export type AdminUserListItem = AdminUsersPageResponse["items"][number];
export type AdminUserDetailResponse = InferResponseType<
	(typeof client.api.admin.users)[":userId"]["$get"],
	200
>["data"];
export type AdminOrganizationsPageResponse = InferResponseType<
	typeof client.api.admin.organizations.$get,
	200
>["data"];
export type AdminOrganizationListItem =
	AdminOrganizationsPageResponse["items"][number];
export type AdminOrganizationDetailResponse = InferResponseType<
	(typeof client.api.admin.organizations)[":organizationId"]["$get"],
	200
>["data"];
export type AuditLogsPageResponse = InferResponseType<
	typeof client.api.admin.audit.$get,
	200
>["data"];
export type AuditLogEntry = AuditLogsPageResponse["items"][number];
export type AdminSystemStatusResponse = InferResponseType<
	typeof client.api.admin.system.$get,
	200
>["data"];
export type AdminRetentionTriggerResponse = InferResponseType<
	typeof client.api.admin.system.retention.run.$post,
	202
>["data"];

export type AuditScopeFilter = "all" | "global" | "organization";

export interface AdminPagination {
	hasMore: boolean;
	limit: number;
	page: number;
	total: number;
	totalPages: number;
}

export interface AdminUserQueryFilters {
	limit?: number;
	page?: number;
	role?: "all" | "admin" | "user";
	search?: string;
	status?: "all" | "active" | "banned";
	twoFactor?: "all" | "enabled" | "disabled";
}

export interface AdminOrganizationQueryFilters {
	limit?: number;
	page?: number;
	search?: string;
}

export interface AdminAuditLogQueryFilters {
	action?: string;
	entityType?: string;
	from?: string;
	limit?: number;
	organizationId?: string;
	page?: number;
	scope?: AuditScopeFilter;
	search?: string;
	to?: string;
	userId?: string;
}

export const adminKeys = {
	audit: (filters: AdminAuditLogQueryFilters) =>
		["admin", "audit", "list", filters] as const,
	organizationDetail: (organizationId: string) =>
		["admin", "organizations", "detail", organizationId] as const,
	organizations: (filters: AdminOrganizationQueryFilters) =>
		["admin", "organizations", "list", filters] as const,
	organizationsAll: ["admin", "organizations"] as const,
	overview: ["admin", "overview"] as const,
	system: ["admin", "system"] as const,
	userDetail: (userId: string) => ["admin", "users", "detail", userId] as const,
	users: (filters: AdminUserQueryFilters) =>
		["admin", "users", "list", filters] as const,
	usersAll: ["admin", "users"] as const,
};

function serializeQueryParams(
	filters: Record<string, string | number | undefined>
): Record<string, string> {
	const query: Record<string, string> = {};
	for (const [key, value] of Object.entries(filters)) {
		if (value === undefined) {
			continue;
		}
		const normalized = typeof value === "string" ? value.trim() : String(value);
		if (normalized.length > 0) {
			query[key] = normalized;
		}
	}
	return query;
}

function invalidateUserQueries(queryClient: QueryClient, userId: string) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: adminKeys.usersAll }),
		queryClient.invalidateQueries({ queryKey: adminKeys.userDetail(userId) }),
		queryClient.invalidateQueries({ queryKey: adminKeys.overview }),
	]);
}

function invalidateOrganizationQueries(
	queryClient: QueryClient,
	organizationId: string
) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: adminKeys.organizationsAll }),
		queryClient.invalidateQueries({
			queryKey: adminKeys.organizationDetail(organizationId),
		}),
		queryClient.invalidateQueries({ queryKey: adminKeys.overview }),
	]);
}

export function useAdminOverview() {
	return useQuery<AdminOverviewResponse>({
		queryFn: async () =>
			await parseApiResponse<AdminOverviewResponse>(
				await client.api.admin.overview.$get()
			),
		queryKey: adminKeys.overview,
		staleTime: 15_000,
	});
}

export function useAdminUsers(filters: AdminUserQueryFilters) {
	return useQuery<AdminUsersPageResponse>({
		placeholderData: (previous) => previous,
		queryFn: async () =>
			await parseApiResponse<AdminUsersPageResponse>(
				await client.api.admin.users.$get({
					query: serializeQueryParams({ ...filters }),
				})
			),
		queryKey: adminKeys.users(filters),
		staleTime: 15_000,
	});
}

export function useAdminUserDetail(userId: string | null) {
	return useQuery<AdminUserDetailResponse>({
		enabled: Boolean(userId),
		queryFn: async () => {
			if (!userId) {
				throw new Error("User ID is required");
			}
			return await parseApiResponse<AdminUserDetailResponse>(
				await client.api.admin.users[":userId"].$get({ param: { userId } })
			);
		},
		queryKey: adminKeys.userDetail(userId ?? ""),
		staleTime: 10_000,
	});
}

export function useUpdateAdminUserRole() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (params: { role: "admin" | "user"; userId: string }) =>
			await parseApiResponse(
				await client.api.admin.users[":userId"].role.$patch({
					json: { role: params.role },
					param: { userId: params.userId },
				})
			),
		onSuccess: (_data, { userId }) =>
			invalidateUserQueries(queryClient, userId),
	});
}

export function useBanAdminUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (params: {
			expiresInDays?: number;
			reason: string;
			userId: string;
		}) =>
			await parseApiResponse(
				await client.api.admin.users[":userId"].ban.$post({
					json: {
						expiresInDays: params.expiresInDays,
						reason: params.reason,
					},
					param: { userId: params.userId },
				})
			),
		onSuccess: (_data, { userId }) =>
			invalidateUserQueries(queryClient, userId),
	});
}

export function useUnbanAdminUser() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (userId: string) =>
			await parseApiResponse(
				await client.api.admin.users[":userId"].unban.$post({
					param: { userId },
				})
			),
		onSuccess: (_data, userId) => invalidateUserQueries(queryClient, userId),
	});
}

export function useRevokeAdminUserSession() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (params: { sessionId: string; userId: string }) =>
			await parseApiResponse(
				await client.api.admin.users[":userId"].sessions[":sessionId"].$delete({
					param: { sessionId: params.sessionId, userId: params.userId },
				})
			),
		onSuccess: (_data, { userId }) =>
			invalidateUserQueries(queryClient, userId),
	});
}

export function useRevokeAllAdminUserSessions() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (userId: string) =>
			await parseApiResponse<{ revokedCount: number; userId: string }>(
				await client.api.admin.users[":userId"].sessions.$delete({
					param: { userId },
				})
			),
		onSuccess: (_data, userId) => invalidateUserQueries(queryClient, userId),
	});
}

export function useAdminOrganizations(filters: AdminOrganizationQueryFilters) {
	return useQuery<AdminOrganizationsPageResponse>({
		placeholderData: (previous) => previous,
		queryFn: async () =>
			await parseApiResponse<AdminOrganizationsPageResponse>(
				await client.api.admin.organizations.$get({
					query: serializeQueryParams({ ...filters }),
				})
			),
		queryKey: adminKeys.organizations(filters),
		staleTime: 15_000,
	});
}

export function useAdminOrganizationDetail(organizationId: string | null) {
	return useQuery<AdminOrganizationDetailResponse>({
		enabled: Boolean(organizationId),
		queryFn: async () => {
			if (!organizationId) {
				throw new Error("Organization ID is required");
			}
			return await parseApiResponse<AdminOrganizationDetailResponse>(
				await client.api.admin.organizations[":organizationId"].$get({
					param: { organizationId },
				})
			);
		},
		queryKey: adminKeys.organizationDetail(organizationId ?? ""),
		staleTime: 10_000,
	});
}

export function useUpdateAdminOrganizationStorageLimit() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (params: {
			organizationId: string;
			storageLimitBytes: number;
		}) =>
			await parseApiResponse(
				await client.api.admin.organizations[":organizationId"][
					"storage-limit"
				].$patch({
					json: { storageLimitBytes: params.storageLimitBytes },
					param: { organizationId: params.organizationId },
				})
			),
		onSuccess: (_data, { organizationId }) =>
			invalidateOrganizationQueries(queryClient, organizationId),
	});
}

export function useAdminAuditLogs(
	filters: AdminAuditLogQueryFilters,
	enabled = true
) {
	return useQuery<AuditLogsPageResponse>({
		enabled,
		placeholderData: (previous) => previous,
		queryFn: async () =>
			await parseApiResponse<AuditLogsPageResponse>(
				await client.api.admin.audit.$get({
					query: serializeQueryParams({ ...filters }),
				})
			),
		queryKey: adminKeys.audit(filters),
		staleTime: 15_000,
	});
}

const CONTENT_DISPOSITION_FILENAME_REGEX = /filename="?(?<filename>[^";]+)"?/iu;

export async function exportAdminAuditLogs(params: {
	filters: Omit<AdminAuditLogQueryFilters, "page">;
	format: "csv" | "json";
}): Promise<{ filename: string }> {
	const response = await client.api.admin.audit.export.$get({
		query: {
			...serializeQueryParams({ ...params.filters }),
			format: params.format,
		},
	});

	if (!response.ok) {
		const message = await extractErrorMessage(
			response,
			`Audit export failed with status ${response.status}`
		);
		throw new ApiError(message, response.status);
	}

	const blob = await response.blob();
	const header = response.headers.get("content-disposition");
	const filename =
		(header &&
			CONTENT_DISPOSITION_FILENAME_REGEX.exec(header)?.groups?.filename) ||
		`audit-logs-platform-${new Date().toISOString().slice(0, 10)}.${params.format}`;

	const objectUrl = URL.createObjectURL(blob);
	try {
		const link = document.createElement("a");
		link.href = objectUrl;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		link.remove();
	} finally {
		URL.revokeObjectURL(objectUrl);
	}

	return { filename };
}

export function useAdminSystemStatus() {
	return useQuery<AdminSystemStatusResponse>({
		queryFn: async () =>
			await parseApiResponse<AdminSystemStatusResponse>(
				await client.api.admin.system.$get()
			),
		queryKey: adminKeys.system,
		staleTime: 10_000,
	});
}

export function useTriggerRetentionSweep() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async () =>
			await parseApiResponse<AdminRetentionTriggerResponse>(
				await client.api.admin.system.retention.run.$post()
			),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: adminKeys.system }),
	});
}
