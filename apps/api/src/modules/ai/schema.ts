import { z } from "zod";

export {
	type AiChatRequest,
	aiChatRequestSchema,
	type WorkspaceBriefRequest,
	workspaceBriefRequestSchema,
} from "@workspace/ai-core/contracts";

export const aiThreadIdParamSchema = z.object({
	id: z.string().trim().min(1, "Thread ID is required").max(128),
});

export const listAiThreadsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(50).default(20),
	page: z.coerce.number().int().min(0).max(1000).default(0),
});

export type AiThreadIdParam = z.infer<typeof aiThreadIdParamSchema>;
export type ListAiThreadsQuery = z.infer<typeof listAiThreadsQuerySchema>;
