import { UnrecoverableError } from "bullmq";
import { sendNotification, WebPushError } from "web-push";
import { env } from "../env";
import { logInfo, logWarning } from "./logger";

export const pushTransport = {
	sendNotification,
};

export interface PushMessagePayload {
	body: string;
	data?: Record<string, unknown>;
	link?: string;
	title: string;
}

export interface PushSubscriptionTarget {
	auth: string;
	endpoint: string;
	p256dh: string;
}

export interface PushDeliveryErrorOptions extends ErrorOptions {
	isGone?: boolean;
	statusCode?: number;
}

export class PushDeliveryError extends Error {
	readonly isGone: boolean;
	readonly statusCode?: number;

	constructor(message: string, options: PushDeliveryErrorOptions = {}) {
		super(message, options);
		this.name = "PushDeliveryError";
		this.statusCode = options.statusCode;
		this.isGone = options.isGone ?? false;
	}
}

const PERMANENT_PUSH_STATUSES = new Set([400, 401, 403]);
const GONE_PUSH_STATUSES = new Set([404, 410]);

function validatePushEndpoint(endpoint: string): void {
	let parsed: URL;
	try {
		parsed = new URL(endpoint);
	} catch (error) {
		throw new PushDeliveryError("Invalid push endpoint URL", {
			cause: error,
			isGone: true,
			statusCode: 400,
		});
	}

	if (parsed.protocol === "https:") {
		return;
	}

	const isLocalDevHttp =
		env.NODE_ENV !== "production" &&
		parsed.protocol === "http:" &&
		(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");

	if (!isLocalDevHttp) {
		throw new PushDeliveryError("Push subscription endpoint must use https", {
			isGone: true,
			statusCode: 400,
		});
	}
}

export async function sendWebPush(
	sub: PushSubscriptionTarget,
	payload: PushMessagePayload
): Promise<{ simulated: boolean; statusCode: number }> {
	validatePushEndpoint(sub.endpoint);

	if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
		try {
			const result = await pushTransport.sendNotification(
				{
					endpoint: sub.endpoint,
					keys: {
						auth: sub.auth,
						p256dh: sub.p256dh,
					},
				},
				JSON.stringify(payload),
				{
					TTL: 86_400,
					timeout: 10_000,
					vapidDetails: {
						privateKey: env.VAPID_PRIVATE_KEY,
						publicKey: env.VAPID_PUBLIC_KEY,
						subject: env.VAPID_SUBJECT,
					},
				}
			);

			logInfo("PushSender:VAPID", "Dispatched Web Push", {
				endpointOrigin: new URL(sub.endpoint).origin,
				statusCode: result.statusCode,
			});

			return { simulated: false, statusCode: result.statusCode };
		} catch (error) {
			if (error instanceof WebPushError) {
				if (GONE_PUSH_STATUSES.has(error.statusCode)) {
					throw new PushDeliveryError(
						`Push subscription expired (${error.statusCode})`,
						{ cause: error, isGone: true, statusCode: error.statusCode }
					);
				}
				if (PERMANENT_PUSH_STATUSES.has(error.statusCode)) {
					throw new PushDeliveryError(
						`Push service rejected request (${error.statusCode})`,
						{ cause: error, isGone: false, statusCode: error.statusCode }
					);
				}
				throw new PushDeliveryError(
					`Push service transient error (${error.statusCode})`,
					{ cause: error, isGone: false, statusCode: error.statusCode }
				);
			}
			throw error;
		}
	}

	if (env.NODE_ENV === "production") {
		throw new UnrecoverableError("VAPID keys are not configured in production");
	}

	await Promise.resolve();
	logWarning("PushSender:Simulator", "Simulated Web Push dispatch (dev mode)", {
		endpointOrigin: new URL(sub.endpoint).origin,
		title: payload.title,
	});

	return { simulated: true, statusCode: 202 };
}
