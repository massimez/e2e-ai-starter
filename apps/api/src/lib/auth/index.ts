import { db } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, organization } from "better-auth/plugins";
import { env } from "../../env";
import { enqueueEmail } from "../../modules/email/queue";
import { ensureDefaultOrganizationRoles } from "../../modules/roles/service";
import { APP_CONFIG } from "../app-config";
import { logDebug, logError, logInfo, logWarning } from "../logger";
import { redis } from "../redis/client";
import { createAuthCaptchaPlugin } from "./captcha";
import { createOrganizationLifecycleHooks } from "./organization-lifecycle";
import { ac, roles } from "./permissions";

const orgLifecycle = createOrganizationLifecycleHooks(undefined, {
	onOrganizationCreated: async (organizationId) => {
		await ensureDefaultOrganizationRoles(organizationId);
	},
});

const captchaPlugin = createAuthCaptchaPlugin({
	allowedHostnames: env.TURNSTILE_ALLOWED_HOSTNAMES_LIST,
	secretKey: env.TURNSTILE_SECRET_KEY,
});

const BETTER_AUTH_PREFIX_REGEX = /^\[better-auth\]\s*/iu;

function mapBetterAuthLogLevel(
	level: typeof env.LOG_LEVEL
): "debug" | "info" | "warn" | "error" {
	if (!level || level === "silent") {
		return "info";
	}
	return level;
}

function secondaryKey(key: string): string {
	return `${env.REDIS_PREFIX}:auth:${key}`;
}

const TRAILING_SLASH_REGEX = /\/$/u;

const GET_AND_DELETE_LUA = `
local value = redis.call("GET", KEYS[1])
if value then
	redis.call("DEL", KEYS[1])
end
return value
`;

const INCREMENT_WITH_TTL_LUA = `
local count = redis.call("INCR", KEYS[1])
if count == 1 and tonumber(ARGV[1]) and tonumber(ARGV[1]) > 0 then
	redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
end
return count
`;

