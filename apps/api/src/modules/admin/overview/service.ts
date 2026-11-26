import {
	type AuditRepository,
	drizzleAuditRepository,
} from "../audit/repository";
import {
	type AdminOverviewRepository,
	drizzleAdminOverviewRepository,
} from "./repository";

const RECENT_EVENTS_LIMIT = 8;

export function createAdminOverviewService(
	repository: AdminOverviewRepository = drizzleAdminOverviewRepository,
	auditRepository: AuditRepository = drizzleAuditRepository
) {
	return {
		async getOverview() {
			const [metrics, recentEvents] = await Promise.all([
				repository.getMetrics(),
				auditRepository.listRecentAuditLogs(RECENT_EVENTS_LIMIT),
			]);

			const twoFactorAdoptionPercent =
				metrics.totalUsers > 0
					? Math.round(
							(metrics.twoFactorEnabledUsers / metrics.totalUsers) * 100
						)
					: 0;

			return {
				generatedAt: new Date().toISOString(),
				metrics: {
					...metrics,
					twoFactorAdoptionPercent,
				},
				recentEvents,
			};
		},
	};
}

export const adminOverviewService = createAdminOverviewService();
