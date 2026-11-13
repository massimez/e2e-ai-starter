import { isIP } from "node:net";
import { db } from "@workspace/db";
import { type AuditLogDetails, auditLog } from "@workspace/db/schema";
import type { Context } from "hono";
import { env } from "../env";
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

function ipv4ToUint32(ip: string): number | null {
	if (isIP(ip) !== 4) {
		return null;
	}
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return null;
	}
	let acc = 0;
	for (const part of parts) {
		const octet = Number(part);
		if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
			return null;
		}
		acc = acc * 256 + octet;
	}
	return acc;
}

function isIpMatchCidr(ip: string, rule: string): boolean {
	if (ip === rule) {
		return true;
	}

	const slashIndex = rule.indexOf("/");
	if (slashIndex === -1) {
		return false;
	}

	const network = rule.slice(0, slashIndex);
	const prefixLen = Number(rule.slice(slashIndex + 1));
	const ipNum = ipv4ToUint32(ip);
	const networkNum = ipv4ToUint32(network);

	if (
		ipNum === null ||
		networkNum === null ||
		!Number.isInteger(prefixLen) ||
		prefixLen < 0 ||
		prefixLen > 32
	) {
		return false;
	}

	const blockSize = 2 ** (32 - prefixLen);
	return Math.floor(ipNum / blockSize) === Math.floor(networkNum / blockSize);
}

export function isTrustedProxyIp(
	ip: string | null,
	trustedCidrs: readonly string[]
): boolean {
	if (!ip || trustedCidrs.length === 0) {
		return false;
	}
	return trustedCidrs.some((cidr) => isIpMatchCidr(ip, cidr));
}

export function extractClientIp(c: Context): string | null {
	const rawEnv = c.env as { remoteAddress?: string | null } | undefined;
	const peerIp = normalizeIpAddress(rawEnv?.remoteAddress ?? null);

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
