import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

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

// Keep IPv4 and IPv6 BlockLists separate so ::/3 does not treat IPv4 checks as mapped IPv6.
const BLOCKED_IPV4_LIST = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3],
] as const) {
	BLOCKED_IPV4_LIST.addSubnet(network, prefix, "ipv4");
}

const BLOCKED_IPV6_LIST = new BlockList();
for (const [network, prefix] of [
	["::", 3],
	["4000::", 2],
	["8000::", 1],
	["2001::", 32],
	["2001:10::", 28],
	["2001:db8::", 32],
	["2002::", 16],
] as const) {
	BLOCKED_IPV6_LIST.addSubnet(network, prefix, "ipv6");
}

function stripIpBracketsAndZone(rawIp: string): string {
	let ip = rawIp.trim();
	if (ip.startsWith("[") && ip.endsWith("]")) {
		ip = ip.slice(1, -1);
	}
	const zoneIndex = ip.indexOf("%");
	return zoneIndex === -1 ? ip : ip.slice(0, zoneIndex);
}

/**
 * Returns true if an IPv4 or IPv6 literal falls inside loopback, RFC1918,
 * link-local / cloud metadata (`169.254.169.254`), CGNAT, ULA, multicast,
 * or non-global ranges. Fails closed on unparseable strings.
 */
export function isBlockedIpAddress(rawIp: string): boolean {
	const bare = stripIpBracketsAndZone(rawIp);
	const family = isIP(bare);
	if (family === 4) {
		return BLOCKED_IPV4_LIST.check(bare, "ipv4");
	}
	if (family === 6) {
		if (bare.toLowerCase().startsWith("::ffff:")) {
			const mapped = bare.slice(7);
			if (isIP(mapped) === 4) {
				return BLOCKED_IPV4_LIST.check(mapped, "ipv4");
			}
		}
		return BLOCKED_IPV6_LIST.check(bare, "ipv6");
	}
	return true;
}

export type PushEndpointValidationResult =
	| { ok: true; url: URL }
	| { ok: false; reason: string };

/**
 * Validates that a Web Push subscription endpoint is strictly HTTPS, contains no
 * embedded credentials or non-443 ports, and targets a multi-label public domain name.
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

	const bareHost = stripIpBracketsAndZone(
		parsed.hostname.toLowerCase().replace(TRAILING_DOTS_PATTERN, "")
	);

	if (!bareHost) {
		return { ok: false, reason: "Push endpoint hostname is required" };
	}
	if (
		BLOCKED_EXACT_HOSTNAMES.has(bareHost) ||
		BLOCKED_HOST_SUFFIXES.some((suffix) => bareHost.endsWith(suffix))
	) {
		return { ok: false, reason: "Push endpoint hostname is not allowed" };
	}
	if (isIP(bareHost) !== 0) {
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

export type ResolvePushEndpointResult =
	| { addresses: LookupAddress[]; ok: true; url: URL }
	| {
			cause?: unknown;
			code:
				| "BLOCKED_PUSH_ENDPOINT"
				| "DNS_LOOKUP_FAILED"
				| "INVALID_PUSH_ENDPOINT";
			ok: false;
			reason: string;
	  };

/**
 * Validates a Web Push endpoint URL and resolves its DNS addresses while
 * rejecting loopback, private, link-local, metadata, and non-global IPs.
 */
export async function resolveSafePushEndpoint(
	endpoint: string,
	lookupHostname: (hostname: string) => Promise<LookupAddress[]>
): Promise<ResolvePushEndpointResult> {
	const validation = validatePushEndpointUrl(endpoint);
	if (!validation.ok) {
		return {
			code: "INVALID_PUSH_ENDPOINT",
			ok: false,
			reason: validation.reason,
		};
	}

	let addresses: LookupAddress[];
	try {
		addresses = await lookupHostname(validation.url.hostname);
	} catch (error) {
		return {
			cause: error,
			code: "DNS_LOOKUP_FAILED",
			ok: false,
			reason: "Push endpoint hostname could not be resolved",
		};
	}

	if (
		addresses.length === 0 ||
		addresses.some((entry) => isBlockedIpAddress(entry.address))
	) {
		return {
			code: "BLOCKED_PUSH_ENDPOINT",
			ok: false,
			reason: "Push endpoint resolved to a restricted network address",
		};
	}

	return { addresses, ok: true, url: validation.url };
}
