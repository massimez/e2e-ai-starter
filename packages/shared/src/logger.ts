import { createRequire } from "node:module";
import pino, { type DestinationStream } from "pino";

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

const SENSITIVE_KEYS = new Set([
	"accesstoken",
	"apikey",
	"auth",
	"authorization",
	"code",
	"cookie",
	"credential",
	"credentials",
	"idtoken",
	"jwt",
	"otp",
	"otpcode",
	"passwd",
	"password",
	"privatekey",
	"refreshtoken",
	"secret",
	"secretkey",
	"sessiontoken",
	"setcookie",
	"sig",
	"signature",
	"state",
	"token",
	"verificationcode",
]);

const SENSITIVE_SUFFIXES = [
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

function normalizeKey(key: string): string {
	return key.toLowerCase().replace(KEY_SEPARATOR_REGEX, "");
}

function isSensitiveKey(key: string): boolean {
	if (SENSITIVE_KEYS.has(normalizeKey(key))) {
		return true;
	}
	const snake = key
		.replace(CAMEL_TO_SNAKE_REGEX, "$<lower>_$<upper>")
		.toLowerCase();
	return SENSITIVE_SUFFIXES.some((suffix) => snake.endsWith(suffix));
}

function scrubString(value: string): string {
	return value
		.replace(URL_USERINFO_REGEX, "$<scheme>[REDACTED]@")
		.replace(BEARER_HEADER_REGEX, "$<scheme>[REDACTED]")
		.replace(JWT_REGEX, "[REDACTED_JWT]");
}

function redactQuery(rawQuery: string): string {
	if (!rawQuery) {
		return "";
	}
	const parts: string[] = [];
	for (const part of rawQuery.split("&")) {
		if (!part) {
			continue;
		}
		const eq = part.indexOf("=");
		if (eq === -1) {
			parts.push(scrubString(part));
			continue;
		}
		const key = part.slice(0, eq);
		let decodedKey = key;
		try {
			decodedKey = decodeURIComponent(key);
		} catch {
			// Keep raw key
		}
		parts.push(
			SENSITIVE_KEYS.has(normalizeKey(decodedKey))
				? `${key}=[REDACTED]`
				: `${key}=${scrubString(part.slice(eq + 1))}`
		);
	}
	return parts.join("&");
}

/** Redacts token-bearing path segments, JWTs, URL userinfo, and secret query parameters. */
export function sanitizeRequestPath(path: string): string {
	const hashIndex = path.indexOf("#");
	const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
	const queryIndex = withoutHash.indexOf("?");
	const pathname =
		queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
	const safePath = scrubString(
		pathname.replace(SENSITIVE_PATH_TOKEN_REGEX, "$<prefix>[REDACTED]")
	);
	if (queryIndex === -1) {
		return safePath;
	}
	const safeQuery = redactQuery(withoutHash.slice(queryIndex + 1));
	return safeQuery ? `${safePath}?${safeQuery}` : safePath;
}

/** Redacts sensitive path tokens, query secrets, bearer tokens, and URL credentials from raw log text. */
export function redactRequestLog(message: string): string {
	return scrubString(
		message.replace(SENSITIVE_PATH_TOKEN_REGEX, "$<prefix>[REDACTED]")
	).replace(QUERY_SEGMENT_REGEX, (_full, query: string) => {
		const redacted = redactQuery(query);
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

function getErrorHeadline(error: unknown): string {
	if (!(error instanceof Error)) {
		return scrubString(String(error));
	}
	const trimmed = error.message.trim();
	if (trimmed.length > 0) {
		return scrubString(trimmed);
	}
	if ("errors" in error && Array.isArray(error.errors)) {
		const nested = Array.from(
			new Set(error.errors.map(getErrorHeadline).filter(Boolean))
		);
		if (nested.length > 0) {
			return nested.join("; ");
		}
	}
	return error.name || "Error";
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
		return { message: getErrorHeadline(error), name: "Error" };
	}
	const rawCode = (error as { code?: unknown }).code;
	const code =
		typeof rawCode === "string" || typeof rawCode === "number"
			? rawCode
			: undefined;
	const aggregate =
		"errors" in error && Array.isArray(error.errors)
			? Array.from(
					new Set(
						error.errors.map(getErrorHeadline).filter(Boolean).slice(0, 5)
					)
				)
			: [];
	const cause =
		error.cause === undefined ? undefined : formatCauseChain(error.cause);
	const stack =
		includeStack && error.stack ? scrubString(error.stack) : undefined;

	return {
		...(cause ? { cause } : {}),
		...(code === undefined ? {} : { code }),
		...(aggregate.length > 1 ? { errors: aggregate } : {}),
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
		return scrubString(value);
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
		if (isSensitiveKey(key)) {
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
		if (isSensitiveKey(key)) {
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

function resolveOption<const T extends readonly string[]>(
	value: unknown,
	allowed: T,
	fallback: T[number]
): T[number] {
	const normalized = normalizeOptionalLogEnv(value);
	return normalized && allowed.includes(normalized)
		? (normalized as T[number])
		: fallback;
}

function resolveColors(explicit?: boolean): boolean {
	if (explicit !== undefined) {
		return explicit;
	}
	if (process.env.NO_COLOR || process.env.FORCE_COLOR === "0") {
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
	return durationMs < 1000
		? `${Math.round(durationMs)}ms`
		: `${(durationMs / 1000).toFixed(2)}s`;
}

function resolveHttpLevel(entry: HttpRequestLog): ActiveLogLevel {
	if (entry.status >= 500) {
		return "error";
	}
	if (entry.status >= 400) {
		return "warn";
	}
	return entry.method === "OPTIONS" ? "debug" : "info";
}

function writeToSink(
	sink: LoggerSink,
	level: ActiveLogLevel,
	line: string
): void {
	if (level === "debug") {
		(sink.debug ?? sink.info)(line);
		return;
	}
	sink[level](line);
}

const DEFAULT_SINK: LoggerSink = {
	debug: (line) => console.debug(line),
	error: (line) => console.error(line),
	info: (line) => console.log(line),
	warn: (line) => console.warn(line),
};

const requireFromHere = createRequire(import.meta.url);

function loadPrettyFactory(
	colors: boolean
): ((input: string | Record<string, unknown>) => string) | null {
	try {
		const mod = requireFromHere("pino-pretty") as {
			prettyFactory?: (
				opts: Record<string, unknown>
			) => (input: string | Record<string, unknown>) => string;
		};
		if (typeof mod.prettyFactory !== "function") {
			return null;
		}
		return mod.prettyFactory({
			colorize: colors,
			errorLikeObjectKeys: ["error", "err"],
			hideObject: false,
			ignore: "service,context",
			levelKey: "level",
			messageFormat: (log: Record<string, unknown>, messageKey: string) => {
				const msg = String(log[messageKey] ?? "");
				return typeof log.context === "string"
					? `[${log.context}] ${msg}`
					: msg;
			},
			messageKey: "message",
			singleLine: true,
			timestampKey: "timestamp",
			translateTime: "SYS:HH:MM:ss.l",
		});
	} catch {
		return null;
	}
}

/** Creates a structured logger backed by Pino with lazy dev-only pino-pretty formatting. */
export function createLogger(options: LoggerOptions = {}): Logger {
	const format =
		options.format ??
		resolveOption(
			process.env.LOG_FORMAT,
			LOG_FORMATS,
			process.env.NODE_ENV === "production" ? "json" : "pretty"
		);
	const level =
		options.level ??
		resolveOption(
			process.env.LOG_LEVEL,
			LOG_LEVELS,
			process.env.NODE_ENV === "test" ? "silent" : "info"
		);
	const includeStack =
		options.includeStack ??
		(process.env.NODE_ENV !== "production" || level === "debug");

	const sink = options.sink ?? DEFAULT_SINK;
	const formatPretty =
		format === "pretty"
			? loadPrettyFactory(resolveColors(options.colors))
			: null;

	// Track active level synchronously across Pino's synchronous `write` call to avoid JSON.parse in JSON mode
	let activeEmitLevel: ActiveLogLevel = "info";
	const destination: DestinationStream = {
		write(chunk: string): void {
			const trimmed = chunk.trimEnd();
			const output = formatPretty ? formatPretty(trimmed).trimEnd() : trimmed;
			writeToSink(sink, activeEmitLevel, output);
		},
	};

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
		destination
	);

	function emit(
		emitLevel: ActiveLogLevel,
		context: string,
		message: string,
		metadata?: LogMetadata,
		error?: SerializedError
	): void {
		activeEmitLevel = emitLevel;
		pinoInstance[emitLevel](
			{
				context,
				...(error ? { error } : {}),
				...sanitizeMetadata(metadata),
				...(error?.code === undefined ? {} : { code: error.code }),
			},
			scrubString(message)
		);
	}

	return {
		logDebug: (context, message, metadata) =>
			emit("debug", context, message, metadata),
		logInfo: (context, message, metadata) =>
			emit("info", context, message, metadata),
		logWarning: (context, message, metadata) =>
			emit("warn", context, message, metadata),
		logError: (context, error, metadata) => {
			const serialized = serializeError(error, includeStack);
			emit("error", context, serialized.message, metadata, serialized);
		},
		logHttp: (entry) => {
			const safePath = sanitizeRequestPath(entry.path);
			const method = entry.method.toUpperCase();
			const summary = `${method} ${safePath} ${entry.status} (${formatDuration(entry.durationMs)})`;
			const metadata: LogMetadata =
				format === "json"
					? {
							durationMs: Math.round(entry.durationMs * 10) / 10,
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
			emit(resolveHttpLevel(entry), "HTTP", summary, metadata);
		},
	};
}

export const defaultLogger = createLogger({ service: "api" });
export const { logDebug, logError, logHttp, logInfo, logWarning } =
	defaultLogger;
