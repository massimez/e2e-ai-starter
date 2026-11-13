import { describe, expect, test } from "bun:test";
import {
	buildAppConfigSource,
	deriveTemplateTargets,
	parseCliArgs,
	renderTemplateEnv,
	toProjectSlug,
} from "./setup";

describe("template setup helpers", () => {
	test("toProjectSlug normalizes display names into valid package/infra slugs", () => {
		expect(toProjectSlug("Acme Cloud App")).toBe("acme-cloud-app");
		expect(toProjectSlug("123-Workspace")).toBe("app-123-workspace");
		expect(toProjectSlug("---")).toBe("my-app");
	});

	test("deriveTemplateTargets computes consistent database, bucket, and prefix names", () => {
		const targets = deriveTemplateTargets({
			name: "Acme Workspace",
			secret: "a".repeat(64),
		});

		expect(targets).toEqual({
			bucketName: "acme-workspace-uploads",
			dbName: "acme_workspace_db",
			name: "Acme Workspace",
			redisPrefix: "acme-workspace",
			secret: "a".repeat(64),
			slug: "acme-workspace",
		});
	});

	test("buildAppConfigSource updates canonical APP_CONFIG fields cleanly", () => {
		const targets = deriveTemplateTargets({
			name: "Acme App",
			secret: "b".repeat(64),
			slug: "acme-app",
		});
		const source = buildAppConfigSource(targets);

		expect(source).toContain('name: "Acme App"');
		expect(source).toContain('defaultDatabaseName: "acme_app_db"');
		expect(source).toContain('defaultBucketName: "acme-app-uploads"');
		expect(source).toContain('defaultRedisPrefix: "acme-app"');
	});

	test("renderTemplateEnv substitutes project database, secret, bucket, prefix, and email", () => {
		const sample = [
			'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/starter_db"',
			'BETTER_AUTH_SECRET="default_development_secret_key_32_characters_minimum"',
			'REDIS_PREFIX="starter"',
			'S3_BUCKET="starter-uploads"',
			'EMAIL_FROM="e2e-ai-starter <noreply@example.com>"',
		].join("\n");

		const targets = deriveTemplateTargets({
			name: "Acme App",
			secret: "f".repeat(64),
			slug: "acme-app",
		});
		const rendered = renderTemplateEnv(sample, targets);

		expect(rendered).toContain(
			'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/acme_app_db"'
		);
		expect(rendered).toContain('POSTGRES_DB="acme_app_db"');
		expect(rendered).toContain(`BETTER_AUTH_SECRET="${"f".repeat(64)}"`);
		expect(rendered).toContain('REDIS_PREFIX="acme-app"');
		expect(rendered).toContain('S3_BUCKET="acme-app-uploads"');
		expect(rendered).toContain('EMAIL_FROM="Acme App <noreply@example.com>"');
	});

	test("parseCliArgs reads name, slug, and boolean flags", () => {
		expect(
			parseCliArgs([
				"--name",
				"Nova SaaS",
				"--slug=nova-saas",
				"--yes",
				"--dry-run",
				"--force-env",
			])
		).toEqual({
			dryRun: true,
			forceEnv: true,
			name: "Nova SaaS",
			slug: "nova-saas",
			yes: true,
		});
	});
});
