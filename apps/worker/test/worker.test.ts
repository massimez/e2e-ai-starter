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

	test("rejects non-HTTPS Web Push endpoints", async () => {
		await expect(
			sendWebPush(
				{
					auth: "auth-key",
					endpoint: "http://untrusted.example.com/push",
					p256dh: "p256-key",
				},
				{ body: "hello", title: "alert" }
			)
		).rejects.toBeInstanceOf(PushDeliveryError);
	});

	test("deletes expired 410 push subscriptions and continues fan-out", async () => {
		(env as { VAPID_PUBLIC_KEY: string }).VAPID_PUBLIC_KEY = "vapid-pub";
		(env as { VAPID_PRIVATE_KEY: string }).VAPID_PRIVATE_KEY = "vapid-priv";

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
});
