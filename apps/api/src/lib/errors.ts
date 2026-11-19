export interface AppErrorOptions extends ErrorOptions {
	code?: string;
	path?: (string | number)[];
	statusCode?: number;
}

export interface DomainErrorOptions extends ErrorOptions {
	code?: string;
	field?: string;
}

function resolveAppErrorArgs(
	statusOrOptions: number | AppErrorOptions,
	code?: string,
	path?: (string | number)[],
	options?: ErrorOptions
) {
	if (typeof statusOrOptions === "number") {
		return { code, options, path, statusCode: statusOrOptions };
	}
	return {
		code: statusOrOptions.code,
		options: statusOrOptions,
		path: statusOrOptions.path,
		statusCode: statusOrOptions.statusCode ?? 500,
	};
}

function resolveDomainErrorArgs(
	fieldOrOptions?: string | DomainErrorOptions,
	options?: ErrorOptions
) {
	const field =
		typeof fieldOrOptions === "string" ? fieldOrOptions : fieldOrOptions?.field;
	const code =
		typeof fieldOrOptions === "object" ? fieldOrOptions?.code : undefined;
	const resolvedOptions =
		typeof fieldOrOptions === "object" ? fieldOrOptions : options;
	return { code, field, options: resolvedOptions };
}

export class AppError extends Error {
	statusCode: number;
	code?: string;
	path?: (string | number)[];

	constructor(
		message: string,
		statusOrOptions: number | AppErrorOptions = 500,
		code?: string,
		path?: (string | number)[],
		options?: ErrorOptions
	) {
		const resolved = resolveAppErrorArgs(statusOrOptions, code, path, options);
		super(message, resolved.options);
		this.statusCode = resolved.statusCode;
		this.code = resolved.code;
		this.path = resolved.path;
		this.name = "AppError";
	}
}

export class ValidationError extends AppError {
	field?: string;

	constructor(
		message: string,
		fieldOrOptions?: string | DomainErrorOptions,
		options?: ErrorOptions
	) {
		const resolved = resolveDomainErrorArgs(fieldOrOptions, options);
		super(
			message,
			400,
			resolved.code ?? "VALIDATION_ERROR",
			resolved.field ? [resolved.field] : undefined,
			resolved.options
		);
		this.field = resolved.field;
		this.name = "ValidationError";
	}
}

export class AuthError extends AppError {
	constructor(
		message = "Unauthorized",
		statusCode = 401,
		code = "AUTH_ERROR",
		options?: ErrorOptions
	) {
		super(message, statusCode, code, undefined, options);
		this.name = "AuthError";
	}
}

export class ForbiddenError extends AppError {
	constructor(
		message = "Forbidden",
		statusCode = 403,
		code = "FORBIDDEN",
		options?: ErrorOptions
	) {
		super(message, statusCode, code, undefined, options);
		this.name = "ForbiddenError";
	}
}

const NOT_FOUND_SUFFIX_REGEX = /\bnot found\b/iu;

export class NotFoundError extends AppError {
	constructor(
		resource = "Resource",
		fieldOrOptions?: string | DomainErrorOptions,
		options?: ErrorOptions
	) {
		const resolved = resolveDomainErrorArgs(fieldOrOptions, options);
		const message = NOT_FOUND_SUFFIX_REGEX.test(resource)
			? resource
			: `${resource} not found`;
		super(
			message,
			404,
			resolved.code ?? "NOT_FOUND",
			resolved.field ? [resolved.field] : undefined,
			resolved.options
		);
		this.name = "NotFoundError";
	}
}

export class ConflictError extends AppError {
	constructor(
		message = "Conflict",
		fieldOrOptions?: string | DomainErrorOptions,
		options?: ErrorOptions
	) {
		const resolved = resolveDomainErrorArgs(fieldOrOptions, options);
		super(
			message,
			409,
			resolved.code ?? "CONFLICT",
			resolved.field ? [resolved.field] : undefined,
			resolved.options
		);
		this.name = "ConflictError";
	}
}

export function isPgErrorCode(error: unknown, code: string): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const record = error as { cause?: unknown; code?: unknown };
	if (record.code === code) {
		return true;
	}
	if (typeof record.cause === "object" && record.cause !== null) {
		return (record.cause as { code?: unknown }).code === code;
	}
	return false;
}
