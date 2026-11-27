import { z } from "zod";
import { ValidationError } from "../../lib/errors";

const operationIdSchema = z.uuid().transform((value) => value.toLowerCase());

export const walletOperationParamSchema = z.object({
	operationId: operationIdSchema,
});

export const walletChargeLookupSchema = z.object({
	requestId: z
		.string()
		.trim()
		.min(1)
		.max(64)
		.transform((value) => value.toLowerCase()),
});

export const grantCreditsSchema = z.object({
	credits: z.number().int().min(1).max(1_000_000),
	reason: z.string().trim().min(1).max(240),
});

export const reverseChargeParamSchema = z.object({
	entryId: z.uuid(),
	organizationId: z.string().trim().min(1).max(128),
});

export const reverseChargeBodySchema = grantCreditsSchema.pick({
	reason: true,
});

export function requireWalletOperationId(value: string | undefined): string {
	const result = operationIdSchema.safeParse(value);
	if (!result.success) {
		throw new ValidationError(
			"Idempotency-Key must be a UUID",
			"Idempotency-Key"
		);
	}
	return result.data;
}
