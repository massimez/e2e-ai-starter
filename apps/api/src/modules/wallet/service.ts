import { type Database, db } from "@workspace/db";
import {
	organization,
	user,
	walletEntry,
	workspaceWallet,
} from "@workspace/db/schema";
import { and, desc, eq, lt, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
	AppError,
	ConflictError,
	isPgErrorCode,
	NotFoundError,
} from "../../lib/errors";

const WORKSPACE_BRIEF_CREDIT_COST = 3;

type WalletEntryInput = Pick<
	typeof walletEntry.$inferInsert,
	| "actorId"
	| "delta"
	| "kind"
	| "operationKey"
	| "organizationId"
	| "reason"
	| "requestId"
>;

type WalletTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const MAX_BALANCE = 2_147_483_647;
const SPEND_OPERATION_PREFIX = "spend:";
const REVERSAL_OPERATION_PREFIX = "reversal:";
const reversalEntry = alias(walletEntry, "reversal_entry");

function findCharges(
	database: Database,
	organizationId: string,
	...filters: SQL[]
) {
	return database
		.select({
			actorEmail: user.email,
			actorId: walletEntry.actorId,
			createdAt: walletEntry.createdAt,
			delta: walletEntry.delta,
			entryId: walletEntry.id,
			requestId: walletEntry.requestId,
			reversalEntryId: reversalEntry.id,
		})
		.from(walletEntry)
		.leftJoin(user, eq(user.id, walletEntry.actorId))
		.leftJoin(
			reversalEntry,
			and(
				eq(reversalEntry.organizationId, walletEntry.organizationId),
				eq(
					reversalEntry.operationKey,
					sql`${REVERSAL_OPERATION_PREFIX}::text || ${walletEntry.id}::text`
				)
			)
		)
		.where(
			and(
				eq(walletEntry.organizationId, organizationId),
				lt(walletEntry.delta, 0),
				...filters
			)
		);
}

function insufficientCredits() {
	return new AppError(
		"This workspace has insufficient AI credits. Contact your platform administrator.",
		402,
		"INSUFFICIENT_CREDITS"
	);
}

async function applyEntryInTx(
	tx: WalletTransaction,
	wallet: typeof workspaceWallet.$inferSelect,
	input: WalletEntryInput
) {
	const [existing] = await tx
		.select({
			delta: walletEntry.delta,
			id: walletEntry.id,
			reason: walletEntry.reason,
		})
		.from(walletEntry)
		.where(
			and(
				eq(walletEntry.organizationId, input.organizationId),
				eq(walletEntry.operationKey, input.operationKey)
			)
		);
	if (existing) {
		if (
			input.kind === "grant" &&
			(existing.delta !== input.delta || existing.reason !== input.reason)
		) {
			throw new ConflictError(
				"This idempotency key was already used for a different grant"
			);
		}
		return { applied: false, entryId: existing.id };
	}

	const balance = wallet.balance + input.delta;
	if (balance < 0) {
		throw insufficientCredits();
	}
	if (balance > MAX_BALANCE) {
		throw new ConflictError(
			"The workspace wallet has reached its credit limit"
		);
	}

	const entryId = crypto.randomUUID();
	await tx.insert(walletEntry).values({ ...input, id: entryId });
	await tx
		.update(workspaceWallet)
		.set({ balance })
		.where(eq(workspaceWallet.organizationId, input.organizationId));
	return { applied: true, entryId };
}

async function postEntry(database: Database, input: WalletEntryInput) {
	return await database.transaction(async (tx) => {
		if (input.kind === "grant") {
			await tx
				.insert(workspaceWallet)
				.values({ organizationId: input.organizationId })
				.onConflictDoNothing({ target: workspaceWallet.organizationId });
		}

		const [wallet] = await tx
			.select()
			.from(workspaceWallet)
			.where(eq(workspaceWallet.organizationId, input.organizationId))
			.for("update");
		if (!wallet) {
			throw input.delta < 0
				? insufficientCredits()
				: new NotFoundError("Workspace wallet");
		}

		return await applyEntryInTx(tx, wallet, input);
	});
}

