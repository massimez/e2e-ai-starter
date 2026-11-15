import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { db } from "@workspace/db";
import { type Job, UnrecoverableError } from "bullmq";
import { WebPushError } from "web-push";
import { env, parseWorkerEnv } from "../src/env";
import { sendEmail } from "../src/lib/email-sender";
import {
	PushDeliveryError,
	pushTransport,
	sendWebPush,
} from "../src/lib/push-sender";
import { type EmailJobData, processEmailJob } from "../src/processors/email";
import { escapeHtml, sanitizeHttpUrl } from "../src/processors/email/templates";
import {
	type NotificationJobData,
	processNotificationJob,
} from "../src/processors/notification";
import { handlePushNotification } from "../src/processors/notification/handlers/handle-push-notification";

function createQueryChain<T>(result: T) {
	const chain = {
		from: () => chain,
		onConflictDoNothing: () => Promise.resolve(result),
		// biome-ignore lint/suspicious/noThenProperty: Drizzle awaitable mock
		then: <R>(
			onfulfilled?: (value: T) => R | PromiseLike<R>,
			onrejected?: (reason: unknown) => R | PromiseLike<R>
		) => Promise.resolve(result).then(onfulfilled, onrejected),
		values: () => chain,
		where: () => chain,
	};
	return chain;
}

describe("worker environment validation", () => {
	test("rejects unpaired VAPID keys and enforces production secrets", () => {
		expect(() =>
			parseWorkerEnv({
				NODE_ENV: "development",
				VAPID_PUBLIC_KEY: "public-only",
			})
		).toThrow("Invalid Worker environment variables");

		expect(() =>
			parseWorkerEnv({
				DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app",
				NODE_ENV: "production",
				REDIS_URL: "redis://localhost:6379",
			})
		).toThrow("RESEND_API_KEY is required in production");
	});

	test("normalizes optional LOG_LEVEL and LOG_FORMAT overrides", () => {
		const valid = parseWorkerEnv({
			LOG_FORMAT: "PRETTY",
			LOG_LEVEL: "WARN",
			NODE_ENV: "production",
			DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app",
			REDIS_URL: "redis://localhost:6379",
			RESEND_API_KEY: "re_test_123",
		});
		expect(valid.LOG_FORMAT).toBe("pretty");
		expect(valid.LOG_LEVEL).toBe("warn");

		expect(() =>
			parseWorkerEnv({
				LOG_LEVEL: "trace",
				NODE_ENV: "development",
			})
		).toThrow("Invalid Worker environment variables");

		expect(() =>
			parseWorkerEnv({
				NODE_ENV: "development",
				REDIS_URL: "redis://",
			})
		).toThrow("Invalid Worker environment variables");

		expect(() =>
			parseWorkerEnv({
				NODE_ENV: "development",
				REDIS_URL: "https://redis.example.com:6379",
			})
		).toThrow("Invalid Worker environment variables");
	});
});

