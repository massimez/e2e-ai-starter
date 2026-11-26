import { randomBytes, scrypt } from "node:crypto";
import {
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
} from "@workspace/shared/queues";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "./index";
import {
	account,
	member,
	notificationPreference,
	organization,
	organizationStorageLimits,
	user,
} from "./schema";

const BETTER_AUTH_SCRYPT_CONFIG = {
	N: 16_384,
	dkLen: 64,
	p: 1,
	r: 16,
} as const;

/** Matches Better Auth's `@better-auth/utils/password` scrypt hash format (`saltHex:keyHex`). */
async function hashBetterAuthPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	const derivedKey = await new Promise<Buffer>((resolve, reject) => {
		scrypt(
			password.normalize("NFKC"),
			salt,
			BETTER_AUTH_SCRYPT_CONFIG.dkLen,
			{
				N: BETTER_AUTH_SCRYPT_CONFIG.N,
				maxmem:
					128 * BETTER_AUTH_SCRYPT_CONFIG.N * BETTER_AUTH_SCRYPT_CONFIG.r * 2,
				p: BETTER_AUTH_SCRYPT_CONFIG.p,
				r: BETTER_AUTH_SCRYPT_CONFIG.r,
			},
			(error, key) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(key);
			}
		);
	});
	return `${salt}:${derivedKey.toString("hex")}`;
}

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
		const demoAccountId = "acc_demo_admin";
		const backofficeUserId = "usr_demo_backoffice";
		const backofficeAccountId = "acc_demo_backoffice";
		const explicitDemoPassword = process.env.SEED_DEMO_PASSWORD?.trim();
		const demoPassword =
			explicitDemoPassword ||
			(process.env.NODE_ENV === "production" ? undefined : "Password123!");
		const demoPasswordHash = demoPassword
			? await hashBetterAuthPassword(demoPassword)
			: undefined;

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

			const [resolvedDemoUser] = await tx
				.select({ id: user.id })
				.from(user)
				.where(eq(user.email, "admin@acme.example"))
				.limit(1);
			const activeDemoUserId = resolvedDemoUser?.id ?? demoUserId;

			if (demoPasswordHash && activeDemoUserId === demoUserId) {
				await tx
					.insert(account)
					.values({
						accountId: activeDemoUserId,
						id: demoAccountId,
						password: demoPasswordHash,
						providerId: "credential",
						userId: activeDemoUserId,
					})
					.onConflictDoNothing();
			}

			// Dedicated Platform Backoffice operator (user.role = "admin", not a tenant workspace user)
			await tx
				.insert(user)
				.values({
					email: "superadmin@acme.example",
					emailVerified: true,
					firstName: "Platform",
					id: backofficeUserId,
					lastName: "Operator",
					locale: "en",
					name: "Platform Operator",
					role: "admin",
				})
				.onConflictDoNothing();

			const [resolvedBackofficeUser] = await tx
				.select({ id: user.id })
				.from(user)
				.where(eq(user.email, "superadmin@acme.example"))
				.limit(1);
			const activeBackofficeUserId =
				resolvedBackofficeUser?.id ?? backofficeUserId;

			if (demoPasswordHash && activeBackofficeUserId === backofficeUserId) {
				await tx
					.insert(account)
					.values({
						accountId: activeBackofficeUserId,
						id: backofficeAccountId,
						password: demoPasswordHash,
						providerId: "credential",
						userId: activeBackofficeUserId,
					})
					.onConflictDoNothing();
			}

			await tx
				.insert(organization)
				.values({
					id: demoOrgId,
					name: "Acme Corporation",
					slug: "acme-corp",
				})
				.onConflictDoNothing();

			const [resolvedOrg] = await tx
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.slug, "acme-corp"))
				.limit(1);
			const activeDemoOrgId = resolvedOrg?.id ?? demoOrgId;

			await tx
				.insert(member)
				.values({
					id: demoMemberId,
					organizationId: activeDemoOrgId,
					role: "owner",
					userId: activeDemoUserId,
				})
				.onConflictDoNothing();

			await tx
				.update(user)
				.set({ defaultOrganizationId: activeDemoOrgId })
				.where(
					and(eq(user.id, activeDemoUserId), isNull(user.defaultOrganizationId))
				);

			await tx
				.insert(organizationStorageLimits)
				.values({
					currentUsage: 0,
					organizationId: activeDemoOrgId,
					storageLimit: 1024 * 1024 * 1024, // 1GB
				})
				.onConflictDoNothing();

			const prefRows = NOTIFICATION_CATEGORIES.flatMap((category) =>
				NOTIFICATION_CHANNELS.map((channel) => ({
					category,
					channel,
					enabled: true,
					userId: activeDemoUserId,
				}))
			);

			await tx
				.insert(notificationPreference)
				.values(prefRows)
				.onConflictDoNothing();
		});

		console.log(
			demoPassword
				? "Demo tenant user seeded: admin@acme.example (user.role=user, org owner)"
				: "Demo tenant user seeded: admin@acme.example (usr_demo_admin)"
		);
		console.log(
			demoPassword
				? "Demo backoffice operator seeded: superadmin@acme.example (user.role=admin, /admin access)"
				: "Demo backoffice operator seeded: superadmin@acme.example (usr_demo_backoffice)"
		);
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