export function createWalletService(database: Database = db) {
	return {
		async getAiChargeStatus(params: {
			actorId: string;
			operationId: string;
			organizationId: string;
		}) {
			const [charge] = await findCharges(
				database,
				params.organizationId,
				eq(
					walletEntry.operationKey,
					SPEND_OPERATION_PREFIX + params.operationId
				),
				eq(walletEntry.actorId, params.actorId)
			).limit(1);
			if (!charge) {
				return { requestId: null, status: "not_recorded" } as const;
			}
			return {
				requestId: charge.requestId,
				status: charge.reversalEntryId ? "reversed" : "charged",
			} as const;
		},

		async findChargesByRequestId(organizationId: string, requestId: string) {
			return await findCharges(
				database,
				organizationId,
				eq(walletEntry.requestId, requestId)
			)
				.orderBy(desc(walletEntry.createdAt), desc(walletEntry.id))
				.limit(50);
		},

		async getWallet(organizationId: string) {
			// One snapshot keeps the balance and recent entries consistent during writes.
			return await database.transaction(
				async (tx) => {
					const [wallet] = await tx
						.select({ balance: workspaceWallet.balance })
						.from(organization)
						.leftJoin(
							workspaceWallet,
							eq(workspaceWallet.organizationId, organization.id)
						)
						.where(eq(organization.id, organizationId));
					if (!wallet) {
						throw new NotFoundError("Organization");
					}
					const entries = await tx
						.select({
							createdAt: walletEntry.createdAt,
							delta: walletEntry.delta,
							id: walletEntry.id,
							kind: walletEntry.kind,
						})
						.from(walletEntry)
						.where(eq(walletEntry.organizationId, organizationId))
						.orderBy(desc(walletEntry.createdAt), desc(walletEntry.id))
						.limit(20);
					return {
						balance: wallet.balance ?? 0,
						entries,
						prices: { workspace_brief: WORKSPACE_BRIEF_CREDIT_COST },
					};
				},
				{ accessMode: "read only", isolationLevel: "repeatable read" }
			);
		},

		async grantCredits(params: {
			actorId: string;
			credits: number;
			operationId: string;
			organizationId: string;
			reason: string;
		}) {
			try {
				return await postEntry(database, {
					actorId: params.actorId,
					delta: params.credits,
					kind: "grant",
					operationKey: `grant:${params.operationId}`,
					organizationId: params.organizationId,
					reason: params.reason,
				});
			} catch (error) {
				if (isPgErrorCode(error, "23503")) {
					throw new NotFoundError("Organization or grant actor", {
						cause: error,
					});
				}
				throw error;
			}
		},

		async chargeWorkspaceBrief(params: {
			actorId: string;
			operationId: string;
			organizationId: string;
		}) {
			const entry = await postEntry(database, {
				actorId: params.actorId,
				delta: -WORKSPACE_BRIEF_CREDIT_COST,
				kind: "workspace_brief",
				operationKey: SPEND_OPERATION_PREFIX + params.operationId,
				organizationId: params.organizationId,
				requestId: params.operationId,
			});
			if (!entry.applied) {
				throw new ConflictError(
					"This AI request was already charged or reversed",
					{
						code: "AI_REQUEST_ALREADY_CHARGED",
					}
				);
			}
			return entry.entryId;
		},

		async reverseCharge(params: {
			actorId?: string;
			entryId: string;
			organizationId: string;
			reason: string;
		}) {
			return await database.transaction(async (tx) => {
				const [wallet] = await tx
					.select()
					.from(workspaceWallet)
					.where(eq(workspaceWallet.organizationId, params.organizationId))
					.for("update");
				if (!wallet) {
					throw new NotFoundError("Wallet charge");
				}

				const [charge] = await tx
					.select({ delta: walletEntry.delta })
					.from(walletEntry)
					.where(
						and(
							eq(walletEntry.organizationId, params.organizationId),
							eq(walletEntry.id, params.entryId),
							lt(walletEntry.delta, 0)
						)
					);
				if (!charge) {
					throw new NotFoundError("Wallet charge");
				}

				const entry = await applyEntryInTx(tx, wallet, {
					actorId: params.actorId,
					delta: -charge.delta,
					kind: "reversal",
					operationKey:
						REVERSAL_OPERATION_PREFIX + params.entryId.toLowerCase(),
					organizationId: params.organizationId,
					reason: params.reason,
				});
				return { ...entry, credits: -charge.delta };
			});
		},
	};
}

export type WalletService = ReturnType<typeof createWalletService>;

export const walletService = createWalletService();
