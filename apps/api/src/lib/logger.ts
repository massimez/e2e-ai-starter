import pino, { type DestinationStream } from "pino";
import { prettyFactory } from "pino-pretty";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type ActiveLogLevel = Exclude<LogLevel, "silent">;

export const LOG_FORMATS = ["pretty", "json"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

export type LogMetadata = Record<string, unknown>;

export interface HttpRequestLog {
	durationMs: number;
	method: string;
	organizationId?: string;
	path: string;
	requestId?: string;
	status: number;
	userId?: string;
}

export interface LoggerSink {
	debug?: (line: string) => void;
	error: (line: string) => void;
	info: (line: string) => void;
	warn: (line: string) => void;
}

export interface LoggerOptions {
	colors?: boolean;
	format?: LogFormat;
	includeStack?: boolean;
	level?: LogLevel;
	service?: string;
	sink?: LoggerSink;
}

export interface Logger {
	logDebug: (context: string, message: string, metadata?: LogMetadata) => void;
	logError: (context: string, error: unknown, metadata?: LogMetadata) => void;
	logHttp: (entry: HttpRequestLog) => void;
	logInfo: (context: string, message: string, metadata?: LogMetadata) => void;
	logWarning: (
		context: string,
		message: string,
		metadata?: LogMetadata
	) => void;
}

const SENSITIVE_PATH_TOKEN_REGEX =
	/(?<prefix>\/(?:tokens|actions|invitations|reset-password|verify-email|magic-link)\/)[^/?#\s]+/giu;
const QUERY_SEGMENT_REGEX = /\?(?<query>[^\s#]*)/gu;
const JWT_REGEX = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/gu;
const URL_USERINFO_REGEX =
	/\b(?<scheme>[a-z][a-z0-9+.-]*:\/\/)(?<credentials>[^/\s@:]+(?::[^/\s@]*)?)@/giu;
const BEARER_HEADER_REGEX = /\b(?<scheme>Bearer\s+)[A-Za-z0-9._~+/-]+=*/giu;
const CAMEL_TO_SNAKE_REGEX = /(?<lower>[a-z0-9])(?<upper>[A-Z])/gu;
const KEY_SEPARATOR_REGEX = /[_-]/gu;

const SENSITIVE_QUERY_KEYS = new Set([
	"accesstoken",
	"apikey",
	"auth",
	"code",
	"credential",
	"idtoken",
	"jwt",
	"passwd",
	"password",
	"privatekey",
	"refreshtoken",
	"secret",
	"secretkey",
	"sessiontoken",
	"sig",
	"signature",
	"state",
	"token",
]);

const SENSITIVE_METADATA_EXACT = new Set([
	"accesstoken",
	"apikey",
	"authorization",
	"cookie",
	"credential",
	"credentials",
	"idtoken",
	"otp",
	"otpcode",
	"passwd",
	"password",
	"privatekey",
	"refreshtoken",
	"secret",
	"sessiontoken",
	"setcookie",
	"sig",
	"signature",
	"token",
	"verificationcode",
]);

const SENSITIVE_METADATA_SUFFIXES = [
	"_password",
	"_passwd",
	"_secret",
	"_token",
	"_api_key",
	"_private_key",
	"_signature",
	"_cookie",
	"_credential",
	"_credentials",
];

const RESERVED_ROOT_KEYS = new Set([
	"context",
	"error",
	"level",
	"message",
	"service",
	"timestamp",
]);

function normalizeKeyForMatch(key: string): string {
	return key.toLowerCase().replace(KEY_SEPARATOR_REGEX, "");
}

function isSensitiveMetadataKey(key: string): boolean {
	if (SENSITIVE_METADATA_EXACT.has(normalizeKeyForMatch(key))) {
		return true;
	}
	const snake = key
		.replace(CAMEL_TO_SNAKE_REGEX, "$<lower>_$<upper>")
		.toLowerCase();
	return SENSITIVE_METADATA_SUFFIXES.some((suffix) => snake.endsWith(suffix));
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function scrubStringSecrets(value: string): string {
	return value
		.replace(URL_USERINFO_REGEX, "$<scheme>[REDACTED]@")
		.replace(BEARER_HEADER_REGEX, "$<scheme>[REDACTED]")
		.replace(JWT_REGEX, "[REDACTED_JWT]");
}

function redactQueryString(rawQuery: string): string {
	if (!rawQuery) {
		return "";
	}
	const redactedParts: string[] = [];

	for (const part of rawQuery.split("&")) {
		if (!part) {
			continue;
		}
		const eqIndex = part.indexOf("=");
		if (eqIndex === -1) {
			redactedParts.push(scrubStringSecrets(part));
			continue;
		}

		const rawKey = part.slice(0, eqIndex);
		const normalizedKey = normalizeKeyForMatch(safeDecode(rawKey));
		if (SENSITIVE_QUERY_KEYS.has(normalizedKey)) {
			redactedParts.push(`${rawKey}=[REDACTED]`);
			continue;
		}

		redactedParts.push(
			`${rawKey}=${scrubStringSecrets(part.slice(eqIndex + 1))}`
		);
	}

	return redactedParts.join("&");
}

/**
 * Redacts token-bearing path segments, JWTs, URL userinfo, and secret query
 * parameters while keeping legitimate route segments and non-secret query keys intact.
 */
export function sanitizeRequestPath(path: string): string {
	const hashIndex = path.indexOf("#");
	const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
	const queryIndex = withoutHash.indexOf("?");
	const pathname =
		queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);

	const safePathname = scrubStringSecrets(
		pathname.replace(SENSITIVE_PATH_TOKEN_REGEX, "$<prefix>[REDACTED]")
	);

	if (queryIndex === -1) {
		return safePathname;
	}

	const safeQuery = redactQueryString(withoutHash.slice(queryIndex + 1));
	return safeQuery ? `${safePathname}?${safeQuery}` : safePathname;
}

/** Redacts sensitive path tokens, query secrets, bearer tokens, and URL credentials from raw log text. */
export function redactRequestLog(message: string): string {
	return scrubStringSecrets(
		message.replace(SENSITIVE_PATH_TOKEN_REGEX, "$<prefix>[REDACTED]")
	).replace(QUERY_SEGMENT_REGEX, (_full, query: string) => {
		const redacted = redactQueryString(query);
		return redacted ? `?${redacted}` : "";
	});
}

interface SerializedError {
	cause?: string;
	code?: string | number;
	errors?: string[];
	message: string;
	name: string;
	stack?: string;
}

function getAggregateSubErrors(error: Error): unknown[] {
	return "errors" in error && Array.isArray(error.errors) ? error.errors : [];
}

function getErrorHeadline(error: unknown): string {
	if (error instanceof Error) {
		const trimmed = error.message.trim();
		if (trimmed.length > 0) {
			return scrubStringSecrets(trimmed);
		}
		const nestedMessages = Array.from(
			new Set(
				getAggregateSubErrors(error)
					.map(getErrorHeadline)
					.filter((item) => item.length > 0)
			)
		);
		if (nestedMessages.length > 0) {
			return nestedMessages.join("; ");
		}
		return error.name || "Error";
	}
	return scrubStringSecrets(String(error));
}

function formatCauseChain(cause: unknown, depth = 0): string | undefined {
	if (cause === undefined || cause === null || depth >= 3) {
		return undefined;
	}
	const headline = getErrorHeadline(cause);
	if (cause instanceof Error && cause.cause !== undefined) {
		const nested = formatCauseChain(cause.cause, depth + 1);
		return nested ? `${headline} <- ${nested}` : headline;
	}
	return headline;
}

function serializeError(
	error: unknown,
	includeStack: boolean
): SerializedError {
	if (!(error instanceof Error)) {
		return {
			message: getErrorHeadline(error),
			name: "Error",
		};
	}

	const rawCode = (error as { code?: unknown }).code;
	const code =
		typeof rawCode === "string" || typeof rawCode === "number"
			? rawCode
			: undefined;

	const uniqueAggregate = Array.from(
		new Set(
			getAggregateSubErrors(error)
				.map(getErrorHeadline)
				.filter((item) => item.length > 0)
				.slice(0, 5)
		)
	);

	const cause =
		error.cause === undefined ? undefined : formatCauseChain(error.cause);
	const stack =
		includeStack && error.stack ? scrubStringSecrets(error.stack) : undefined;

	return {
		...(cause ? { cause } : {}),
		...(code === undefined ? {} : { code }),
		...(uniqueAggregate.length > 1 ? { errors: uniqueAggregate } : {}),
		message: getErrorHeadline(error),
		name: error.name || "Error",
		...(stack ? { stack } : {}),
	};
}

function sanitizeValue(
	value: unknown,
	depth: number,
	seen: WeakSet<object>
): unknown {
	if (value === undefined) {
		return undefined;
	}
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return value;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "string") {
		return scrubStringSecrets(value);
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
	}
	if (value instanceof Error) {
		return serializeError(value, false);
	}
	if (depth >= 6) {
		return "[MaxDepth]";
	}
	if (typeof value !== "object") {
		return String(value);
	}
	if (seen.has(value)) {
		return "[Circular]";
	}
	seen.add(value);

	if (Array.isArray(value)) {
		const mapped = value
			.map((item) => sanitizeValue(item, depth + 1, seen))
			.filter((item) => item !== undefined);
		seen.delete(value);
		return mapped;
	}

	const result: Record<string, unknown> = {};
	for (const [key, entryValue] of Object.entries(value)) {
		if (entryValue === undefined) {
			continue;
		}
		if (isSensitiveMetadataKey(key)) {
			result[key] = "[REDACTED]";
			continue;
		}
		const sanitized = sanitizeValue(entryValue, depth + 1, seen);
		if (sanitized !== undefined) {
			result[key] = sanitized;
		}
	}
	seen.delete(value);
	return result;
}

function sanitizeMetadata(metadata?: LogMetadata): Record<string, unknown> {
	if (!metadata) {
		return {};
	}
	const seen = new WeakSet<object>();
	const clean: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(metadata)) {
		if (value === undefined || RESERVED_ROOT_KEYS.has(key)) {
			continue;
		}
		if (isSensitiveMetadataKey(key)) {
			clean[key] = "[REDACTED]";
			continue;
		}
		const sanitized = sanitizeValue(value, 0, seen);
		if (sanitized !== undefined) {
			clean[key] = sanitized;
		}
	}

	return clean;
}

/** Normalizes an optional env value to lowercase or `undefined` when empty. */
export function normalizeOptionalLogEnv(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : undefined;
}

function matchAllowedOption<const T extends readonly string[]>(
	value: unknown,
	allowed: T
): T[number] | undefined {
	const normalized = normalizeOptionalLogEnv(value);
	return normalized && allowed.includes(normalized)
		? (normalized as T[number])
		: undefined;
}

function resolveDefaultLevel(): LogLevel {
	const configured = matchAllowedOption(process.env.LOG_LEVEL, LOG_LEVELS);
	if (configured) {
		return configured;
	}
	return process.env.NODE_ENV === "test" ? "silent" : "info";
}

function resolveDefaultFormat(): LogFormat {
	const configured = matchAllowedOption(process.env.LOG_FORMAT, LOG_FORMATS);
	if (configured) {
		return configured;
	}
	return process.env.NODE_ENV === "production" ? "json" : "pretty";
}

function resolveColors(explicit?: boolean): boolean {
	if (explicit !== undefined) {
		return explicit;
	}
	if (process.env.NO_COLOR) {
		return false;
	}
	if (process.env.FORCE_COLOR === "0") {
		return false;
	}
	if (process.env.FORCE_COLOR) {
		return true;
	}
	return Boolean(process.stdout?.isTTY);
}

function formatDuration(durationMs: number): string {
	if (durationMs < 1) {
		return `${durationMs.toFixed(1)}ms`;
	}
	if (durationMs < 1000) {
		return `${Math.round(durationMs)}ms`;
	}
	return `${(durationMs / 1000).toFixed(2)}s`;
}

function resolveHttpLevel(entry: HttpRequestLog): ActiveLogLevel {
	if (entry.status >= 500) {
		return "error";
	}
	if (entry.status >= 400) {
		return "warn";
	}
	if (entry.method === "OPTIONS") {
		return "debug";
	}
	return "info";
}

function writeToSink(
	sink: LoggerSink,
	level: ActiveLogLevel,
	line: string
): void {
	switch (level) {
		case "debug":
			(sink.debug ?? sink.info)(line);
			break;
		case "info":
			sink.info(line);
			break;
		case "warn":
			sink.warn(line);
			break;
		case "error":
			sink.error(line);
			break;
		default:
			sink.info(line);
			break;
	}
}

const DEFAULT_SINK: LoggerSink = {
	debug: (line) => console.debug(line),
	error: (line) => console.error(line),
	info: (line) => console.log(line),
	warn: (line) => console.warn(line),
};

function createPinoDestination(options: {
	colors: boolean;
	format: LogFormat;
	sink: LoggerSink;
}): DestinationStream {
	const formatPretty =
		options.format === "pretty"
			? prettyFactory({
					colorize: options.colors,
					errorLikeObjectKeys: ["error", "err"],
					hideObject: false,
					ignore: "service,context",
					levelKey: "level",
					messageFormat: (log, messageKey) => {
						const msg = String(log[messageKey] ?? "");
						return typeof log.context === "string"
							? `[${log.context}] ${msg}`
							: msg;
					},
					messageKey: "message",
					singleLine: true,
					timestampKey: "timestamp",
					translateTime: "SYS:HH:MM:ss.l",
				})
			: null;

	return {
		write(chunk: string): void {
			const trimmed = chunk.trimEnd();
			const parsed = JSON.parse(trimmed) as Record<string, unknown> & {
				level?: ActiveLogLevel;
			};
			const level: ActiveLogLevel = parsed.level ?? "info";
			const output = formatPretty ? formatPretty(parsed).trimEnd() : trimmed;
			writeToSink(options.sink, level, output);
		},
	};
}

/** Creates a structured logger powered by Pino and pino-pretty. */
export function createLogger(options: LoggerOptions = {}): Logger {
	const format = options.format ?? resolveDefaultFormat();
	const level = options.level ?? resolveDefaultLevel();
	const colors = resolveColors(options.colors);
	const includeStack =
		options.includeStack ??
		(process.env.NODE_ENV !== "production" || level === "debug");

	const pinoInstance = pino(
		{
			base: options.service ? { service: options.service } : null,
			formatters: {
				level: (label) => ({ level: label }),
			},
			level,
			messageKey: "message",
			serializers: {
				error: (value: unknown) => value,
			},
			timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
		},
		createPinoDestination({
			colors,
			format,
			sink: options.sink ?? DEFAULT_SINK,
		})
	);

	function emit(
		activeLevel: ActiveLogLevel,
		context: string,
		message: string,
		metadata?: LogMetadata,
		error?: SerializedError
	): void {
		const payload: Record<string, unknown> = {
			context,
			...(error ? { error } : {}),
			...sanitizeMetadata(metadata),
		};
		pinoInstance[activeLevel](payload, scrubStringSecrets(message));
	}

	return {
		logDebug(context: string, message: string, metadata?: LogMetadata): void {
			emit("debug", context, message, metadata);
		},

		logInfo(context: string, message: string, metadata?: LogMetadata): void {
			emit("info", context, message, metadata);
		},

		logWarning(context: string, message: string, metadata?: LogMetadata): void {
			emit("warn", context, message, metadata);
		},

		logError(context: string, error: unknown, metadata?: LogMetadata): void {
			const serialized = serializeError(error, includeStack);
			const enrichedMetadata: LogMetadata = {
				...metadata,
				...(serialized.code === undefined ? {} : { code: serialized.code }),
			};
			emit("error", context, serialized.message, enrichedMetadata, serialized);
		},

		logHttp(entry: HttpRequestLog): void {
			const httpLevel = resolveHttpLevel(entry);
			const safePath = sanitizeRequestPath(entry.path);
			const roundedDuration = Math.round(entry.durationMs * 10) / 10;
			const method = entry.method.toUpperCase();
			const summary = `${method} ${safePath} ${entry.status} (${formatDuration(entry.durationMs)})`;

			const metadata: LogMetadata =
				format === "json"
					? {
							durationMs: roundedDuration,
							method,
							organizationId: entry.organizationId,
							path: safePath,
							requestId: entry.requestId,
							status: entry.status,
							userId: entry.userId,
						}
					: {
							organizationId: entry.organizationId,
							requestId: entry.requestId,
							userId: entry.userId,
						};

			emit(httpLevel, "HTTP", summary, metadata);
		},
	};
}

export const apiLogger = createLogger({ service: "api" });

export const { logDebug, logError, logHttp, logInfo, logWarning } = apiLogger;
