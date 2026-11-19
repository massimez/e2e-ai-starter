import type { Context } from "hono";
import {
	type AppEnv,
	createErrorResponse,
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
	requireUser,
} from "../../lib/create-hono-app";
import { authMiddleware } from "../../middleware/auth";
import { rateLimiter } from "../../middleware/rate-limiter";
import {
	deletePushSubscriptionSchema,
	listNotificationsQuerySchema,
	notificationIdParamSchema,
	pushSubscriptionSchema,
	updatePreferenceSchema,
} from "./schema";
import { notificationService } from "./service";

async function handlePushUnsubscribe(c: Context<AppEnv>) {
	const user = requireUser(c);
	const input = deletePushSubscriptionSchema.parse(
		(c.req as { valid: (target: "json") => unknown }).valid("json")
	);
	const result = await notificationService.deletePushSubscription(
		user.id,
		input.endpoint
	);
	return c.json(createSuccessResponse(result, "Push subscription removed"));
}

export const notificationRoutes = createRouter()
	// All notification routes require authenticated session and per-actor rate limiting
	.use("*", authMiddleware, rateLimiter(60_000, 120, { identity: "actor" }))

	// 1. List user notifications with pagination & unread count
	.get("/", queryValidator(listNotificationsQuerySchema), async (c) => {
		const user = requireUser(c);
		const query = c.req.valid("query");
		const data = await notificationService.getUserNotifications(user.id, query);
		return c.json(createSuccessResponse(data));
	})

	// 2. Get unread notification count badge
	.get("/unread-count", async (c) => {
		const user = requireUser(c);
		const unreadCount = await notificationService.getUnreadCount(user.id);
		return c.json(createSuccessResponse({ unreadCount }));
	})

	// 3. Mark single notification as read
	.patch("/:id/read", paramValidator(notificationIdParamSchema), async (c) => {
		const user = requireUser(c);
		const { id } = c.req.valid("param");
		const updated = await notificationService.markAsRead(user.id, id);
		if (!updated) {
			return c.json(
				createErrorResponse("NotFound", "Notification not found"),
				404
			);
		}

		return c.json(createSuccessResponse(updated, "Marked as read"));
	})

	// 4. Mark all user notifications as read
	.patch("/read-all", async (c) => {
		const user = requireUser(c);
		const result = await notificationService.markAllAsRead(user.id);
		return c.json(
			createSuccessResponse(result, "All notifications marked as read")
		);
	})

	// 5. Get user notification preferences
	.get("/preferences", async (c) => {
		const user = requireUser(c);
		const preferences = await notificationService.getPreferences(user.id);
		return c.json(createSuccessResponse(preferences));
	})

	// 6. Update notification category/channel preference
	.patch("/preferences", jsonValidator(updatePreferenceSchema), async (c) => {
		const user = requireUser(c);
		const input = c.req.valid("json");
		const updated = await notificationService.updatePreference(user.id, input);
		return c.json(createSuccessResponse(updated, "Preference updated"));
	})

	// 7. Subscribe device for Web Push notifications
	.post("/push/subscribe", jsonValidator(pushSubscriptionSchema), async (c) => {
		const user = requireUser(c);
		const input = c.req.valid("json");
		const sub = await notificationService.savePushSubscription(user.id, input);
		return c.json(
			createSuccessResponse(sub, "Push subscription registered"),
			201
		);
	})

	// 8. Unsubscribe device from Web Push (DELETE and POST supported for client ergonomics)
	.delete(
		"/push/unsubscribe",
		jsonValidator(deletePushSubscriptionSchema),
		handlePushUnsubscribe
	)
	.post(
		"/push/unsubscribe",
		jsonValidator(deletePushSubscriptionSchema),
		handlePushUnsubscribe
	);
