import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createDbConnection } from "@workspace/db";
import { organization, user } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { env } from "../../env";
import type { AuditLogRecord } from "../../lib/audit";
import { auth } from "../../lib/auth/index";
import { AppError } from "../../lib/errors";
import * as aiRuntime from "../ai/runtime";
import { createAiService } from "../ai/service";
import { createWalletService } from "./service";

const databaseUrl = process.env.WALLET_TEST_DATABASE_URL;

const sampleBriefResult = {
	generatedAt: "2026-11-27T12:00:00.000Z",
	highlights: ["Healthy workspace"],
	metrics: {
		committedUploadCount: 1,
		memberCount: 2,
		organizationId: "org_1",
		organizationName: "Acme",
		organizationSlug: "acme",
		recentFileNames: [],
		roleBreakdown: { member: 1, owner: 1 },
		storageCurrentUsageBytes: 100,
		storageLimitBytes: 1000,
		userRole: "member",
	},
	recommendedActions: [],
	risks: [],
	summary: "Summary text",
};

function setupBriefTestEnv(
	startImpl: () => Promise<{ error?: Error; result?: unknown; status: string }>
) {
	const previousKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
	env.GOOGLE_GENERATIVE_AI_API_KEY = "test-wallet-key";
	const start = mock(startImpl);
	spyOn(auth.api, "hasPermission").mockResolvedValue({
		error: null,
		success: true,
	});
	spyOn(aiRuntime, "ensureStorageInitialized").mockResolvedValue(undefined);
	spyOn(aiRuntime, "getAiRuntime").mockReturnValue({
		mastra: {
			getWorkflowById: () => ({
				createRun: async () => ({ start }),
			}),
		},
	} as unknown as ReturnType<typeof aiRuntime.getAiRuntime>);
	const repository = {
		findMemberRole: async () => "member",
	};
	return {
		cleanup: () => {
			env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
		},
		repository,
		start,
	};
}

afterEach(() => mock.restore());

describe("runWorkspaceBrief wallet integration", () => {
	test("rejects an unfunded workspace summary before starting workflow work", async () => {
		const { cleanup, repository, start } = setupBriefTestEnv(async () => ({
			result: sampleBriefResult,
			status: "success",
		}));
		try {
			const error = new AppError("Insufficient credits", 402);
			const chargeWorkspaceBrief = mock(() => Promise.reject(error));
			const reverseCharge = mock();
			const service = createAiService(repository, {
				chargeWorkspaceBrief,
				reverseCharge,
			});

			await expect(
				service.runWorkspaceBrief({
					input: { modelId: "google/gemini-3.5-flash-lite" },
					operationId: crypto.randomUUID(),
					organizationId: "org_1",
					userId: "user_1",
				})
			).rejects.toBe(error);
			expect(start).not.toHaveBeenCalled();
			expect(reverseCharge).not.toHaveBeenCalled();
		} finally {
			cleanup();
		}
	});

	test("keeps a successful summary charge and restores a failed one once", async () => {
		const entryId = crypto.randomUUID();
		const chargeWorkspaceBrief = mock(async () => entryId);
		const reverseCharge = mock(async () => ({
			applied: true,
			credits: 3,
			entryId: crypto.randomUUID(),
		}));

		let shouldFail = false;
		const { cleanup, repository } = setupBriefTestEnv(async () =>
			shouldFail
				? { error: new Error("Provider failed"), status: "failed" }
				: { result: sampleBriefResult, status: "success" }
		);
		try {
			const service = createAiService(repository, {
				chargeWorkspaceBrief,
				reverseCharge,
			});
			const operationId = crypto.randomUUID();

			const brief = await service.runWorkspaceBrief({
				input: { modelId: "google/gemini-3.5-flash-lite" },
				operationId,
				organizationId: "org_1",
				userId: "user_1",
			});
			expect(brief.summary).toBe("Summary text");
			expect(chargeWorkspaceBrief).toHaveBeenCalledWith({
				actorId: "user_1",
				operationId,
				organizationId: "org_1",
			});
			expect(reverseCharge).not.toHaveBeenCalled();

			shouldFail = true;
			await expect(
				service.runWorkspaceBrief({
					input: { modelId: "google/gemini-3.5-flash-lite" },
					operationId: crypto.randomUUID(),
					organizationId: "org_1",
					userId: "user_1",
				})
			).rejects.toMatchObject({ code: "AI_WORKFLOW_FAILED" });
			expect(reverseCharge).toHaveBeenCalledTimes(1);
			expect(reverseCharge).toHaveBeenCalledWith({
				entryId,
				organizationId: "org_1",
				reason: "Workspace summary failed",
			});
		} finally {
			cleanup();
		}
	});

	test("writes an immutable audit record if compensating reversal fails", async () => {
		const entryId = crypto.randomUUID();
		const operationId = crypto.randomUUID();
		const auditRecords: AuditLogRecord[] = [];
		const { cleanup, repository } = setupBriefTestEnv(async () => ({
			error: new Error("Provider failed"),
			status: "failed",
		}));
		try {
			const service = createAiService(
				repository,
				{
					chargeWorkspaceBrief: () => Promise.resolve(entryId),
					reverseCharge: () => Promise.reject(new Error("DB connection lost")),
				},
				(record) => {
					auditRecords.push(record);
					return Promise.resolve();
				}
			);

			await expect(
				service.runWorkspaceBrief({
					input: { modelId: "google/gemini-3.5-flash-lite" },
					operationId,
					organizationId: "org_1",
					requestId: "req_123",
					userId: "user_1",
				})
			).rejects.toMatchObject({ code: "AI_WORKFLOW_FAILED" });

			expect(auditRecords).toHaveLength(1);
			expect(auditRecords[0]).toMatchObject({
				action: "ai.workspace_brief.reversal_failed",
				details: {
					chargeEntryId: entryId,
					operationId,
					requestId: "req_123",
					reversalFailed: true,
				},
				entityId: entryId,
				entityType: "wallet_entry",
				organizationId: "org_1",
				userId: "user_1",
			});
		} finally {
			cleanup();
		}
	});
});

