import { AdminAuditLogsClient } from "./_components/audit-logs-client";

export default async function AdminAuditLogsPage({
	searchParams,
}: {
	searchParams: Promise<{
		organizationId?: string | string[];
		userId?: string | string[];
	}>;
}) {
	const resolved = await searchParams;
	const initialOrganizationId =
		typeof resolved.organizationId === "string" ? resolved.organizationId : "";
	const initialUserId =
		typeof resolved.userId === "string" ? resolved.userId : "";

	return (
		<AdminAuditLogsClient
			initialOrganizationId={initialOrganizationId}
			initialUserId={initialUserId}
			key={`${initialOrganizationId}:${initialUserId}`}
		/>
	);
}