describe("email template escaping and delivery retries", () => {
	const originalResendKey = env.RESEND_API_KEY;

	beforeEach(() => {
		(env as { RESEND_API_KEY: string }).RESEND_API_KEY = originalResendKey;
	});

	afterEach(() => {
		(env as { RESEND_API_KEY: string }).RESEND_API_KEY = originalResendKey;
		mock.restore();
	});

	test("escapes dangerous HTML characters and blocks javascript/data URLs", () => {
		expect(escapeHtml(`<script>alert("xss")</script> & 'ok' \``)).toBe(
			"&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;ok&#39; &#96;"
		);
		expect(sanitizeHttpUrl("javascript:alert(1)").href).toBe("#");
		expect(sanitizeHttpUrl("data:text/html,<script>").href).toBe("#");

		const valid = sanitizeHttpUrl(
			"https://app.example.com/accept?id=123&role=admin"
		);
		expect(valid.href).toBe(
			"https://app.example.com/accept?id=123&amp;role=admin"
		);
	});

	test("throws UnrecoverableError for malformed job payloads and invalid emails", async () => {
		await expect(
			processEmailJob({
				data: { template: "welcome" },
				id: "job-1",
			} as Job<EmailJobData>)
		).rejects.toBeInstanceOf(UnrecoverableError);

		await expect(
			sendEmail({
				html: "<p>Hello</p>",
				subject: "Test\r\nBcc: evil@example.com",
				to: "not-an-email",
			})
		).rejects.toBeInstanceOf(UnrecoverableError);
	});

	test("treats Resend 4xx as UnrecoverableError and 5xx as retryable Error", async () => {
		(env as { RESEND_API_KEY: string }).RESEND_API_KEY = "re_test_123";

		const fetchSpy = spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(new Response("Invalid payload", { status: 422 }))
			.mockResolvedValueOnce(new Response("Upstream busy", { status: 503 }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "msg_123" }), { status: 200 })
			);

		await expect(
			sendEmail({
				html: "<p>Hi</p>",
				idempotencyKey: "email:job-422",
				subject: "Hello\r\nHeader-Attempt",
				to: "user@example.com",
			})
		).rejects.toBeInstanceOf(UnrecoverableError);

		await expect(
			sendEmail({
				html: "<p>Hi</p>",
				subject: "Hello",
				to: "user@example.com",
			})
		).rejects.toThrow("Resend API error (503)");

		const okResult = await sendEmail({
			html: "<p>Hi</p>",
			idempotencyKey: "email:job-200",
			subject: "Line 1\nLine 2",
			to: "user@example.com",
		});

		expect(okResult).toEqual({ messageId: "msg_123", simulated: false });
		const init = fetchSpy.mock.calls[2]?.[1] as RequestInit | undefined;
		const headers = (init?.headers ?? {}) as Record<string, string>;
		expect(headers["Idempotency-Key"]).toBe("email:job-200");
		expect(JSON.parse(String(init?.body))).toMatchObject({
			subject: "Line 1 Line 2",
		});
	});
});

