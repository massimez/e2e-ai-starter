import { z } from "zod";

export const EMAIL_QUEUE_NAME = "email-queue";
export const NOTIFICATION_QUEUE_NAME = "notification-queue";

export const NOTIFICATION_CATEGORIES = [
	"system",
	"security",
	"team",
	"project",
	"billing",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);

export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

const httpUrlSchema = z
	.string()
	.url()
	.refine((value) => {
		try {
			const parsed = new URL(value);
			return parsed.protocol === "http:" || parsed.protocol === "https:";
		} catch {
			return false;
		}
	}, "URL must use http or https protocol");

export const verificationOtpEmailSchema = z.object({
	payload: z.object({
		code: z.string().trim().min(1).max(32),
		type: z.string().trim().min(1).max(64).default("verification"),
	}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("verification-otp"),
	to: z.string().trim().email(),
});

export const welcomeEmailSchema = z.object({
	payload: z.object({
		name: z.string().trim().max(120).optional(),
	}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("welcome"),
	to: z.string().trim().email(),
});

export const resetPasswordEmailSchema = z.object({
	payload: z
		.object({
			link: httpUrlSchema.optional(),
			name: z.string().trim().max(120).optional(),
			url: httpUrlSchema.optional(),
		})
		.refine((value) => Boolean(value.url || value.link), {
			message: "A valid reset URL is required",
		}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("reset-password"),
	to: z.string().trim().email(),
});

export const invitationEmailSchema = z.object({
	payload: z
		.object({
			inviterName: z.string().trim().max(120).optional(),
			link: httpUrlSchema.optional(),
			organizationName: z.string().trim().max(160).optional(),
			role: z.string().trim().max(64).optional(),
			url: httpUrlSchema.optional(),
		})
		.refine((value) => Boolean(value.url || value.link), {
			message: "A valid invitation URL is required",
		}),
	subject: z.string().trim().min(1).max(255),
	template: z.literal("invitation"),
	to: z.string().trim().email(),
});

export const emailJobDataSchema = z.discriminatedUnion("template", [
	verificationOtpEmailSchema,
	welcomeEmailSchema,
	resetPasswordEmailSchema,
	invitationEmailSchema,
]);

export type EmailJobData = z.infer<typeof emailJobDataSchema>;

export const notificationJobDataSchema = z.object({
	category: notificationCategorySchema,
	channels: z.array(notificationChannelSchema).min(1).optional(),
	content: z.string().trim().min(1).max(4000),
	data: z.record(z.string(), z.unknown()).optional(),
	idempotencyKey: z.string().trim().min(1).max(128).optional(),
	organizationId: z.string().trim().min(1).nullable().optional(),
	title: z.string().trim().min(1).max(200),
	type: z.string().trim().min(1).max(100),
	userId: z.string().trim().min(1),
});

export type NotificationJobData = z.infer<typeof notificationJobDataSchema>;

export interface ParsedRedisConnectionOptions {
	db: number;
	host: string;
	password: string | undefined;
	port: number;
	tls: Record<string, never> | undefined;
	username: string | undefined;
}

export function parseRedisConnectionOptions(
	redisUrl: string
): ParsedRedisConnectionOptions {
	const parsed = new URL(redisUrl);
	const dbSegment = parsed.pathname.replace("/", "");
	const parsedDb = dbSegment ? Number.parseInt(dbSegment, 10) : 0;

	return {
		db: Number.isNaN(parsedDb) ? 0 : parsedDb,
		host: parsed.hostname || "localhost",
		password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
		port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
		tls: parsed.protocol === "rediss:" ? {} : undefined,
		username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
	};
}

/**
 * Races an async operation against a timeout and clears the timer in `finally`.
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	timeoutMessage = "Operation timed out"
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

const IPV4_PATTERN =
	/^(?<o1>\d{1,3})\.(?<o2>\d{1,3})\.(?<o3>\d{1,3})\.(?<o4>\d{1,3})$/u;
const HEX_GROUP_PATTERN = /^[0-9a-f]{1,4}$/u;
const TRAILING_DOTS_PATTERN = /\.+$/u;

const BLOCKED_EXACT_HOSTNAMES = new Set([
	"localhost",
	"localhost.localdomain",
	"metadata.google.internal",
	"metadata.goog",
]);

const BLOCKED_HOST_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".arpa",
	".lan",
	".corp",
	".localdomain",
	".intranet",
];

type Ipv4Octets = readonly [number, number, number, number];

function parseIpv4Octets(ip: string): Ipv4Octets | null {
	const match = IPV4_PATTERN.exec(ip);
	if (!match) {
		return null;
	}
	const octets = match.slice(1, 5).map((part) => Number.parseInt(part, 10));
	if (
		octets.length !== 4 ||
		octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)
	) {
		return null;
	}
	return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
}

function isBlockedSpecialIpv4(
	first: number,
	second: number,
	third: number
): boolean {
	if (first === 192) {
		const isProtocolOrTestNet = second === 0 && (third === 0 || third === 2);
		const isRelayOrRfc1918 = (second === 88 && third === 99) || second === 168;
		return isProtocolOrTestNet || isRelayOrRfc1918;
	}
	if (first === 198) {
		return second === 18 || second === 19 || (second === 51 && third === 100);
	}
	return first === 203 && second === 0 && third === 113;
}

function isBlockedIpv4Octets([first, second, third]: Ipv4Octets): boolean {
	// 0.0.0.0/8, 10.0.0.0/8 (RFC1918), 127.0.0.0/8 (loopback), 224.0.0.0/4+ (multicast/reserved)
	if (first === 0 || first === 10 || first === 127 || first >= 224) {
		return true;
	}
	// 100.64.0.0/10 (CGNAT), 169.254.0.0/16 (link-local & metadata), 172.16.0.0/12 (RFC1918)
	if (first === 100 && second >= 64 && second <= 127) {
		return true;
	}
	if (first === 169 && second === 254) {
		return true;
	}
	if (first === 172 && second >= 16 && second <= 31) {
		return true;
	}
	return isBlockedSpecialIpv4(first, second, third);
}

function parseIpv6Side(side: string): number[] | null {
	if (!side) {
		return [];
	}
	const tokens = side.split(":");
	const groups: number[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i] ?? "";
		if (token.includes(".")) {
			if (i !== tokens.length - 1) {
				return null;
			}
			const ipv4 = parseIpv4Octets(token);
			if (!ipv4) {
				return null;
			}
			groups.push(ipv4[0] * 256 + ipv4[1], ipv4[2] * 256 + ipv4[3]);
		} else if (HEX_GROUP_PATTERN.test(token)) {
			groups.push(Number.parseInt(token, 16));
		} else {
			return null;
		}
	}
	return groups;
}

function parseIpv6Groups(rawIp: string): number[] | null {
	let ip = rawIp.trim().toLowerCase();
	if (ip.startsWith("[") && ip.endsWith("]")) {
		ip = ip.slice(1, -1);
	}
	const zoneIndex = ip.indexOf("%");
	if (zoneIndex !== -1) {
		ip = ip.slice(0, zoneIndex);
	}
	if (!ip.includes(":")) {
		return null;
	}

	const parts = ip.split("::");
	if (parts.length > 2) {
		return null;
	}

	const head = parseIpv6Side(parts[0] ?? "");
	const tail = parts.length === 2 ? parseIpv6Side(parts[1] ?? "") : [];
	if (!(head && tail)) {
		return null;
	}

	if (parts.length === 1) {
		return head.length === 8 ? head : null;
	}

	const missing = 8 - head.length - tail.length;
	if (missing < 1) {
		return null;
	}
	return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function groupsToIpv4Octets(highGroup: number, lowGroup: number): Ipv4Octets {
	return [
		Math.floor(highGroup / 256),
		highGroup % 256,
		Math.floor(lowGroup / 256),
		lowGroup % 256,
	];
}

function isBlockedIpv6Groups(groups: number[]): boolean {
	if (groups.length !== 8) {
		return true;
	}
	const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
		groups;

	const firstFiveZero =
		g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
	// ::/128 (unspecified) and ::1/128 (loopback)
	if (firstFiveZero && g5 === 0 && g6 === 0 && g7 <= 1) {
		return true;
	}
	// ::ffff:0:0/96 (IPv4-mapped) or ::/96 (IPv4-compatible)
	if (firstFiveZero && (g5 === 0xff_ff || g5 === 0)) {
		return isBlockedIpv4Octets(groupsToIpv4Octets(g6, g7));
	}
	// NAT64 64:ff9b::/96 & 64:ff9b:1::/48
	if (g0 === 0x00_64 && g1 === 0xff_9b) {
		return isBlockedIpv4Octets(groupsToIpv4Octets(g6, g7));
	}
	// 6to4 2002::/16
	if (g0 === 0x20_02) {
		return isBlockedIpv4Octets(groupsToIpv4Octets(g1, g2));
	}
	// Only allow Global Unicast (2000::/3), excluding Teredo (2001::/32), ORCHID (2001:10::/28), docs (2001:db8::/32)
	const isGlobalUnicast = g0 >= 0x20_00 && g0 <= 0x3f_ff;
	if (!isGlobalUnicast) {
		return true;
	}
	const isReserved2001 =
		g0 === 0x20_01 &&
		(g1 === 0 || g1 === 0x0d_b8 || (g1 >= 0x00_10 && g1 <= 0x00_1f));
	return isReserved2001;
}

/**
 * Returns true if an IPv4 or IPv6 literal falls inside loopback, RFC1918,
 * link-local / cloud metadata (`169.254.169.254`), CGNAT, ULA, multicast,
 * or non-global ranges. Fails closed on unparseable strings.
 */
export function isBlockedIpAddress(rawIp: string): boolean {
	const trimmed = rawIp.trim();
	const bare =
		trimmed.startsWith("[") && trimmed.endsWith("]")
			? trimmed.slice(1, -1)
			: trimmed;

	const ipv4 = parseIpv4Octets(bare);
	if (ipv4 !== null) {
		return isBlockedIpv4Octets(ipv4);
	}
	const ipv6 = parseIpv6Groups(bare);
	if (ipv6 !== null) {
		return isBlockedIpv6Groups(ipv6);
	}
	return true;
}

export type PushEndpointValidationResult =
	| { ok: true; url: URL }
	| { ok: false; reason: string };

/**
 * Validates that a Web Push subscription endpoint is strictly HTTPS, contains no
 * embedded credentials or non-443 ports, targets a multi-label public domain name
 * (no raw IP literals, localhost, `.local`, `.internal`, or `.arpa`), and stays within length limits.
 */
export function validatePushEndpointUrl(
	endpoint: string
): PushEndpointValidationResult {
	if (endpoint.length === 0 || endpoint.length > 2048) {
		return { ok: false, reason: "Push endpoint URL exceeds allowed length" };
	}
	if (endpoint.trim() !== endpoint) {
		return {
			ok: false,
			reason: "Push endpoint URL must not have leading or trailing whitespace",
		};
	}

	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch {
		return { ok: false, reason: "Push endpoint must be a valid URL" };
	}

	if (parsed.protocol !== "https:") {
		return { ok: false, reason: "Push endpoint must use https" };
	}
	if (parsed.username || parsed.password) {
		return {
			ok: false,
			reason: "Push endpoint URL must not include credentials",
		};
	}
	if (parsed.port !== "" && parsed.port !== "443") {
		return { ok: false, reason: "Push endpoint URL must use port 443" };
	}

	const rawHost = parsed.hostname
		.toLowerCase()
		.replace(TRAILING_DOTS_PATTERN, "");
	const bareHost =
		rawHost.startsWith("[") && rawHost.endsWith("]")
			? rawHost.slice(1, -1)
			: rawHost;

	if (!bareHost) {
		return { ok: false, reason: "Push endpoint hostname is required" };
	}
	if (
		BLOCKED_EXACT_HOSTNAMES.has(bareHost) ||
		BLOCKED_HOST_SUFFIXES.some((suffix) => bareHost.endsWith(suffix))
	) {
		return { ok: false, reason: "Push endpoint hostname is not allowed" };
	}
	if (
		parseIpv4Octets(bareHost) !== null ||
		parseIpv6Groups(bareHost) !== null
	) {
		return {
			ok: false,
			reason:
				"Push endpoint must use a public hostname rather than an IP literal",
		};
	}
	if (!bareHost.includes(".")) {
		return {
			ok: false,
			reason: "Push endpoint must use a fully qualified public hostname",
		};
	}

	return { ok: true, url: parsed };
}
