import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { PgDialect, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import {
	getActiveOrgContext,
	requireActiveOrgId,
	scopedWhere,
	type TenantMismatchSecurityEvent,
	withActiveOrg,
	withOrg,
} from "../src/lib/tenant";
import { createTenantBoundaryMiddleware } from "../src/middleware/tenant-boundary";

const TENANT_A = "org_tenant_a";
const TENANT_B = "org_tenant_b";

const widget = pgTable("widget", {
	id: text("id").primaryKey(),
	organizationId: text("organization_id").notNull(),
	deletedAt: timestamp("deleted_at"),
});

const dialect = new PgDialect();

function contextWith(variables: Record<string, unknown>) {
	return { get: (key: string) => variables[key] };
}

describe("tenant query helpers", () => {
	test("scopedWhere always binds organization_id to the given tenant", () => {
		const query = dialect.sqlToQuery(scopedWhere(widget, TENANT_A));

		expect(query.sql).toContain('"organization_id" = $1');
		expect(query.params).toEqual([TENANT_A]);
	});

	test("withOrg keeps the tenant predicate even when targeting another tenant's record id", () => {
		const query = dialect.sqlToQuery(
			withOrg(widget, TENANT_A, eq(widget.id, "record_owned_by_tenant_b"))
		);

		expect(query.sql).toContain('"organization_id" = $1');
		expect(query.sql).toContain('"id" = $2');
		expect(query.sql).toContain(" and ");
		expect(query.params).toEqual([TENANT_A, "record_owned_by_tenant_b"]);
	});

	test("withActiveOrg also excludes soft-deleted rows", () => {
		const query = dialect.sqlToQuery(withActiveOrg(widget, TENANT_A));

		expect(query.sql).toContain('"organization_id" = $1');
		expect(query.sql).toContain('"deleted_at" is null');
	});

	test("helpers refuse to build an unscoped predicate", () => {
		expect(() => scopedWhere(widget, undefined)).toThrow(
			"Valid organization ID is required"
		);
		expect(() => withOrg(widget, "")).toThrow(
			"Valid organization ID is required"
		);
	});
});

describe("session tenant context", () => {
	test("requireActiveOrgId reads only the verified session", () => {
		expect(
			requireActiveOrgId(
				contextWith({ session: { activeOrganizationId: TENANT_A } })
			)
		).toBe(TENANT_A);
		expect(() => requireActiveOrgId(contextWith({ session: null }))).toThrow(
			"Valid organization ID is required"
		);
	});

	test("getActiveOrgContext requires an authenticated user", () => {
		expect(
			getActiveOrgContext(
				contextWith({
					session: { activeOrganizationId: TENANT_A },
					user: { id: "user_a" },
				})
			)
		).toEqual({ organizationId: TENANT_A, userId: "user_a" });

		expect(() =>
			getActiveOrgContext(
				contextWith({ session: { activeOrganizationId: TENANT_A } })
			)
		).toThrow("Authentication required");
	});
});

function createTenantApp(
	mismatches: TenantMismatchSecurityEvent[] = [],
	activeOrganizationId: string | null = TENANT_A
) {
	return new Hono()
		.use("*", async (c, next) => {
			c.set("session" as never, { activeOrganizationId } as never);
			await next();
		})
		.use(
			"*",
			createTenantBoundaryMiddleware({
				onMismatch: (_c, event) => {
					mismatches.push(event);
				},
			})
		)
		.all("/records/:id", (c) => c.json({ ok: true }));
}

describe("tenant boundary middleware", () => {
	test("allows requests that do not override organizationId", async () => {
		const res = await createTenantApp().request("/records/1");
		expect(res.status).toBe(200);
	});

	test("allows requests whose organizationId matches the session", async () => {
		const res = await createTenantApp().request(
			`/records/1?organizationId=${TENANT_A}`
		);
		expect(res.status).toBe(200);
	});

	test.each([
		["query", `/records/1?organizationId=${TENANT_B}`, {}],
		["query", `/records/1?orgId=${TENANT_B}`, {}],
		["header", "/records/1", { headers: { "x-organization-id": TENANT_B } }],
	] as const)(
		"rejects cross-tenant organizationId in %s",
		async (source, path, init) => {
			const mismatches: TenantMismatchSecurityEvent[] = [];
			const res = await createTenantApp(mismatches).request(path, init);
			const body = (await res.json()) as {
				error: { issues: Array<{ code: string }> };
			};

			expect(res.status).toBe(403);
			expect(body.error.issues[0]?.code).toBe("CROSS_TENANT_ACCESS_DENIED");
			expect(mismatches).toEqual([
				{
					reason: "CROSS_TENANT_MISMATCH",
					source,
					attemptedOrganizationId: TENANT_B,
					activeOrganizationId: TENANT_A,
				},
			]);
		}
	);

	test.each(["POST", "PUT", "PATCH", "DELETE"])(
		"rejects cross-tenant organizationId in %s JSON body",
		async (method) => {
			const mismatches: TenantMismatchSecurityEvent[] = [];
			const res = await createTenantApp(mismatches).request("/records/1", {
				body: JSON.stringify({ name: "hijack", organizationId: TENANT_B }),
				headers: { "content-type": "application/json" },
				method,
			});

			expect(res.status).toBe(403);
			expect(mismatches[0]?.source).toBe("body");
		}
	);

	test("keeps the request body readable for downstream validators", async () => {
		const app = new Hono()
			.use("*", async (c, next) => {
				c.set("session" as never, { activeOrganizationId: TENANT_A } as never);
				await next();
			})
			.use("*", createTenantBoundaryMiddleware())
			.post("/records", async (c) => c.json(await c.req.json()));

		const res = await app.request("/records", {
			body: JSON.stringify({ name: "ok", organizationId: TENANT_A }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ name: "ok", organizationId: TENANT_A });
	});

	test("defers to auth/membership middleware when there is no active org", async () => {
		const res = await createTenantApp([], null).request(
			`/records/1?organizationId=${TENANT_B}`
		);
		expect(res.status).toBe(200);
	});
});
