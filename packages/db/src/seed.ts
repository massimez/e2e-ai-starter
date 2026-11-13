import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "./index";
import {
	member,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	notificationPreference,
	organization,
	organizationStorageLimits,
	user,
} from "./schema";

async function seed() {
	if (
		process.env.NODE_ENV === "production" &&
		process.env.ALLOW_SEED !== "true"
	) {
		console.error(
			"Refusing to run database seed in production without ALLOW_SEED=true"
		);
		process.exit(1);
	}

	console.log("Seeding database...");

	try {
		const demoOrgId = "org_demo_acme";
		const demoUserId = "usr_demo_admin";
		const demoMemberId = "mem_demo_admin";

		await db.transaction(async (tx) => {
			await tx
				.insert(user)
				.values({
					email: "admin@acme.example",
					emailVerified: true,
					firstName: "Acme",
					id: demoUserId,
					lastName: "Admin",
					locale: "en",
					name: "Acme Admin",
					role: "user",
				})
				.onConflictDoNothing();

			await tx
				.insert(organization)
				.values({
					id: demoOrgId,
					name: "Acme Corporation",
					slug: "acme-corp",
				})
				.onConflictDoNothing();

			await tx
				.insert(member)
				.values({
					id: demoMemberId,
					organizationId: demoOrgId,
					role: "owner",
					userId: demoUserId,
				})
				.onConflictDoNothing();

			await tx
				.update(user)
				.set({ defaultOrganizationId: demoOrgId })
				.where(
					and(eq(user.id, demoUserId), isNull(user.defaultOrganizationId))
				);

			await tx
				.insert(organizationStorageLimits)
				.values({
					currentUsage: 0,
					organizationId: demoOrgId,
					storageLimit: 1024 * 1024 * 1024, // 1GB
				})
				.onConflictDoNothing();

			const prefRows = NOTIFICATION_CATEGORIES.flatMap((category) =>
				NOTIFICATION_CHANNELS.map((channel) => ({
					category,
					channel,
					enabled: true,
					userId: demoUserId,
				}))
			);

			await tx
				.insert(notificationPreference)
				.values(prefRows)
				.onConflictDoNothing();
		});

		console.log("Demo user seeded: admin@acme.example (usr_demo_admin)");
		console.log("Organization seeded: Acme Corporation (org_demo_acme)");
		console.log("Storage quota allocated: 1 GB for Acme Corporation");
		console.log(
			"Notification preferences initialized for system/security/team/project/billing"
		);
		console.log("Seeding completed successfully.");
	} catch (error) {
		console.error("Seeding failed:", error);
		process.exitCode = 1;
	} finally {
		await closeDb();
	}
}

seed();
