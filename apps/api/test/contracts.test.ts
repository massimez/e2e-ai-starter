import { describe, expect, test } from "bun:test";
import {
	ac,
	PERMISSION_MATRIX,
	roleAllows,
	roles,
} from "@workspace/shared/permissions";
import {
	EMAIL_QUEUE_NAME,
	emailJobDataSchema,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	NOTIFICATION_QUEUE_NAME,
	notificationJobDataSchema,
} from "@workspace/shared/queues";
import {
	formatBytes,
	isAllowedContentType,
	isValidFileSize,
	STORAGE_CONFIG,
} from "@workspace/shared/storage";

describe("shared RBAC permissions contract", () => {
	test("defines owner, admin, member, and viewer roles consistently", () => {
		expect(Object.keys(roles)).toEqual(["owner", "admin", "member", "viewer"]);
		expect(ac.statements.organization).toContain("delete");

		expect(roleAllows("owner", "organization", "delete")).toBe(true);
		expect(roleAllows("admin", "organization", "delete")).toBe(false);
		expect(roleAllows("admin", "member", "create")).toBe(true);
		expect(roleAllows("member", "storage", "create")).toBe(true);
		expect(roleAllows("member", "member", "delete")).toBe(false);
		expect(roleAllows("viewer", "ai", "read")).toBe(true);
		expect(roleAllows("viewer", "ai", "execute")).toBe(false);
	});

	test("PERMISSION_MATRIX entries cover documented role capabilities", () => {
		expect(PERMISSION_MATRIX.length).toBeGreaterThan(0);
		for (const row of PERMISSION_MATRIX) {
			expect(row.category.length).toBeGreaterThan(0);
			expect(row.resource.length).toBeGreaterThan(0);
			expect(row.description.length).toBeGreaterThan(0);
			expect(typeof row.owner).toBe("boolean");
			expect(typeof row.admin).toBe("boolean");
			expect(typeof row.member).toBe("boolean");
			expect(typeof row.viewer).toBe("boolean");
		}

		const transferRow = PERMISSION_MATRIX.find(
			(row) => row.resource === "Transfer Ownership"
		);
		expect(transferRow).toMatchObject({
			admin: false,
			member: false,
			owner: true,
			viewer: false,
		});
	});
});

describe("shared storage and queue contracts", () => {
	test("blocks SVG MIME type and invalid file sizes", () => {
		expect(
			(STORAGE_CONFIG.ALLOWED_CONTENT_TYPES as readonly string[]).includes(
				"image/svg+xml"
			)
		).toBe(false);
		expect(isAllowedContentType("image/svg+xml")).toBe(false);
		expect(isAllowedContentType("image/png; charset=utf-8")).toBe(true);
		expect(isAllowedContentType("application/pdf")).toBe(true);

		expect(isValidFileSize(0)).toBe(false);
		expect(isValidFileSize(1.5)).toBe(false);
		expect(isValidFileSize(STORAGE_CONFIG.MAX_FILE_SIZE + 1)).toBe(false);
		expect(isValidFileSize(STORAGE_CONFIG.MAX_FILE_SIZE)).toBe(true);
		expect(formatBytes(1024 * 1024)).toBe("1 MB");
	});

	test("validates queue job schemas and canonical categories/channels", () => {
		expect(EMAIL_QUEUE_NAME).toBe("email-queue");
		expect(NOTIFICATION_QUEUE_NAME).toBe("notification-queue");
		expect(NOTIFICATION_CATEGORIES).toEqual([
			"system",
			"security",
			"team",
			"project",
			"billing",
		]);
		expect(NOTIFICATION_CHANNELS).toEqual(["in_app", "email", "push"]);

		expect(
			emailJobDataSchema.safeParse({
				payload: { code: "123456", type: "sign-in" },
				subject: "Your verification code",
				template: "verification-otp",
				to: "user@example.com",
			}).success
		).toBe(true);

		expect(
			notificationJobDataSchema.safeParse({
				category: "team",
				content: "You were invited",
				title: "Invitation",
				type: "invite",
				userId: "user_1",
			}).success
		).toBe(true);
	});
});
