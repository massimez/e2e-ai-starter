import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT_DIR = resolve(import.meta.dirname, "..");

const APP_CONFIG_PATH = resolve(ROOT_DIR, "apps/api/src/lib/app-config.ts");
const PACKAGE_JSON_PATH = resolve(ROOT_DIR, "package.json");
const ICON_SVG_PATH = resolve(ROOT_DIR, "apps/web/src/app/icon.svg");
const ENV_EXAMPLE_PATH = resolve(ROOT_DIR, ".env.example");
const ENV_PATH = resolve(ROOT_DIR, ".env");

const LEADING_LOWER_LETTER_REGEX = /^[a-z]/u;
const VALID_SLUG_REGEX = /^[a-z][a-z0-9-]{1,39}$/u;
const NON_ALNUM_REGEX = /[^a-z0-9]+/gu;
const EDGE_HYPHEN_REGEX = /^-+|-+$/gu;
const SVG_TITLE_REGEX = /<title>.*?<\/title>/su;
const DATABASE_URL_LINE_REGEX = /^DATABASE_URL=.*$/mu;
const AUTH_SECRET_LINE_REGEX = /^BETTER_AUTH_SECRET=.*$/mu;
const REDIS_PREFIX_LINE_REGEX = /^REDIS_PREFIX=.*$/mu;
const S3_BUCKET_LINE_REGEX = /^S3_BUCKET=.*$/mu;
const EMAIL_FROM_LINE_REGEX = /^EMAIL_FROM=.*$/mu;

export interface SetupOptions {
	dryRun: boolean;
	forceEnv: boolean;
	name?: string;
	slug?: string;
	yes: boolean;
}

export interface TemplateTargets {
	bucketName: string;
	dbName: string;
	name: string;
	redisPrefix: string;
	secret: string;
	slug: string;
}

export function toProjectSlug(input: string, fallback = "my-app"): string {
	const cleaned = input
		.trim()
		.toLowerCase()
		.replace(NON_ALNUM_REGEX, "-")
		.replace(EDGE_HYPHEN_REGEX, "")
		.slice(0, 40)
		.replace(EDGE_HYPHEN_REGEX, "");

	if (VALID_SLUG_REGEX.test(cleaned)) {
		return cleaned;
	}
	if (
		cleaned &&
		!LEADING_LOWER_LETTER_REGEX.test(cleaned) &&
		cleaned.length < 36
	) {
		const prefixed = `app-${cleaned}`.replace(EDGE_HYPHEN_REGEX, "");
		if (VALID_SLUG_REGEX.test(prefixed)) {
			return prefixed;
		}
	}
	return fallback;
}

export function deriveTemplateTargets(params: {
	name: string;
	secret?: string;
	slug?: string;
}): TemplateTargets {
	const trimmedName = params.name.trim() || "my-app";
	const slug = params.slug
		? toProjectSlug(params.slug)
		: toProjectSlug(trimmedName);
	const dbPrefix = slug.replaceAll("-", "_");
	const secret = params.secret ?? randomBytes(32).toString("hex");

	return {
		bucketName: `${slug}-uploads`,
		dbName: `${dbPrefix}_db`,
		name: trimmedName,
		redisPrefix: slug,
		secret,
		slug,
	};
}

export function buildAppConfigSource(targets: TemplateTargets): string {
	const serializedName = JSON.stringify(targets.name);
	const serializedBucket = JSON.stringify(targets.bucketName);
	const serializedDb = JSON.stringify(targets.dbName);
	const serializedPrefix = JSON.stringify(targets.redisPrefix);

	return `/**
 * Canonical application branding and template defaults shared across
 * web, API, and worker workspaces without runtime dependencies.
 */
export const APP_CONFIG = {
	defaultBucketName: ${serializedBucket},
	defaultDatabaseName: ${serializedDb},
	defaultFromEmail: "noreply@example.com",
	defaultRedisPrefix: ${serializedPrefix},
	description:
		"Bun and Turborepo starter with Better Auth multi-tenancy, RBAC, Hono RPC, Drizzle ORM, Mastra AI agents (Gemini, OpenAI, Anthropic, OpenRouter) and pgvector, private S3/R2 storage, and BullMQ workers.",
	name: ${serializedName},
	tagline: "Multi-Tenant Next.js, Hono, Drizzle & Mastra AI Starter",
} as const;
`;
}

