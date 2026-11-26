import { describe, expect, test } from "bun:test";
import { isPlatformAdminRole } from "@workspace/shared/permissions";
import { Hono } from "hono";
import type { AuditLogRecord } from "../../../lib/audit";
import { type AppEnv, createApp } from "../../../lib/create-hono-app";
import {
	createAccessAuditMiddleware,
	drainAuditLogs,
} from "../../../middleware/audit";
import { platformAdminMiddleware } from "../../../middleware/platform-admin";
import { adminRoutes } from "../route";
import type { AuditLogListItem, AuditRepository } from "./repository";
import {
	exportAuditLogsQuerySchema,
	listAuditLogsQuerySchema,
	parseAuditFilterDate,
} from "./schema";
import {
	buildAuditExportFilename,
	createAuditService,
	escapeCsvCell,
	formatAuditLogsCsv,
} from "./service";

const SAMPLE_ROWS: AuditLogListItem[] = [
	{
		action: "app.organization.update",
		actorEmail: "admin@acme.example",
		actorName: '=HYPERLINK("http://evil.example")',
		createdAt: new Date("2026-11-20T10:15:00.000Z"),
		details: {
			durationMs: 42,
			impersonatedBy: "support_user_1",
			method: "PATCH",
			path: "/api/organizations/current",
			requestId: "req_123",
			status: 200,
		},
		entityId: "org_1",
		entityType: "organizations/current",
		id: "11111111-1111-4111-8111-111111111111",
		ipAddress: "203.0.113.10",
		organizationId: "org_1",
		organizationName: "Acme Corporation",
		organizationSlug: "acme-corp",
		userAgent: 'Mozilla/5.0, "Quoted"',
		userId: "user_1",
	},
	{
		action: "security.access_denied",
		actorEmail: "attacker@example.com",
		actorName: "Unknown Actor",
		createdAt: new Date("2026-11-21T11:00:00.000Z"),
		details: {
			durationMs: 5,
			method: "GET",
			path: "/api/admin/audit",
			requestId: "req_456",
			status: 403,
		},
		entityId: null,
		entityType: "admin/audit",
		id: "22222222-2222-4222-8222-222222222222",
		ipAddress: "198.51.100.4",
		organizationId: null,
		organizationName: null,
		organizationSlug: null,
		userAgent: "curl/8.0",
		userId: "user_2",
	},
];

function filterSampleRows(
	rows: AuditLogListItem[],
	params: { organizationId?: string; scope?: "all" | "global" | "organization" }
): AuditLogListItem[] {
	if (params.scope === "global") {
		return rows.filter((row) => row.organizationId === null);
	}
	if (params.organizationId) {
		return rows.filter((row) => row.organizationId === params.organizationId);
	}
	if (params.scope === "organization") {
		return rows.filter((row) => row.organizationId !== null);
	}
	return rows;
}

function createFakeAuditRepository(
	rows: AuditLogListItem[] = SAMPLE_ROWS
): AuditRepository {
	return {
		listAuditLogs(params) {
			const filtered = filterSampleRows(rows, params);
			return Promise.resolve({
				items: filtered.slice(params.offset, params.offset + params.limit),
				total: filtered.length,
			});
		},
		listAuditLogsForExport(params) {
			return Promise.resolve(
				filterSampleRows(rows, params).slice(0, params.limit)
			);
		},
		listRecentAuditLogs(limit) {
			return Promise.resolve(rows.slice(0, limit));
		},
	};
}

describe("platform backoffice authorization boundary", () => {
	test("isPlatformAdminRole only matches platform admin user role, not tenant roles", () => {
		expect(isPlatformAdminRole("admin")).toBe(true);
		expect(isPlatformAdminRole("user, admin")).toBe(true);
		expect(isPlatformAdminRole("user")).toBe(false);
		expect(isPlatformAdminRole("owner")).toBe(false);
		expect(isPlatformAdminRole(null)).toBe(false);
	});

	test("platformAdminMiddleware rejects unauthenticated, non-admin, and impersonated sessions", async () => {
		const buildApp = (
			user: { id: string; role?: string | null } | null,
			session: { impersonatedBy?: string | null } | null = null
		) =>
			createApp()
				.use("*", async (c, next) => {
					c.set("user", user as never);
					c.set("session", session as never);
					await next();
				})
				.get("/api/admin/audit", platformAdminMiddleware, (c) =>
					c.json({ ok: true })
				);

		const unauthRes = await buildApp(null).request("/api/admin/audit");
		expect(unauthRes.status).toBe(401);

		const tenantUserRes = await buildApp({
			id: "usr_tenant_owner",
			role: "user",
		}).request("/api/admin/audit");
		expect(tenantUserRes.status).toBe(403);

		const impersonatedAdminRes = await buildApp(
			{ id: "usr_platform_admin", role: "admin" },
			{ impersonatedBy: "usr_other_admin" }
		).request("/api/admin/audit");
		expect(impersonatedAdminRes.status).toBe(403);

		const platformAdminRes = await buildApp({
			id: "usr_platform_admin",
			role: "admin",
		}).request("/api/admin/audit");
		expect(platformAdminRes.status).toBe(200);
	});

	test("adminRoutes enforces authentication across all mounted backoffice sub-routes", async () => {
		const app = createApp().route("/api/admin", adminRoutes);

		const listRes = await app.request("/api/admin/audit");
		expect(listRes.status).toBe(401);

		const exportRes = await app.request("/api/admin/audit/export");
		expect(exportRes.status).toBe(401);
	});
});

