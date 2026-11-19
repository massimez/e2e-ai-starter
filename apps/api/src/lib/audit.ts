import { BlockList, isIP } from "node:net";
import { db } from "@workspace/db";
import { type AuditLogDetails, auditLog } from "@workspace/db/schema";
import type { Context } from "hono";
import { env } from "../env";
import type { AppEnv } from "./create-hono-app";
import { logError } from "./logger";

export interface AuditLogRecord {
	action: string;
	details?: AuditLogDetails;
	entityId?: string | null;
	entityType?: string | null;
	ipAddress?: string | null;
	organizationId?: string | null;
	userAgent?: string | null;
	userId?: string | null;
}

export type AuditLogWriter = (record: AuditLogRecord) => Promise<void>;

export const DEFAULT_SENSITIVE_READ_PREFIXES = [
	"/auth/admin",
	"/auth/organization",
	"/storage/files",
	"/billing",
	"/admin",
	"/audit",
	"/api-keys",
	"/settings/security",
	"/organization/security",
] as const;

export const API_PREFIX_REGEX = /^\/api(?=\/|$)/u;

const MAX_ACTION_LENGTH = 120;
const MAX_ENTITY_TYPE_LENGTH = 80;

function normalizeIpAddress(raw: string | undefined | null): string | null {
	if (!raw) {
		return null;
	}
	const trimmed = raw.trim();
	const unmapped = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
	return isIP(unmapped) === 0 ? null : unmapped;
}

function addTrustedRuleToBlockList(
	blockList: BlockList,
	rawRule: string
): void {
	const rule = rawRule.trim();
	if (!rule) {
		return;
	}
	const slashIndex = rule.indexOf("/");
	if (slashIndex === -1) {
		const ruleFamily = isIP(rule);
		if (ruleFamily === 4 || ruleFamily === 6) {
			blockList.addAddress(rule, ruleFamily === 6 ? "ipv6" : "ipv4");
		}
		return;
	}
	const network = rule.slice(0, slashIndex);
	const prefix = Number(rule.slice(slashIndex + 1));
	const networkFamily = isIP(network);
	const maxPrefix = networkFamily === 6 ? 128 : 32;
	if (
		(networkFamily === 4 || networkFamily === 6) &&
		Number.isInteger(prefix) &&
		prefix >= 0 &&
		prefix <= maxPrefix
	) {
		blockList.addSubnet(network, prefix, networkFamily === 6 ? "ipv6" : "ipv4");
	}
}

export function isTrustedProxyIp(
	ip: string | null,
	trustedCidrs: readonly string[]
): boolean {
	const normalized = normalizeIpAddress(ip);
	if (!normalized || trustedCidrs.length === 0) {
		return false;
	}

	const blockList = new BlockList();
	for (const rawRule of trustedCidrs) {
		addTrustedRuleToBlockList(blockList, rawRule);
	}

	const targetFamily = isIP(normalized) === 6 ? "ipv6" : "ipv4";
	return blockList.check(normalized, targetFamily);
}

export function extractClientIp(c: Context<AppEnv>): string | null {
	const peerIp = normalizeIpAddress(c.env?.remoteAddress ?? null);

	// Never trust forwarded client headers unless the direct peer is an explicit trusted proxy.
	if (!isTrustedProxyIp(peerIp, env.TRUSTED_PROXY_CIDRS_LIST)) {
		return peerIp;
	}

	const cfIp = normalizeIpAddress(c.req.header("cf-connecting-ip"));
	if (cfIp) {
		return cfIp;
	}

	const forwardedFor = c.req.header("x-forwarded-for");
	if (forwardedFor) {
		const hops = forwardedFor.split(",").map((hop) => normalizeIpAddress(hop));
		// Walk right-to-left to pick the first hop outside trusted proxies.
		for (const hop of hops.reverse()) {
			if (hop && !isTrustedProxyIp(hop, env.TRUSTED_PROXY_CIDRS_LIST)) {
				return hop;
			}
		}
	}

	const realIp = normalizeIpAddress(c.req.header("x-real-ip"));
	if (realIp) {
		return realIp;
	}

	return peerIp;
}

export function normalizeRoutePath(path: string): string {
	const stripped = path.replace(API_PREFIX_REGEX, "");
	return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

export function isSensitiveReadPath(
	path: string,
	sensitivePrefixes: readonly string[] = DEFAULT_SENSITIVE_READ_PREFIXES
): boolean {
	const normalized = normalizeRoutePath(path);
	for (const prefix of sensitivePrefixes) {
		if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
			return true;
		}
	}
	return false;
}

export async function persistAuditLog(record: AuditLogRecord): Promise<void> {
	try {
		await db.insert(auditLog).values({
			action: record.action.slice(0, MAX_ACTION_LENGTH),
			details: record.details ?? {},
			entityId: record.entityId ?? null,
			entityType: record.entityType
				? record.entityType.slice(0, MAX_ENTITY_TYPE_LENGTH)
				: null,
			ipAddress: record.ipAddress ?? null,
			organizationId: record.organizationId ?? null,
			userAgent: record.userAgent ?? null,
			userId: record.userId ?? null,
		});
	} catch (error) {
		logError("persistAuditLog", error, {
			action: record.action.slice(0, MAX_ACTION_LENGTH),
		});
	}
}