export function renderTemplateEnv(
	envExample: string,
	targets: TemplateTargets
): string {
	const dbLine = `POSTGRES_DB="${targets.dbName}"`;
	const safeFromName = targets.name.replaceAll('"', "");
	let next = envExample
		.replace(
			DATABASE_URL_LINE_REGEX,
			() =>
				`DATABASE_URL="postgresql://postgres:postgres@localhost:5432/${targets.dbName}"\n${dbLine}`
		)
		.replace(
			AUTH_SECRET_LINE_REGEX,
			() => `BETTER_AUTH_SECRET="${targets.secret}"`
		)
		.replace(
			REDIS_PREFIX_LINE_REGEX,
			() => `REDIS_PREFIX="${targets.redisPrefix}"`
		)
		.replace(S3_BUCKET_LINE_REGEX, () => `S3_BUCKET="${targets.bucketName}"`)
		.replace(
			EMAIL_FROM_LINE_REGEX,
			() => `EMAIL_FROM="${safeFromName} <noreply@example.com>"`
		);

	if (!next.includes("POSTGRES_DB=")) {
		next = `${next.trimEnd()}\n${dbLine}\n`;
	}

	return next;
}

export function parseCliArgs(argv: readonly string[]): SetupOptions {
	const options: SetupOptions = {
		dryRun: false,
		forceEnv: false,
		yes: false,
	};

	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		if (!arg) {
			i += 1;
			continue;
		}
		if (arg === "--yes" || arg === "-y") {
			options.yes = true;
		} else if (arg === "--dry-run") {
			options.dryRun = true;
		} else if (arg === "--force-env") {
			options.forceEnv = true;
		} else if (arg === "--name" && argv[i + 1]) {
			options.name = argv[i + 1];
			i += 1;
		} else if (arg.startsWith("--name=")) {
			options.name = arg.slice("--name=".length);
		} else if (arg === "--slug" && argv[i + 1]) {
			options.slug = argv[i + 1];
			i += 1;
		} else if (arg.startsWith("--slug=")) {
			options.slug = arg.slice("--slug=".length);
		}
		i += 1;
	}

	return options;
}

async function resolveInteractiveInput(
	options: SetupOptions,
	defaultName: string
): Promise<{ name: string; slug: string }> {
	if (options.yes || !process.stdin.isTTY || options.name) {
		const name = options.name?.trim() || defaultName;
		const slug = options.slug?.trim() || toProjectSlug(name);
		return { name, slug };
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const answeredName = await rl.question(`Project name (${defaultName}): `);
		const name = answeredName.trim() || defaultName;
		const suggestedSlug = toProjectSlug(name);
		const answeredSlug = await rl.question(
			`Package/resource slug (${suggestedSlug}): `
		);
		const slug = toProjectSlug(answeredSlug.trim() || suggestedSlug);
		return { name, slug };
	} finally {
		rl.close();
	}
}

async function main(): Promise<void> {
	const options = parseCliArgs(process.argv.slice(2));
	const defaultName = toProjectSlug(basename(ROOT_DIR), "my-app");
	const { name, slug } = await resolveInteractiveInput(options, defaultName);
	const targets = deriveTemplateTargets({ name, slug });

	const packageJsonRaw = await readFile(PACKAGE_JSON_PATH, "utf8");
	const packageJson = JSON.parse(packageJsonRaw) as Record<string, unknown>;
	packageJson.name = targets.slug;
	const nextPackageJson = `${JSON.stringify(packageJson, null, 2)}\n`;

	const iconSvgRaw = await readFile(ICON_SVG_PATH, "utf8");
	const escapedSvgTitle = targets.name
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	const nextIconSvg = iconSvgRaw.replace(
		SVG_TITLE_REGEX,
		() => `<title>${escapedSvgTitle}</title>`
	);

	const nextAppConfig = buildAppConfigSource(targets);
	const envExampleRaw = await readFile(ENV_EXAMPLE_PATH, "utf8");
	const nextEnv = renderTemplateEnv(envExampleRaw, targets);
	const shouldWriteEnv = options.forceEnv || !existsSync(ENV_PATH);

	if (options.dryRun) {
		console.log("Dry run summary:");
		console.log(
			JSON.stringify({ ...targets, writeEnv: shouldWriteEnv }, null, 2)
		);
		return;
	}

	await writeFile(PACKAGE_JSON_PATH, nextPackageJson, "utf8");
	await writeFile(APP_CONFIG_PATH, nextAppConfig, "utf8");
	await writeFile(ICON_SVG_PATH, nextIconSvg, "utf8");

	if (shouldWriteEnv) {
		await writeFile(ENV_PATH, nextEnv, "utf8");
	}

	console.log(`Configured template for "${targets.name}" (${targets.slug}).`);
	console.log(
		shouldWriteEnv
			? "Generated .env with fresh BETTER_AUTH_SECRET and project defaults."
			: "Kept existing .env (pass --force-env to regenerate from .env.example)."
	);
	console.log(
		"Next: bun install && docker compose up -d && bun run db:push && bun run dev"
	);
}

if (import.meta.main) {
	await main();
}
