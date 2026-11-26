import { isPgErrorCode, NotFoundError } from "../../../lib/errors";
import { buildPaginationMeta } from "../shared";
import {
	type AdminOrganizationsRepository,
	drizzleAdminOrganizationsRepository,
} from "./repository";
import type {
	ListAdminOrganizationsQuery,
	UpdateStorageLimitBody,
} from "./schema";

export function createAdminOrganizationsService(
	repository: AdminOrganizationsRepository = drizzleAdminOrganizationsRepository
) {
	return {
		async getOrganizationDetail(organizationId: string) {
			const org = await repository.findOrganizationById(organizationId);
			if (!org) {
				throw new NotFoundError("Organization");
			}

			const [members, pendingInvitations, storage] = await Promise.all([
				repository.listOrganizationMembers(organizationId),
				repository.listOrganizationInvitations(organizationId),
				repository.getOrganizationStorage(organizationId),
			]);

			return {
				members,
				organization: org,
				pendingInvitations,
				storage,
			};
		},

		async listOrganizations(query: ListAdminOrganizationsQuery) {
			const { page, ...filterParams } = query;
			const offset = (page - 1) * query.limit;

			const { items, total } = await repository.listOrganizations({
				...filterParams,
				offset,
			});

			return {
				items,
				pagination: buildPaginationMeta({
					itemCount: items.length,
					limit: query.limit,
					offset,
					page,
					total,
				}),
			};
		},

		async updateStorageLimit(params: {
			body: UpdateStorageLimitBody;
			organizationId: string;
		}) {
			const org = await repository.findOrganizationById(params.organizationId);
			if (!org) {
				throw new NotFoundError("Organization");
			}

			try {
				return await repository.upsertStorageLimit(
					params.organizationId,
					params.body.storageLimitBytes
				);
			} catch (error) {
				if (isPgErrorCode(error, "23503")) {
					throw new NotFoundError("Organization", { cause: error });
				}
				throw error;
			}
		},
	};
}

export const adminOrganizationsService = createAdminOrganizationsService();