describe("backoffice audit query schemas and CSV export safety", () => {
	test("validates query filters, scopes, and end-of-day date parsing", () => {
		const listQuery = listAuditLogsQuerySchema.parse({
			action: "  security.  ",
			from: "2026-11-01",
			limit: "50",
			page: "2",
			scope: "global",
			to: "2026-11-26",
		});
		expect(listQuery.action).toBe("security.");
		expect(listQuery.scope).toBe("global");
		expect(listQuery.limit).toBe(50);
		expect(listQuery.page).toBe(2);

		const endOfDay = parseAuditFilterDate("2026-11-26", "end");
		expect(endOfDay?.toISOString()).toBe("2026-11-26T23:59:59.999Z");

		expect(() =>
			listAuditLogsQuerySchema.parse({ from: "not-a-date" })
		).toThrow();
		expect(() =>
			listAuditLogsQuerySchema.parse({
				from: "2026-11-26",
				to: "2026-11-01",
			})
		).toThrow();
		expect(() => exportAuditLogsQuerySchema.parse({ format: "xml" })).toThrow();
	});

	test("neutralizes CSV formula injection and escapes quotes/commas per RFC 4180", () => {
		expect(escapeCsvCell("=CMD|' /C calc'!A0")).toBe("'=CMD|' /C calc'!A0");
		expect(escapeCsvCell(" =HYPERLINK('http://evil')")).toBe(
			"' =HYPERLINK('http://evil')"
		);
		expect(escapeCsvCell("\n=CMD|' /C calc'!A0")).toBe(
			"\"'\n=CMD|' /C calc'!A0\""
		);
		expect(escapeCsvCell("+1+2")).toBe("'+1+2");
		expect(escapeCsvCell("-2+3")).toBe("'-2+3");
		expect(escapeCsvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
		expect(escapeCsvCell('hello, "world"')).toBe('"hello, ""world"""');

		const csv = formatAuditLogsCsv(SAMPLE_ROWS);
		expect(csv).toContain(
			"id,createdAt,organizationId,organizationName,action"
		);
		expect(csv).toContain(
			'"=HYPERLINK(""http://evil.example"")"'.replace('"', `"'`)
		);
		expect(csv).toContain("Acme Corporation");
		expect(csv).toContain("support_user_1");
		expect(csv).toContain('"Mozilla/5.0, ""Quoted"""');
		expect(csv.endsWith("\r\n")).toBe(true);
	});

	test("lists cross-tenant and global audit logs and exports CSV/JSON cleanly", async () => {
		const service = createAuditService(createFakeAuditRepository());

		const allEvents = await service.listAuditLogs(
			listAuditLogsQuerySchema.parse({ limit: 25, page: 1 })
		);
		expect(allEvents.items).toHaveLength(2);

		const globalOnly = await service.listAuditLogs(
			listAuditLogsQuerySchema.parse({ scope: "global" })
		);
		expect(globalOnly.items).toHaveLength(1);
		expect(globalOnly.items[0]?.organizationId).toBeNull();

		const orgFiltered = await service.listAuditLogs(
			listAuditLogsQuerySchema.parse({ organizationId: "org_1" })
		);
		expect(orgFiltered.items).toHaveLength(1);
		expect(orgFiltered.items[0]?.organizationName).toBe("Acme Corporation");

		const jsonExport = await service.exportAuditLogs(
			exportAuditLogsQuerySchema.parse({ format: "json", scope: "all" })
		);
		expect(jsonExport.contentType).toBe("application/json; charset=utf-8");
		expect(jsonExport.rowCount).toBe(2);
		const parsedJson = JSON.parse(jsonExport.payload) as {
			rowCount: number;
			rows: AuditLogListItem[];
			scope: string;
		};
		expect(parsedJson.scope).toBe("all");
		expect(parsedJson.rowCount).toBe(2);

		const csvExport = await service.exportAuditLogs(
			exportAuditLogsQuerySchema.parse({
				format: "csv",
				organizationId: "org_1",
			})
		);
		expect(csvExport.contentType).toBe("text/csv; charset=utf-8");
		expect(csvExport.filename).toContain("org_1");
		expect(csvExport.filename).toEndWith(".csv");

		expect(
			buildAuditExportFilename("org/../../bad", "csv", new Date("2026-11-26"))
		).toBe("audit-logs-org_______bad-2026-11-26.csv");
	});
});

describe("audit middleware impersonation attribution", () => {
	test("records session.impersonatedBy in audit log details when present", async () => {
		const recorded: AuditLogRecord[] = [];
		const app = new Hono<AppEnv>()
			.use("*", async (c, next) => {
				c.set("user", { id: "target_user" } as never);
				c.set("session", {
					activeOrganizationId: "org_99",
					impersonatedBy: "admin_support_7",
				} as never);
				await next();
			})
			.use(
				"*",
				createAccessAuditMiddleware({
					scope: "api",
					writeAuditLog: (record) => {
						recorded.push(record);
						return Promise.resolve();
					},
				})
			)
			.post("/api/organizations/current", (c) => c.json({ ok: true }));

		await app.request("/api/organizations/current", { method: "POST" });
		await drainAuditLogs();

		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.details?.impersonatedBy).toBe("admin_support_7");
		expect(recorded[0]?.organizationId).toBe("org_99");
	});
});
