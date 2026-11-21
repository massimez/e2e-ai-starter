import { afterEach, describe, expect, test } from "bun:test";
import { createDbConnection } from "../src/index";
import * as schema from "../src/schema";

describe("database connection builder and schema exports", () => {
	const originalMax = process.env.DB_MAX_CONNECTIONS;

	afterEach(() => {
		if (originalMax === undefined) {
			delete process.env.DB_MAX_CONNECTIONS;
		} else {
			process.env.DB_MAX_CONNECTIONS = originalMax;
		}
	});

	test("validates DB_MAX_CONNECTIONS integer range", () => {
		process.env.DB_MAX_CONNECTIONS = "0";
		expect(() =>
			createDbConnection("postgresql://postgres:postgres@localhost:5432/app")
		).toThrow("Invalid DB_MAX_CONNECTIONS value");

		process.env.DB_MAX_CONNECTIONS = "201";
		expect(() =>
			createDbConnection("postgresql://postgres:postgres@localhost:5432/app")
		).toThrow("Invalid DB_MAX_CONNECTIONS value");
	});

	test("creates and closes isolated lazy pool client without connecting on init", async () => {
		process.env.DB_MAX_CONNECTIONS = "5";
		const conn = createDbConnection(
			"postgresql://postgres:postgres@localhost:5432/app?sslmode=require"
		);
		expect(conn.db).toBeDefined();
		await conn.close();
	});

	test("exports core domain and auth Drizzle tables", () => {
		expect(schema.softAudit).toBeDefined();
		expect(schema.storageFolders).toBeDefined();
		expect(schema.user).toBeDefined();
		expect(schema.session).toBeDefined();
		expect(schema.organization).toBeDefined();
		expect(schema.organizationRole).toBeDefined();
		expect(schema.member).toBeDefined();
		expect(schema.invitation).toBeDefined();
		expect(schema.uploads).toBeDefined();
		expect(schema.organizationStorageLimits).toBeDefined();
		expect(schema.notification).toBeDefined();
		expect(schema.notificationPreference).toBeDefined();
		expect(schema.pushSubscription).toBeDefined();
		expect(schema.auditLog).toBeDefined();
	});
});
