import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
} from "../../lib/create-hono-app";
import { getActiveOrgContext } from "../../lib/tenant";
import { authMiddleware } from "../../middleware/auth";
import { hasOrgPermission } from "../../middleware/org-permission";
import { rateLimiter } from "../../middleware/rate-limiter";
import { tenantBoundaryMiddleware } from "../../middleware/tenant-boundary";
import {
	commitUploadsSchema,
	createStorageFolderSchema,
	deleteUploadBodySchema,
	folderIdParamSchema,
	listUploadsQuerySchema,
	presignUploadSchema,
	updateStorageFolderSchema,
	updateUploadSchema,
	uploadIdParamSchema,
} from "./schema";
import {
	commitUploads,
	createStorageFolder,
	deleteStorageFolder,
	deleteUpload,
	getStorageUsage,
	getUploadFileStream,
	getUploadSignedDownloadUrl,
	indexUploadKnowledge,
	listStorageFolders,
	listUploads,
	presignUpload,
	updateStorageFolder,
	updateUpload,
} from "./service";

export const storageRoutes = createRouter()
	// All storage management routes require authenticated session, tenant check, and baseline rate limit
	.use(
		"*",
		authMiddleware,
		tenantBoundaryMiddleware,
		rateLimiter(60_000, 120, { identity: "actor" })
	)

	// 1. Generate presigned upload URL for direct client-to-storage upload
	.post(
		"/presign",
		hasOrgPermission("storage:create"),
		jsonValidator(presignUploadSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await presignUpload({
				input,
				organizationId,
				userId,
			});
			return c.json(createSuccessResponse(result), 201);
		}
	)

	// 2. Commit completed upload once verified in object storage
	.post(
		"/commit",
		hasOrgPermission("storage:create"),
		jsonValidator(commitUploadsSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await commitUploads({
				input,
				organizationId,
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	)

	// 3. List organization files / uploads (paginated envelope)
	.get(
		"/",
		hasOrgPermission("storage:read"),
		queryValidator(listUploadsQuerySchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const query = c.req.valid("query");
			const data = await listUploads({
				organizationId,
				query,
			});
			return c.json(createSuccessResponse(data));
		}
	)

	// 4. Get organization storage usage metrics
	.get("/usage", hasOrgPermission("storage:read"), async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const usage = await getStorageUsage(organizationId);
		return c.json(createSuccessResponse(usage));
	})

	// 4b. List, create, and delete workspace storage folders
	.get("/folders", hasOrgPermission("storage:read"), async (c) => {
		const { organizationId } = getActiveOrgContext(c);
		const folders = await listStorageFolders(organizationId);
		return c.json(createSuccessResponse(folders));
	})
	.post(
		"/folders",
		hasOrgPermission("storage:create"),
		jsonValidator(createStorageFolderSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const folder = await createStorageFolder({
				input,
				organizationId,
				userId,
			});
			return c.json(createSuccessResponse(folder), 201);
		}
	)
	.patch(
		"/folders/:id",
		hasOrgPermission("storage:update"),
		paramValidator(folderIdParamSchema),
		jsonValidator(updateStorageFolderSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const input = c.req.valid("json");
			const folder = await updateStorageFolder({
				id,
				input,
				organizationId,
				userId,
			});
			return c.json(createSuccessResponse(folder));
		}
	)
	.delete(
		"/folders/:id",
		hasOrgPermission("storage:delete"),
		paramValidator(folderIdParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await deleteStorageFolder({ id, organizationId, userId });
			return c.json(createSuccessResponse(result));
		}
	)

	// 4c. Rename file and/or move file to another folder (or root)
	.patch(
		"/files/:id",
		hasOrgPermission("storage:update"),
		paramValidator(uploadIdParamSchema),
		jsonValidator(updateUploadSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const input = c.req.valid("json");
			const result = await updateUpload({ id, input, organizationId, userId });
			return c.json(createSuccessResponse(result));
		}
	)

	// 4c. Index a committed PDF/Markdown/text/CSV/JSON upload into pgvector RAG knowledge
	.post(
		"/files/:id/index",
		hasOrgPermission("storage:create"),
		rateLimiter(60_000, 15, {
			identity: "actor",
			operation: "storage:index",
		}),
		paramValidator(uploadIdParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await indexUploadKnowledge({
				id,
				organizationId,
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	)

	// 5. Generate short-lived presigned download URL for a private file
	.get(
		"/files/:id/url",
		hasOrgPermission("storage:read"),
		paramValidator(uploadIdParamSchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await getUploadSignedDownloadUrl({ id, organizationId });
			return c.json(createSuccessResponse(result));
		}
	)

	// 6. Stream private tenant file securely via authenticated endpoint
	.get(
		"/files/:id",
		hasOrgPermission("storage:read"),
		paramValidator(uploadIdParamSchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const file = await getUploadFileStream({ id, organizationId });
			return c.body(file.stream, 200, {
				"Cache-Control": "private, max-age=300",
				"Content-Disposition": file.disposition,
				"Content-Type": file.contentType,
				"X-Content-Type-Options": "nosniff",
			});
		}
	)

	// 7. Delete uploaded file by UUID
	.delete(
		"/files/:id",
		hasOrgPermission("storage:delete"),
		paramValidator(uploadIdParamSchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await deleteUpload({ id, organizationId, userId });
			return c.json(createSuccessResponse(result));
		}
	)

	// 8. Delete uploaded file by id or fileKey in JSON body
	.delete(
		"/",
		hasOrgPermission("storage:delete"),
		jsonValidator(deleteUploadBodySchema),
		async (c) => {
			const { organizationId, userId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await deleteUpload({
				fileKey: input.fileKey,
				id: input.id,
				organizationId,
				userId,
			});
			return c.json(createSuccessResponse(result));
		}
	);
