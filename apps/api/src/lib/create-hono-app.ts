import {
	logDebug,
	logError,
	sanitizeRequestPath,
} from "@workspace/shared/logger";
import { APIError } from "better-auth/api";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { validator } from "hono/validator";
import { z } from "zod";
import { env } from "../env";
import { httpLoggerMiddleware } from "../middleware/http-logger";
import { requestIdMiddleware } from "../middleware/request-id";
import type { Session, User } from "./auth/index";
import { AppError, AuthError } from "./errors";

export interface AuditMetaOverride {
	action?: string;
	details?: Record<string, unknown>;
	entityId?: string | null;
	entityType?: string | null;
	organizationId?: string | null;
}

export interface AppEnv {
	Bindings: {
		remoteAddress?: string | null;
	};
	Variables: {
		auditMeta?: AuditMetaOverride;
		permissionCache?: Set<string>;
		requestId?: string;
		securityEvent?: unknown;
		session?: Session["session"] | null;
		tenantId?: string | null;
		user?: User | null;
	};
}

export interface SuccessResponse<T> {
	data: T;
	message?: string;
	success: true;
}

export interface ErrorResponse {
	error: {
		issues?: Array<{
			code: string;
			message: string;
			path: (string | number)[];
		}>;
		message: string;
		name: string;
	};
	success: false;
}

export function createSuccessResponse<T>(
	data: T,
	message?: string
): SuccessResponse<T> {
	return {
		data,
		message,
		success: true,
	};
}

export function createErrorResponse(
	name: string,
	message: string,
	issues: Array<{
		code: string;
		message: string;
		path: (string | number)[];
	}> = []
): ErrorResponse {
	return {
		error: {
			issues,
			message,
			name,
		},
		success: false,
	};
}

export function zodErrorToResponse(zodError: z.ZodError): ErrorResponse {
	return createErrorResponse(
		"ValidationError",
		"Validation failed",
		zodError.issues.map((issue) => ({
			code: issue.code,
			message: issue.message,
			path: issue.path.map((p) => String(p)),
		}))
	);
}

type RpcValidatorInput<
	Target extends "json" | "query" | "param",
	Input,
> = Target extends "json" ? Input : { [K in keyof Input]: string | string[] };

function zodValidator<
	Target extends "json" | "query" | "param",
	T extends z.ZodType,
>(
	target: Target,
	schema: T
): MiddlewareHandler<
	AppEnv,
	string,
	{
		in: { [K in Target]: RpcValidatorInput<Target, z.input<T>> };
		out: { [K in Target]: z.output<T> };
	}
> {
	return validator(target, (value, c) => {
		const parsed = schema.safeParse(value);
		if (!parsed.success) {
			return c.json(zodErrorToResponse(parsed.error), 400);
		}
		return parsed.data as z.output<T>;
	}) as unknown as MiddlewareHandler<
		AppEnv,
		string,
		{
			in: { [K in Target]: RpcValidatorInput<Target, z.input<T>> };
			out: { [K in Target]: z.output<T> };
		}
	>;
}

export const jsonValidator = <T extends z.ZodType>(schema: T) =>
	zodValidator("json", schema);

export const queryValidator = <T extends z.ZodType>(schema: T) =>
	zodValidator("query", schema);

export const paramValidator = <T extends z.ZodType>(schema: T) =>
	zodValidator("param", schema);

export function requireUser(c: Context<AppEnv>): User {
	const user = c.get("user");
	if (!user) {
		throw new AuthError("User not found");
	}
	return user;
}

function normalizeHttpStatus(status: number): ContentfulStatusCode {
	if (status >= 400 && status <= 599) {
		return status as ContentfulStatusCode;
	}
	return 500;
}

function getSafeErrorMessage(status: number, originalMessage: string): string {
	if (status === 503) {
		return "Service unavailable";
	}
	if (status >= 500) {
		return "Internal server error";
	}
	return originalMessage;
}

function resolveApiErrorPayload(err: Error): {
	body: ErrorResponse;
	status: ContentfulStatusCode;
} {
	if (err instanceof HTTPException) {
		const status = normalizeHttpStatus(err.status);
		return {
			body: createErrorResponse(
				"HTTPException",
				getSafeErrorMessage(status, err.message)
			),
			status,
		};
	}

	if (err instanceof AppError) {
		const status = normalizeHttpStatus(err.statusCode);
		const issues = err.path
			? [
					{
						code: err.code || "APP_ERROR",
						message: err.message,
						path: err.path,
					},
				]
			: [];
		return {
			body: createErrorResponse(
				err.name,
				getSafeErrorMessage(status, err.message),
				issues
			),
			status,
		};
	}

	if (err instanceof APIError) {
		const status = normalizeHttpStatus(err.statusCode);
		return {
			body: createErrorResponse(
				typeof err.status === "string" ? err.status : "APIError",
				getSafeErrorMessage(status, err.message)
			),
			status,
		};
	}

	if (err instanceof z.ZodError || err.name === "ZodError") {
		return {
			body: zodErrorToResponse(err as unknown as z.ZodError),
			status: 400,
		};
	}

	return {
		body: createErrorResponse(
			"InternalServerError",
			"An unexpected error occurred"
		),
		status: 500,
	};
}

function handleApiError(err: Error, c: Context<AppEnv>): Response {
	const { body, status } = resolveApiErrorPayload(err);
	const logContext = {
		method: c.req.method,
		path: sanitizeRequestPath(c.req.path),
		requestId: c.get("requestId"),
		status,
	};

	if (status >= 500) {
		logError("API", err, logContext);
	} else {
		logDebug("API", `${err.name}: ${err.message}`, logContext);
	}

	return c.json(body, status);
}

export function createRouter() {
	return new Hono<AppEnv>();
}

const DEFAULT_API_BODY_LIMIT_BYTES = 2 * 1024 * 1024; // 2 MB for API JSON bodies

export function createApp() {
	const app = new Hono<AppEnv>();

	app.use(requestIdMiddleware());
	app.use(secureHeaders());
	app.use(httpLoggerMiddleware());
	app.use(
		"/api/*",
		cors({
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"x-organization-id",
				"x-request-id",
			],
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			credentials: true,
			exposeHeaders: [
				"Content-Disposition",
				"x-request-id",
				"X-AI-Thread-Id",
				"X-RateLimit-Limit",
				"X-RateLimit-Remaining",
				"X-RateLimit-Reset",
				"Retry-After",
			],
			origin: (origin) => {
				if (!origin) {
					return null;
				}
				if (env.CORS_ORIGINS.includes(origin)) {
					return origin;
				}
				return null;
			},
		})
	);
	app.use(
		"/api/*",
		bodyLimit({
			maxSize: DEFAULT_API_BODY_LIMIT_BYTES,
			onError: (ctx) =>
				ctx.json(
					createErrorResponse(
						"PayloadTooLarge",
						"Request body exceeds 2MB limit"
					),
					413
				),
		})
	);

	app.onError((err, c) => handleApiError(err, c));

	app.notFound((c) =>
		c.json(
			createErrorResponse(
				"NotFound",
				`Path ${sanitizeRequestPath(c.req.path)} not found`
			),
			404
		)
	);

	return app;
}