export const auth = betterAuth({
	advanced: {
		ipAddress: {
			ipAddressHeaders: ["x-resolved-client-ip"],
		},
	},
	baseURL: env.BETTER_AUTH_URL,
	// Disable static-RBAC organization endpoints; dynamic RBAC is enforced on /api/organizations/*
	disabledPaths: [
		"/organization/update-member-role",
		"/organization/invite-member",
		"/organization/cancel-invitation",
		"/organization/update",
		"/organization/remove-member",
		"/organization/has-permission",
	],
	logger: {
		disabled:
			env.LOG_LEVEL === "silent" || (env.NODE_ENV === "test" && !env.LOG_LEVEL),
		level: mapBetterAuthLogLevel(env.LOG_LEVEL),
		log(level, message, ...args) {
			const cleanMessage = message.replace(BETTER_AUTH_PREFIX_REGEX, "");
			const firstError = args.find((arg) => arg instanceof Error);
			const extraArgs = args.filter((arg) => !(arg instanceof Error));
			const metadata =
				extraArgs.length > 0 ? { details: extraArgs } : undefined;

			switch (level) {
				case "debug":
					logDebug("BetterAuth", cleanMessage, metadata);
					break;
				case "info":
					logInfo("BetterAuth", cleanMessage, metadata);
					break;
				case "warn":
					logWarning("BetterAuth", cleanMessage, metadata);
					break;
				case "error":
					logError("BetterAuth", firstError ?? cleanMessage, {
						...(firstError ? { message: cleanMessage } : {}),
						...metadata,
					});
					break;
				default:
					logInfo("BetterAuth", cleanMessage, metadata);
					break;
			}
		},
	},
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: {
			account: schema.account,
			invitation: schema.invitation,
			member: schema.member,
			organization: schema.organization,
			session: schema.session,
			user: schema.user,
			verification: schema.verification,
		},
	}),
	databaseHooks: {
		session: orgLifecycle.sessionDatabaseHooks,
		user: {
			create: {
				after: async (createdUser) => {
					if (!createdUser.emailVerified) {
						return;
					}
					try {
						await enqueueEmail({
							payload: { name: createdUser.name },
							subject: `Welcome to ${APP_CONFIG.name}!`,
							template: "welcome",
							to: createdUser.email,
						});
					} catch (error) {
						logError("Auth:WelcomeEmail", error, { userId: createdUser.id });
					}
				},
			},
		},
	},
	hooks: {
		after: orgLifecycle.after,
		before: orgLifecycle.before,
	},
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		revokeSessionsOnPasswordReset: true,
		async sendResetPassword({ url, user }) {
			await enqueueEmail({
				payload: {
					name: user.name,
					url,
				},
				subject: "Reset your password",
				template: "reset-password",
				to: user.email,
			});
		},
	},
	plugins: [
		admin(),
		organization({
			ac,
			allowUserToCreateOrganization: true,
			organizationHooks: orgLifecycle.organizationHooks,
			organizationLimit: 5,
			roles,
			async sendInvitationEmail(data) {
				const appOrigin = (
					env.CORS_ORIGINS[0] ?? "http://localhost:3000"
				).replace(TRAILING_SLASH_REGEX, "");
				const inviteUrl = `${appOrigin}/accept-invitation?invitationId=${encodeURIComponent(data.id)}`;
				await enqueueEmail({
					payload: {
						inviterName: data.inviter.user.name,
						organizationName: data.organization.name,
						role: data.role,
						url: inviteUrl,
					},
					subject: `You're invited to join ${data.organization.name}`,
					template: "invitation",
					to: data.email,
				});
			},
		}),
		emailOTP({
			sendVerificationOnSignUp: true,
			storeOTP: "hashed",
			async sendVerificationOTP({ email, otp, type }) {
				await enqueueEmail({
					payload: { code: otp, type },
					subject: `Your ${type === "sign-in" ? "Sign-in" : "Verification"} Code`,
					template: "verification-otp",
					to: email,
				});
			},
		}),
		...(captchaPlugin ? [captchaPlugin] : []),
	],
	secondaryStorage: {
		delete: async (key) => {
			try {
				await redis.del(secondaryKey(key));
			} catch (error) {
				logError("AuthSecondaryStorage:delete", error, {
					keyPrefix: key.slice(0, 12),
				});
			}
		},
		get: async (key) => {
			try {
				return await redis.get(secondaryKey(key));
			} catch (error) {
				logError("AuthSecondaryStorage:get", error, {
					keyPrefix: key.slice(0, 12),
				});
				return null;
			}
		},
		getAndDelete: async (key) => {
			try {
				const result = await redis.eval(
					GET_AND_DELETE_LUA,
					1,
					secondaryKey(key)
				);
				return result ?? null;
			} catch (error) {
				logError("AuthSecondaryStorage:getAndDelete", error, {
					keyPrefix: key.slice(0, 12),
				});
				return null;
			}
		},
		increment: async (key, ttl) => {
			try {
				const raw = await redis.eval(
					INCREMENT_WITH_TTL_LUA,
					1,
					secondaryKey(key),
					String(Math.max(0, Math.ceil(ttl)))
				);
				return typeof raw === "number" ? raw : Number(raw ?? 1);
			} catch (error) {
				logError("AuthSecondaryStorage:increment", error, {
					keyPrefix: key.slice(0, 12),
				});
				return 1;
			}
		},
		set: async (key, value, ttl) => {
			try {
				const scopedKey = secondaryKey(key);
				if (ttl) {
					await redis.set(scopedKey, value, "EX", ttl);
				} else {
					await redis.set(scopedKey, value);
				}
			} catch (error) {
				logError("AuthSecondaryStorage:set", error, {
					keyPrefix: key.slice(0, 12),
				});
			}
		},
	},
	secret: env.BETTER_AUTH_SECRET,
	session: {
		cookieCache: {
			enabled: false,
		},
		storeSessionInDatabase: true,
	},
	socialProviders: {
		...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
			? {
					google: {
						clientId: env.GOOGLE_CLIENT_ID,
						clientSecret: env.GOOGLE_CLIENT_SECRET,
						mapProfileToUser: (profile) => ({
							firstName: profile.given_name,
							lastName: profile.family_name,
						}),
					},
				}
			: {}),
	},
	trustedOrigins: env.CORS_ORIGINS,
	user: {
		additionalFields: {
			firstName: {
				required: false,
				type: "string",
			},
			lastName: {
				required: false,
				type: "string",
			},
			locale: {
				defaultValue: "en",
				required: false,
				type: "string",
			},
		},
	},
});

export type Session = typeof auth.$Infer.Session;
export type User = (typeof auth.$Infer.Session)["user"];
export type Organization = typeof auth.$Infer.Organization;
