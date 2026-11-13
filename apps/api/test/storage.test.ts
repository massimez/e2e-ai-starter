import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { S3Client } from "@aws-sdk/client-s3";
import { db } from "@workspace/db";
import { env } from "../src/env";
import { generateStorageKey, sanitizeFileName } from "../src/lib/storage";
import { STORAGE_CONFIG } from "../src/modules/storage/config";
import {
	commitUploadsSchema,
	deleteUploadBodySchema,
	presignUploadSchema,
	uploadIdParamSchema,
} from "../src/modules/storage/schema";
import {
	commitUploads,
	deleteUpload,
	escapeIlikePattern,
	getUploadSignedDownloadUrl,
	presignUpload,
} from "../src/modules/storage/service";

function createQueryChain<T>(result: T) {
	const chain = {
		for: () => chain,
		from: () => chain,
		limit: () => Promise.resolve(result),
		onConflictDoNothing: () => chain,
		returning: () => Promise.resolve(result),
		set: () => chain,
		// biome-ignore lint/suspicious/noThenProperty: test double emulates Drizzle awaitable builder
		then: <R>(
			onfulfilled?: (value: T) => R | PromiseLike<R>,
			onrejected?: (reason: unknown) => R | PromiseLike<R>
		) => Promise.resolve(result).then(onfulfilled, onrejected),
		values: () => chain,
		where: () => chain,
	};
	return chain;
}

const TENANT_STORAGE_KEY_REGEX =
	/^org_org_123_+evil\/uploads\/42_+bad\/[a-f0-9]{8}-invoice_final\.pdf$/u;

describe("storage utilities and schemas", () => {
	test("sanitizeFileName and generateStorageKey strip traversal and isolate tenant keys", () => {
		expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
		expect(sanitizeFileName("..hidden..file Name!!.png")).toBe(
			"hidden.file_name_.png"
		);

		const key = generateStorageKey({
			entityId: "42/../../bad",
			entityType: "uploads",
			fileName: "..\\..\\invoice final.pdf",
			organizationId: "org_123/../../evil",
		});

		expect(key).toMatch(TENANT_STORAGE_KEY_REGEX);
		expect(key).not.toContain("..");
	});

	test("escapeIlikePattern escapes SQL wildcard metacharacters", () => {
		expect(escapeIlikePattern("100%_test\\file")).toBe("100\\%\\_test\\\\file");
	});

	test("storage Zod schemas enforce bounds, UUIDs, and identifiers", () => {
		expect(
			presignUploadSchema.safeParse({
				contentType: "application/pdf",
				fileName: "report.pdf",
				size: STORAGE_CONFIG.MAX_FILE_SIZE + 1,
			}).success
		).toBe(false);

		expect(commitUploadsSchema.safeParse({ fileKeys: [] }).success).toBe(false);
		expect(uploadIdParamSchema.safeParse({ id: "not-a-uuid" }).success).toBe(
			false
		);
		expect(deleteUploadBodySchema.safeParse({}).success).toBe(false);
	});
});

