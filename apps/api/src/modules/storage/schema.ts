import { z } from "zod";
import { STORAGE_CONFIG } from "./config";

export const presignUploadSchema = z.object({
	contentType: z.string().trim().min(1).max(255),
	fileName: z.string().trim().min(1).max(255),
	folderId: z.string().uuid().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	size: z.number().int().positive().max(STORAGE_CONFIG.MAX_FILE_SIZE),
});

export const commitUploadsSchema = z.object({
	fileKeys: z.array(z.string().trim().min(1).max(512)).min(1).max(50),
});

export const listUploadsQuerySchema = z.object({
	folderId: z.string().uuid().nullable().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	page: z.coerce.number().int().min(1).max(1000).default(1),
	search: z.string().trim().min(1).max(255).optional(),
	status: z.enum(["pending", "committed", "failed"]).optional(),
});

export const uploadIdParamSchema = z.object({
	id: z.string().uuid("Invalid file ID"),
});

export const deleteUploadBodySchema = z
	.object({
		fileKey: z.string().trim().min(1).max(512).optional(),
		id: z.string().uuid().optional(),
	})
	.refine((val) => Boolean(val.id || val.fileKey), {
		message: "Either upload id or fileKey is required",
	});

export type PresignUploadInput = z.infer<typeof presignUploadSchema>;
export type CommitUploadsInput = z.infer<typeof commitUploadsSchema>;
export type ListUploadsQuery = z.infer<typeof listUploadsQuerySchema>;
export type DeleteUploadBody = z.infer<typeof deleteUploadBodySchema>;