describe.skipIf(!databaseUrl)("wallet ledger PostgreSQL integration", () => {
	async function withTestOrganizations<T>(
		fn: (ctx: {
			actorEmail: string;
			actorId: string;
			otherOrganizationId: string;
			organizationId: string;
			wallet: ReturnType<typeof createWalletService>;
		}) => Promise<T>
	): Promise<T> {
		if (!databaseUrl) {
			throw new Error("WALLET_TEST_DATABASE_URL is required");
		}
		const { close, db: database } = createDbConnection(databaseUrl);
		const wallet = createWalletService(database);
		const organizationId = crypto.randomUUID();
		const otherOrganizationId = crypto.randomUUID();
		const actorId = crypto.randomUUID();
		const actorEmail = `${actorId}@example.com`;
		try {
			await database.insert(organization).values([
				{ id: organizationId, name: "Wallet test" },
				{ id: otherOrganizationId, name: "Another wallet" },
			]);
			await database.insert(user).values({
				email: actorEmail,
				id: actorId,
				name: "Wallet test",
			});
			return await fn({
				actorEmail,
				actorId,
				organizationId,
				otherOrganizationId,
				wallet,
			});
		} finally {
			try {
				await database
					.delete(organization)
					.where(
						inArray(organization.id, [organizationId, otherOrganizationId])
					);
				await database.delete(user).where(eq(user.id, actorId));
			} finally {
				await close();
			}
		}
	}

	test("serializes concurrent grants, rejects mismatched replays, and maps missing org FK to 404", async () => {
		await withTestOrganizations(async ({ actorId, organizationId, wallet }) => {
			expect(await wallet.getWallet(organizationId)).toMatchObject({
				balance: 0,
				entries: [],
			});

			const grant = {
				actorId,
				credits: 3,
				operationId: crypto.randomUUID(),
				organizationId,
				reason: "Test grant",
			};
			const grants = await Promise.all([
				wallet.grantCredits(grant),
				wallet.grantCredits(grant),
			]);
			expect(grants.filter(({ applied }) => applied)).toHaveLength(1);
			expect(grants[0]?.entryId).toBe(grants[1]?.entryId);

			await expect(
				wallet.grantCredits({ ...grant, credits: 4 })
			).rejects.toMatchObject({ statusCode: 409 });

			await expect(
				wallet.grantCredits({
					...grant,
					operationId: crypto.randomUUID(),
					organizationId: "org_does_not_exist",
				})
			).rejects.toMatchObject({ statusCode: 404 });
		});
	});

	test("serializes concurrent spends, reversals, and binds charge lookup to operationId", async () => {
		await withTestOrganizations(
			async ({
				actorEmail,
				actorId,
				organizationId,
				otherOrganizationId,
				wallet,
			}) => {
				await wallet.grantCredits({
					actorId,
					credits: 3,
					operationId: crypto.randomUUID(),
					organizationId,
					reason: "Initial credits",
				});

				const spend = {
					actorId,
					operationId: crypto.randomUUID(),
					organizationId,
				};
				const competingSpend = {
					...spend,
					operationId: crypto.randomUUID(),
				};
				const spends = await Promise.allSettled([
					wallet.chargeWorkspaceBrief(spend),
					wallet.chargeWorkspaceBrief(competingSpend),
				]);
				const winnerIndex = spends.findIndex(
					({ status }) => status === "fulfilled"
				);
				const winner = spends[winnerIndex];
				const loser = spends[1 - winnerIndex];
				if (winner?.status !== "fulfilled" || loser?.status !== "rejected") {
					throw new Error("Exactly one spend must win");
				}
				expect(loser.reason).toMatchObject({ statusCode: 402 });

				const charged = winnerIndex === 0 ? spend : competingSpend;
				const uncharged = winnerIndex === 0 ? competingSpend : spend;
				expect((await wallet.getWallet(organizationId)).balance).toBe(0);
				await expect(
					wallet.chargeWorkspaceBrief(charged)
				).rejects.toMatchObject({ statusCode: 409 });
				expect(await wallet.getAiChargeStatus(charged)).toEqual({
					requestId: charged.operationId,
					status: "charged",
				});
				expect(await wallet.getAiChargeStatus(uncharged)).toEqual({
					requestId: null,
					status: "not_recorded",
				});
				expect(
					await wallet.getAiChargeStatus({
						...charged,
						actorId: crypto.randomUUID(),
					})
				).toEqual({ requestId: null, status: "not_recorded" });

				const reversal = {
					entryId: winner.value,
					organizationId,
					reason: "Confirmed failure",
				};
				await expect(
					wallet.reverseCharge({
						...reversal,
						organizationId: otherOrganizationId,
					})
				).rejects.toMatchObject({ statusCode: 404 });

				const reversals = await Promise.all([
					wallet.reverseCharge(reversal),
					wallet.reverseCharge(reversal),
				]);
				expect(reversals.filter(({ applied }) => applied)).toHaveLength(1);
				expect(await wallet.getAiChargeStatus(charged)).toEqual({
					requestId: charged.operationId,
					status: "reversed",
				});

				const restored = await wallet.getWallet(organizationId);
				expect(restored.balance).toBe(3);
				expect(restored.entries.map(({ delta }) => delta).sort()).toEqual([
					-3, 3, 3,
				]);
				expect(await wallet.getWallet(otherOrganizationId)).toMatchObject({
					balance: 0,
					entries: [],
				});

				// A declined spend can succeed with its original key after funding.
				await expect(
					wallet.chargeWorkspaceBrief(uncharged)
				).resolves.toBeString();

				expect(
					await wallet.findChargesByRequestId(
						organizationId,
						charged.operationId
					)
				).toMatchObject([
					{
						actorEmail,
						actorId,
						entryId: winner.value,
						reversalEntryId: reversals[0].entryId,
					},
				]);
				expect(
					await wallet.findChargesByRequestId(
						otherOrganizationId,
						charged.operationId
					)
				).toEqual([]);
			}
		);
	});
});