describe("storage service controls and route guards", () => {
	afterEach(() => {
		mock.restore();
	});

	test("presignUpload rejects SVG uploads immediately before hitting database", async () => {
		await expect(
			presignUpload({
				input: {
					contentType: "image/svg+xml",
					fileName: "xss.svg",
					size: 1024,
				},
				organizationId: "org_1",
				userId: "user_1",
			})
		).rejects.toThrow('Content-Type "image/svg+xml" is not permitted.');
	});

	test("presignUpload enforces storage quota including active pending reservations", async () => {
		let callIndex = 0;
		spyOn(db, "select").mockImplementation((() => {
			callIndex += 1;
			if (callIndex === 1) {
				return createQueryChain([
					{ currentUsage: 900, organizationId: "org_1", storageLimit: 1000 },
				]);
			}
			return createQueryChain([{ reservedBytes: 80 }]);
		}) as never);

		await expect(
			presignUpload({
				input: {
					contentType: "application/pdf",
					fileName: "doc.pdf",
					size: 50,
				},
				organizationId: "org_1",
				userId: "user_1",
			})
		).rejects.toThrow("Storage quota exceeded");
	});

	test("commitUploads validates S3 object size and increments organization quota inside transaction", async () => {
		const expiresAt = new Date(Date.now() + 60_000);
		const pendingRow = {
			bucket: "starter-uploads",
			contentType: "image/png",
			expiresAt,
			fileKey: "org_1/uploads/abc-avatar.png",
			id: "11111111-1111-4111-8111-111111111111",
			metadata: { storageMode: "s3" },
			organizationId: "org_1",
			size: 2048,
			status: "pending",
		};

		spyOn(db, "select").mockImplementation((() =>
			createQueryChain([pendingRow])) as never);

		const s3SendSpy = spyOn(S3Client.prototype, "send").mockResolvedValue({
			ContentLength: 2048,
			ContentType: "image/png",
		} as never);

		const updateSpy = spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			let txSelectCall = 0;
			let txUpdateCall = 0;
			const txMock = {
				insert: () => createQueryChain(undefined),
				select: () => {
					txSelectCall += 1;
					if (txSelectCall === 1) {
						return createQueryChain([pendingRow]);
					}
					return createQueryChain([
						{ currentUsage: 0, storageLimit: 1_073_741_824 },
					]);
				},
				update: () => {
					txUpdateCall += 1;
					if (txUpdateCall === 1) {
						return createQueryChain([{ ...pendingRow, status: "committed" }]);
					}
					return createQueryChain(undefined);
				},
			};
			return await callback(txMock);
		}) as never);

		const committed = await commitUploads({
			input: { fileKeys: [pendingRow.fileKey] },
			organizationId: "org_1",
		});

		expect(s3SendSpy).toHaveBeenCalledTimes(1);
		expect(updateSpy).toHaveBeenCalledTimes(1);
		expect(committed.committedCount).toBe(1);
		expect(committed.items[0]?.fileUrl).toBe(
			"/api/storage/files/11111111-1111-4111-8111-111111111111"
		);
	});

	test("getUploadSignedDownloadUrl throws NotFoundError for non-owned or missing files", async () => {
		spyOn(db, "select").mockImplementation((() =>
			createQueryChain([])) as never);

		await expect(
			getUploadSignedDownloadUrl({
				id: "11111111-1111-4111-8111-111111111111",
				organizationId: "org_1",
			})
		).rejects.toThrow("File not found");
	});

	test("deleteUpload deletes S3 object and decrements usage inside transaction", async () => {
		const committedRow = {
			bucket: "starter-uploads",
			fileKey: "org_1/uploads/doc.pdf",
			id: "11111111-1111-4111-8111-111111111111",
			metadata: { storageMode: "s3" },
			organizationId: "org_1",
			size: 4096,
			status: "committed",
		};

		const s3Spy = spyOn(S3Client.prototype, "send").mockResolvedValue(
			{} as never
		);
		let decrementedQuota = false;

		spyOn(db, "transaction").mockImplementation((async (
			callback: (tx: unknown) => Promise<unknown>
		) => {
			const txMock = {
				delete: () => createQueryChain([committedRow]),
				select: () => createQueryChain([committedRow]),
				update: () => {
					decrementedQuota = true;
					return createQueryChain(undefined);
				},
			};
			return await callback(txMock);
		}) as never);

		const res = await deleteUpload({
			id: committedRow.id,
			organizationId: "org_1",
		});

		expect(s3Spy).toHaveBeenCalledTimes(1);
		expect(decrementedQuota).toBe(true);
		expect(res).toEqual({
			fileKey: committedRow.fileKey,
			id: committedRow.id,
			success: true,
		});
	});

	test("presignUpload throws STORAGE_UNAVAILABLE when S3 credentials are missing", async () => {
		let callIndex = 0;
		spyOn(db, "select").mockImplementation((() => {
			callIndex += 1;
			if (callIndex === 1) {
				return createQueryChain([
					{ currentUsage: 0, organizationId: "org_1", storageLimit: 1000 },
				]);
			}
			return createQueryChain([{ reservedBytes: 0 }]);
		}) as never);

		const originalKeyId = env.S3_ACCESS_KEY_ID;
		const originalSecret = env.S3_SECRET_ACCESS_KEY;
		env.S3_ACCESS_KEY_ID = undefined;
		env.S3_SECRET_ACCESS_KEY = undefined;

		try {
			await expect(
				presignUpload({
					input: {
						contentType: "application/pdf",
						fileName: "doc.pdf",
						size: 100,
					},
					organizationId: "org_1",
					userId: "user_1",
				})
			).rejects.toThrow("Object storage credentials are not configured");
		} finally {
			env.S3_ACCESS_KEY_ID = originalKeyId;
			env.S3_SECRET_ACCESS_KEY = originalSecret;
		}
	});
});
