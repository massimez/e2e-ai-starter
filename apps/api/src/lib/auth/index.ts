import { db } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { APP_CONFIG } from "@workspace/shared/config";
import {
	logDebug,
	logError,
	logInfo,
	logWarning,
} from "@workspace/shared/logger";
import { ac, roles } from "@workspace/shared/permissions";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, organization } from "better-auth/plugins";
import { env } from "../../env";
import {
	enqueueEmail,
	enqueueWorkspaceInvitationEmail,
} from "../../modules/email/queue";
import { redis } from "../redis/client";
import { createAuthCaptchaPlugin } from "./captcha";
import { createOrganizationLifecycleHooks } from "./organization-lifecycle";
import {
	authSecondaryKey,
	incrementFallbackCounter,
} from "./secondary-storage";

const orgLifecycle = createOrganizationLifecycleHooks();

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

async function runSecondaryStorageOp<T>(
	op: string,
	key: string,
	fallback: T | (() => T),
	fn: (scopedKey: string) => Promise<T>
): Promise<T> {
	try {
		return await fn(authSecondaryKey(key));
	} catch (error) {
		logError(`AuthSecondaryStorage:${op}`, error, {
			keyPrefix: key.slice(0, 12),
		});
		return typeof fallback === "function" ? (fallback as () => T)() : fallback;
	}
}

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
			organizationRole: schema.organizationRole,
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
			dynamicAccessControl: {
				enabled: true,
			},
			organizationHooks: orgLifecycle.organizationHooks,
			organizationLimit: 5,
			roles,
			async sendInvitationEmail(data) {
				await enqueueWorkspaceInvitationEmail({
					corsOrigins: env.CORS_ORIGINS,
					email: data.email,
					invitationId: data.id,
					inviterName: data.inviter.user.name,
					organizationName: data.organization.name,
					role: data.role,
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
		delete: (key) =>
			runSecondaryStorageOp("delete", key, undefined, async (scopedKey) => {
				await redis.del(scopedKey);
			}),
		get: (key) =>
			runSecondaryStorageOp("get", key, null, (scopedKey) =>
				redis.get(scopedKey)
			),
		getAndDelete: (key) =>
			runSecondaryStorageOp("getAndDelete", key, null, async (scopedKey) => {
				const result = await redis.eval(GET_AND_DELETE_LUA, 1, scopedKey);
				return result ?? null;
			}),
		increment: (key, ttl) =>
			runSecondaryStorageOp(
				"increment",
				key,
				() => incrementFallbackCounter(authSecondaryKey(key), ttl),
				async (scopedKey) => {
					const raw = await redis.eval(
						INCREMENT_WITH_TTL_LUA,
						1,
						scopedKey,
						String(Math.max(0, Math.ceil(ttl)))
					);
					return typeof raw === "number" ? raw : Number(raw ?? 1);
				}
			),
		set: (key, value, ttl) =>
			runSecondaryStorageOp("set", key, undefined, async (scopedKey) => {
				if (ttl) {
					await redis.set(scopedKey, value, "EX", ttl);
				} else {
					await redis.set(scopedKey, value);
				}
			}),
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
