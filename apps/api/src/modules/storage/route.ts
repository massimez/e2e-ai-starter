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
	deleteUploadBodySchema,
	listUploadsQuerySchema,
	presignUploadSchema,
	uploadIdParamSchema,
} from "./schema";
import {
	commitUploads,
	deleteUpload,
	getStorageUsage,
	getUploadFileStream,
	getUploadSignedDownloadUrl,
	listUploads,
	presignUpload,
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
			const { organizationId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await commitUploads({
				input,
				organizationId,
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
			return c.body(new Uint8Array(file.body), 200, {
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
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const result = await deleteUpload({ id, organizationId });
			return c.json(createSuccessResponse(result));
		}
	)

	// 8. Delete uploaded file by id or fileKey in JSON body
	.delete(
		"/",
		hasOrgPermission("storage:delete"),
		jsonValidator(deleteUploadBodySchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await deleteUpload({
				fileKey: input.fileKey,
				id: input.id,
				organizationId,
			});
			return c.json(createSuccessResponse(result));
		}
	);
