import { randomBytes, scrypt } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "./index";
import {
	account,
	member,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	notificationPreference,
	organization,
	organizationRole,
	organizationRolePermission,
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

interface SeedRoleDefinition {
	description: string;
	isDefault: boolean;
	name: string;
	permissions: Record<string, readonly string[]>;
	slug: "owner" | "admin" | "member" | "viewer";
}

const DEFAULT_SYSTEM_ROLES: readonly SeedRoleDefinition[] = [
	{
		description:
			"Full administrative authority over workspace billing, ownership, roles, and deletion.",
		isDefault: false,
		name: "Owner",
		permissions: {
			ac: ["create", "read", "update", "delete"],
			ai: ["read", "execute", "manage"],
			apiKey: ["create", "read", "revoke"],
			audit: ["read", "export"],
			billing: ["read", "manage"],
			document: ["create", "read", "update", "delete"],
			invitation: ["create", "cancel"],
			member: ["create", "update", "delete", "invite", "remove"],
			notification: ["read", "manage"],
			organization: ["update", "delete"],
			project: ["create", "read", "update", "delete"],
			role: ["create", "read", "update", "delete", "assign"],
			setting: ["read", "update"],
			storage: ["create", "read", "update", "delete"],
			team: ["create", "update", "delete"],
		},
		slug: "owner",
	},
	{
		description:
			"Manages team members, invitations, projects, storage, and workspace profile.",
		isDefault: false,
		name: "Admin",
		permissions: {
			ac: ["create", "read", "update", "delete"],
			ai: ["read", "execute", "manage"],
			apiKey: ["create", "read", "revoke"],
			audit: ["read"],
			billing: ["read"],
			document: ["create", "read", "update", "delete"],
			invitation: ["create", "cancel"],
			member: ["create", "update", "delete", "invite", "remove"],
			notification: ["read", "manage"],
			organization: ["update"],
			project: ["create", "read", "update"],
			role: ["read"],
			setting: ["read", "update"],
			storage: ["create", "read", "update", "delete"],
			team: ["create", "update", "delete"],
		},
		slug: "admin",
	},
	{
		description:
			"Standard collaborator who can create and modify projects and upload storage assets.",
		isDefault: true,
		name: "Member",
		permissions: {
			ai: ["read", "execute"],
			document: ["create", "read", "update"],
			notification: ["read"],
			project: ["create", "read", "update"],
			role: ["read"],
			setting: ["read"],
			storage: ["create", "read"],
		},
		slug: "member",
	},
	{
		description:
			"Read-only access across workspace documents, projects, and notifications.",
		isDefault: false,
		name: "Viewer",
		permissions: {
			ai: ["read"],
			document: ["read"],
			notification: ["read"],
			project: ["read"],
			role: ["read"],
			setting: ["read"],
			storage: ["read"],
		},
		slug: "viewer",
	},
];

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

			if (demoPasswordHash) {
				await tx
					.insert(account)
					.values({
						accountId: demoUserId,
						id: demoAccountId,
						password: demoPasswordHash,
						providerId: "credential",
						userId: demoUserId,
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

			const existingDefaultRoles = await tx
				.select({ id: organizationRole.id })
				.from(organizationRole)
				.where(
					and(
						eq(organizationRole.organizationId, demoOrgId),
						eq(organizationRole.isDefault, true)
					)
				)
				.limit(1);

			const hasDefaultRole = existingDefaultRoles.length > 0;

			await Promise.all(
				DEFAULT_SYSTEM_ROLES.map(async (roleDef) => {
					const [seededRole] = await tx
						.insert(organizationRole)
						.values({
							description: roleDef.description,
							isDefault: !hasDefaultRole && roleDef.isDefault,
							isSystem: true,
							name: roleDef.name,
							organizationId: demoOrgId,
							slug: roleDef.slug,
						})
						.onConflictDoUpdate({
							set: {
								description: roleDef.description,
								isSystem: true,
								name: roleDef.name,
							},
							target: [organizationRole.organizationId, organizationRole.slug],
						})
						.returning({ id: organizationRole.id });

					if (!seededRole) {
						return;
					}

					const permissionRows = Object.entries(roleDef.permissions).flatMap(
						([resource, actions]) =>
							actions.map((action) => ({
								action,
								resource,
								roleId: seededRole.id,
							}))
					);

					if (permissionRows.length > 0) {
						await tx
							.insert(organizationRolePermission)
							.values(permissionRows)
							.onConflictDoNothing({
								target: [
									organizationRolePermission.roleId,
									organizationRolePermission.resource,
									organizationRolePermission.action,
								],
							});
					}
				})
			);
		});

		console.log(
			demoPassword
				? "Demo user seeded: admin@acme.example (password configured for local sign-in)"
				: "Demo user seeded: admin@acme.example (usr_demo_admin)"
		);
		console.log("Organization seeded: Acme Corporation (org_demo_acme)");
		console.log(
			"System roles & permissions seeded: owner, admin, member, viewer"
		);
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
