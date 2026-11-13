import { db } from "@workspace/db";
import { member, user } from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";

/**
 * Persistence boundary for reading, verifying, and updating a user's default organization.
 */
export interface DefaultOrganizationStore {
	findEarliestMemberOrganizationId: (userId: string) => Promise<string | null>;
	getUserDefaultOrganizationId: (userId: string) => Promise<string | null>;
	isUserMemberOfOrganization: (
		userId: string,
		organizationId: string
	) => Promise<boolean>;
	setUserDefaultOrganizationId: (
		userId: string,
		organizationId: string | null
	) => Promise<void>;
}

/**
 * Builds the default Drizzle-backed store for organization preference resolution.
 */
export function createDrizzleDefaultOrganizationStore(
	database = db
): DefaultOrganizationStore {
	return {
		async findEarliestMemberOrganizationId(userId: string) {
			const [membership] = await database
				.select({ organizationId: member.organizationId })
				.from(member)
				.where(eq(member.userId, userId))
				.orderBy(asc(member.createdAt), asc(member.id))
				.limit(1);

			return membership?.organizationId ?? null;
		},

		async getUserDefaultOrganizationId(userId: string) {
			const [record] = await database
				.select({ defaultOrganizationId: user.defaultOrganizationId })
				.from(user)
				.where(eq(user.id, userId))
				.limit(1);

			return record?.defaultOrganizationId ?? null;
		},

		async isUserMemberOfOrganization(userId: string, organizationId: string) {
			const [membership] = await database
				.select({ id: member.id })
				.from(member)
				.where(
					and(
						eq(member.userId, userId),
						eq(member.organizationId, organizationId)
					)
				)
				.limit(1);

			return Boolean(membership);
		},

		async setUserDefaultOrganizationId(
			userId: string,
			organizationId: string | null
		) {
			await database
				.update(user)
				.set({ defaultOrganizationId: organizationId })
				.where(eq(user.id, userId));
		},
	};
}

const drizzleDefaultOrganizationStore = createDrizzleDefaultOrganizationStore();

/**
 * Ensures `/organization/create` always activates the newly created organization
 * regardless of caller overrides such as `keepCurrentActiveOrganization: true`.
 */
export function enforceActiveOnOrganizationCreateBody(
	body: unknown
): Record<string, unknown> | undefined {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return undefined;
	}

	return {
		...(body as Record<string, unknown>),
		keepCurrentActiveOrganization: false,
	};
}

/**
 * Resolves which organization should become active when a user connects.
 * Prefers the persisted default organization when membership is still active;
 * otherwise heals `defaultOrganizationId` to the earliest remaining membership (or null).
 */
export async function resolveSessionOrganizationOnConnect(
	params: {
		requestedOrganizationId?: string | null;
		userId: string;
	},
	store: DefaultOrganizationStore = drizzleDefaultOrganizationStore
): Promise<string | null> {
	const requestedOrgId = params.requestedOrganizationId?.trim();
	if (
		requestedOrgId &&
		(await store.isUserMemberOfOrganization(params.userId, requestedOrgId))
	) {
		return requestedOrgId;
	}

	const currentDefaultId = await store.getUserDefaultOrganizationId(
		params.userId
	);
	if (
		currentDefaultId &&
		(await store.isUserMemberOfOrganization(params.userId, currentDefaultId))
	) {
		return currentDefaultId;
	}

	const fallbackOrgId = await store.findEarliestMemberOrganizationId(
		params.userId
	);
	if (fallbackOrgId !== currentDefaultId) {
		await store.setUserDefaultOrganizationId(params.userId, fallbackOrgId);
	}

	return fallbackOrgId;
}

/**
 * Persists a newly created organization as the creator's default organization.
 */
export async function persistDefaultOrganizationOnCreate(
	params: {
		organizationId: string;
		userId: string;
	},
	store: DefaultOrganizationStore = drizzleDefaultOrganizationStore
): Promise<void> {
	await store.setUserDefaultOrganizationId(
		params.userId,
		params.organizationId
	);
}

/**
 * Updates the user's persisted default organization when a session activates a non-null org.
 * Intentionally ignores null activations so explicit `setActive({ organizationId: null })`
 * keeps the last default remembered until deleted or membership ends.
 */
export async function syncDefaultOrganizationOnSessionActivation(
	params: {
		activeOrganizationId: string | null | undefined;
		userId: string;
	},
	store: DefaultOrganizationStore = drizzleDefaultOrganizationStore
): Promise<void> {
	const activeOrganizationId = params.activeOrganizationId?.trim();
	if (!activeOrganizationId) {
		return;
	}

	const isMember = await store.isUserMemberOfOrganization(
		params.userId,
		activeOrganizationId
	);
	if (!isMember) {
		return;
	}

	const currentDefaultId = await store.getUserDefaultOrganizationId(
		params.userId
	);
	if (currentDefaultId !== activeOrganizationId) {
		await store.setUserDefaultOrganizationId(
			params.userId,
			activeOrganizationId
		);
	}
}

/**
 * Heals a user's default organization after organization deletion or membership removal/leave.
 * Checks both `lostOrganizationId` and `null` because PostgreSQL `ON DELETE SET NULL` may
 * already have cleared `defaultOrganizationId` before the post-delete hook runs.
 */
export async function healDefaultOrganizationAfterMembershipLoss(
	params: {
		lostOrganizationId: string;
		userId: string;
	},
	store: DefaultOrganizationStore = drizzleDefaultOrganizationStore
): Promise<string | null> {
	const currentDefaultId = await store.getUserDefaultOrganizationId(
		params.userId
	);
	if (
		currentDefaultId !== null &&
		currentDefaultId !== params.lostOrganizationId
	) {
		return currentDefaultId;
	}

	const fallbackOrgId = await store.findEarliestMemberOrganizationId(
		params.userId
	);
	if (fallbackOrgId !== currentDefaultId) {
		await store.setUserDefaultOrganizationId(params.userId, fallbackOrgId);
	}

	return fallbackOrgId;
}