describe("web push delivery and notification processor", () => {
	const originalPublic = env.VAPID_PUBLIC_KEY;
	const originalPrivate = env.VAPID_PRIVATE_KEY;

	beforeEach(() => {
		(env as { VAPID_PUBLIC_KEY: string }).VAPID_PUBLIC_KEY = originalPublic;
		(env as { VAPID_PRIVATE_KEY: string }).VAPID_PRIVATE_KEY = originalPrivate;
	});

	afterEach(() => {
		(env as { VAPID_PUBLIC_KEY: string }).VAPID_PUBLIC_KEY = originalPublic;
		(env as { VAPID_PRIVATE_KEY: string }).VAPID_PRIVATE_KEY = originalPrivate;
		mock.restore();
	});

	test("rejects non-HTTPS, IP literals, localhost, and private DNS resolutions for Web Push endpoints", async () => {
		const blockedEndpoints = [
			"http://untrusted.example.com/push",
			"https://localhost/push",
			"https://127.0.0.1/push",
			"https://169.254.169.254/latest/meta-data",
			"https://[::1]/push",
			"https://push.internal/v1/abc",
			"https://push.example.com:8443/v1/abc",
		];

		await Promise.all(
			blockedEndpoints.map((endpoint) =>
				expect(
					sendWebPush(
						{
							auth: "auth-key",
							endpoint,
							p256dh: "p256-key",
						},
						{ body: "hello", title: "alert" }
					)
				).rejects.toBeInstanceOf(PushDeliveryError)
			)
		);

		// DNS rebinding / private resolved IP must be rejected before delivery
		spyOn(pushTransport, "lookup").mockResolvedValueOnce([
			{ address: "169.254.169.254", family: 4 },
		]);
		await expect(
			sendWebPush(
				{
					auth: "auth-key",
					endpoint: "https://rebind.example.com/push",
					p256dh: "p256-key",
				},
				{ body: "hello", title: "alert" }
			)
		).rejects.toThrow("restricted network address");

		spyOn(pushTransport, "lookup").mockResolvedValueOnce([
			{ address: "fd00::1", family: 6 },
		]);
		await expect(
			sendWebPush(
				{
					auth: "auth-key",
					endpoint: "https://ula.example.com/push",
					p256dh: "p256-key",
				},
				{ body: "hello", title: "alert" }
			)
		).rejects.toThrow("restricted network address");
	});

	test("pins validated public IP agent when dispatching Web Push", async () => {
		(env as { VAPID_PUBLIC_KEY: string }).VAPID_PUBLIC_KEY = "vapid-pub";
		(env as { VAPID_PRIVATE_KEY: string }).VAPID_PRIVATE_KEY = "vapid-priv";

		spyOn(pushTransport, "lookup").mockResolvedValueOnce([
			{ address: "93.184.216.34", family: 4 },
		]);
		const sendSpy = spyOn(
			pushTransport,
			"sendNotification"
		).mockResolvedValueOnce({
			body: "",
			headers: {},
			statusCode: 201,
		});

		const result = await sendWebPush(
			{
				auth: "auth-key",
				endpoint: "https://push.example.com/v1/ok",
				p256dh: "p256-key",
			},
			{ body: "hello", title: "alert" }
		);

		expect(result).toEqual({ simulated: false, statusCode: 201 });
		const requestOptions = sendSpy.mock.calls[0]?.[2];
		expect(requestOptions?.agent).toBeDefined();
	});

	test("deletes expired 410 push subscriptions and continues fan-out", async () => {
		(env as { VAPID_PUBLIC_KEY: string }).VAPID_PUBLIC_KEY = "vapid-pub";
		(env as { VAPID_PRIVATE_KEY: string }).VAPID_PRIVATE_KEY = "vapid-priv";

		spyOn(pushTransport, "lookup").mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
		]);

		spyOn(db, "select").mockImplementation((() =>
			createQueryChain([
				{
					endpoint: "https://push.example.com/expired",
					id: "sub_expired",
					keys: { auth: "a1", p256dh: "p1" },
					userId: "user_1",
				},
				{
					endpoint: "https://push.example.com/active",
					id: "sub_active",
					keys: { auth: "a2", p256dh: "p2" },
					userId: "user_1",
				},
			])) as never);

		const deletedIds: string[] = [];
		spyOn(db, "delete").mockImplementation((() => {
			deletedIds.push("deleted");
			return createQueryChain(undefined);
		}) as never);

		spyOn(pushTransport, "sendNotification")
			.mockRejectedValueOnce(
				new WebPushError(
					"Gone",
					410,
					{},
					"expired",
					"https://push.example.com/expired"
				)
			)
			.mockResolvedValueOnce({
				body: "",
				headers: {},
				statusCode: 201,
			});

		await handlePushNotification({
			category: "team",
			content: "New team invite",
			title: "Team update",
			type: "invite",
			userId: "user_1",
		});

		expect(deletedIds).toHaveLength(1);
	});

	test("processNotificationJob validates input, honors muted channels, and sets idempotencyKey", async () => {
		await expect(
			processNotificationJob({
				data: { title: "Missing fields" },
				id: "bad-job",
			} as Job<NotificationJobData>)
		).rejects.toBeInstanceOf(UnrecoverableError);

		spyOn(db, "select").mockImplementation((() =>
			createQueryChain([
				{ channel: "in_app", enabled: true },
				{ channel: "email", enabled: false },
				{ channel: "push", enabled: false },
			])) as never);

		let insertedValues: Record<string, unknown> | undefined;
		spyOn(db, "insert").mockImplementation((() => ({
			values: (vals: Record<string, unknown>) => {
				insertedValues = vals;
				return createQueryChain(undefined);
			},
		})) as never);

		const res = await processNotificationJob({
			data: {
				category: "security",
				content: "Password updated",
				title: "Security Alert",
				type: "password_reset",
				userId: "user_42",
			},
			id: "notif-job-9",
		} as Job<NotificationJobData>);

		expect(res.deliveredChannels).toEqual(["in_app"]);
		expect(insertedValues?.idempotencyKey).toBe("in_app:user_42:notif-job-9");
	});

	test("throws retryable error on partial push failure and skips already-delivered channels/subscriptions on retry", async () => {
		(env as { VAPID_PUBLIC_KEY: string }).VAPID_PUBLIC_KEY = "vapid-pub";
		(env as { VAPID_PRIVATE_KEY: string }).VAPID_PRIVATE_KEY = "vapid-priv";

		spyOn(pushTransport, "lookup").mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
		]);

		// 1. Direct handlePushNotification partial failure must still throw retryable error even when succeededCount > 0
		spyOn(db, "select").mockImplementation((() =>
			createQueryChain([
				{
					endpoint: "https://push.example.com/sub-1",
					id: "sub_1",
					keys: { auth: "a1", p256dh: "p1" },
					userId: "user_1",
				},
				{
					endpoint: "https://push.example.com/sub-2",
					id: "sub_2",
					keys: { auth: "a2", p256dh: "p2" },
					userId: "user_1",
				},
			])) as never);

		spyOn(pushTransport, "sendNotification")
			.mockResolvedValueOnce({ body: "", headers: {}, statusCode: 201 })
			.mockRejectedValueOnce(
				new WebPushError(
					"Service Unavailable",
					503,
					{},
					"retry later",
					"https://push.example.com/sub-2"
				)
			);

		await expect(
			handlePushNotification({
				category: "team",
				content: "Partial push test",
				title: "Update",
				type: "invite",
				userId: "user_1",
			})
		).rejects.toThrow("Push service transient error (503)");

		mock.restore();
		(env as { VAPID_PUBLIC_KEY: string }).VAPID_PUBLIC_KEY = "vapid-pub";
		(env as { VAPID_PRIVATE_KEY: string }).VAPID_PRIVATE_KEY = "vapid-priv";
		spyOn(pushTransport, "lookup").mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
		]);

		// 2. processNotificationJob checkpoints completed channels & pushSubscriptionIds, then skips them on retry
		let jobData: Record<string, unknown> = {
			category: "team",
			channels: ["in_app", "push"],
			content: "Retry deduplication",
			title: "Update",
			type: "invite",
			userId: "user_99",
		};

		let inAppCalls = 0;
		const pushEndpointsAttempted: string[] = [];

		const prefsRows = [
			{ channel: "in_app", enabled: true },
			{ channel: "push", enabled: true },
		];
		const subsRows = [
			{
				endpoint: "https://push.example.com/sub-ok",
				id: "sub_ok",
				keys: { auth: "a1", p256dh: "p1" },
				userId: "user_99",
			},
			{
				endpoint: "https://push.example.com/sub-flaky",
				id: "sub_flaky",
				keys: { auth: "a2", p256dh: "p2" },
				userId: "user_99",
			},
		];

		let selectCallCount = 0;
		spyOn(db, "select").mockImplementation((() => {
			selectCallCount += 1;
			// Odd calls in each attempt query notificationPreference; even calls query pushSubscription
			return createQueryChain(selectCallCount % 2 === 1 ? prefsRows : subsRows);
		}) as never);

		spyOn(db, "insert").mockImplementation((() => ({
			values: () => {
				inAppCalls += 1;
				return createQueryChain(undefined);
			},
		})) as never);

		spyOn(pushTransport, "sendNotification").mockImplementation(((sub) => {
			pushEndpointsAttempted.push(sub.endpoint);
			if (
				sub.endpoint === "https://push.example.com/sub-flaky" &&
				pushEndpointsAttempted.filter((e) => e.endsWith("sub-flaky")).length ===
					1
			) {
				return Promise.reject(
					new WebPushError("Timeout", 503, {}, "busy", sub.endpoint)
				);
			}
			return Promise.resolve({ body: "", headers: {}, statusCode: 201 });
		}) as typeof pushTransport.sendNotification);

		const mockJob = {
			get data() {
				return jobData as NotificationJobData;
			},
			id: "notif-retry-1",
			updateData: (nextData: NotificationJobData) => {
				jobData = nextData as unknown as Record<string, unknown>;
				return Promise.resolve();
			},
		} as unknown as Job<NotificationJobData>;

		await expect(processNotificationJob(mockJob)).rejects.toThrow(
			"Push service transient error (503)"
		);
		expect(inAppCalls).toBe(1);
		expect(pushEndpointsAttempted).toEqual([
			"https://push.example.com/sub-ok",
			"https://push.example.com/sub-flaky",
		]);

		// Retry attempt: in_app and sub_ok must NOT run again!
		const retryResult = await processNotificationJob(mockJob);
		expect(retryResult.deliveredChannels).toEqual(["in_app", "push"]);
		expect(inAppCalls).toBe(1);
		expect(pushEndpointsAttempted).toEqual([
			"https://push.example.com/sub-ok",
			"https://push.example.com/sub-flaky",
			"https://push.example.com/sub-flaky",
		]);
	});
});
