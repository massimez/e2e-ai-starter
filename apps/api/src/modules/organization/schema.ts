import { z } from "zod";

export const transferOwnershipSchema = z.object({
	newOwnerUserId: z.string().trim().min(1, "New owner user ID is required"),
});

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
