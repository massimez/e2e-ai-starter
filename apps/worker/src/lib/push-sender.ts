import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { Agent as HttpsAgent } from "node:https";
import {
	isBlockedIpAddress,
	validatePushEndpointUrl,
} from "@workspace/api/queues";
import { UnrecoverableError } from "bullmq";
import { sendNotification, WebPushError } from "web-push";
import { env } from "../env";
import { logInfo, logWarning } from "./logger";

export const pushTransport = {
	lookup: (hostname: string): Promise<LookupAddress[]> =>
		lookup(hostname, { all: true, verbatim: true }),
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

async function resolveSafePushAddresses(
	endpoint: string
): Promise<{ addresses: LookupAddress[]; url: URL }> {
	const validation = validatePushEndpointUrl(endpoint);
	if (!validation.ok) {
		throw new PushDeliveryError(validation.reason, {
			isGone: true,
			statusCode: 400,
		});
	}

	let addresses: LookupAddress[];
	try {
		addresses = await pushTransport.lookup(validation.url.hostname);
	} catch (error) {
		throw new PushDeliveryError("Push endpoint DNS resolution failed", {
			cause: error,
			isGone: false,
			statusCode: 503,
		});
	}

	if (
		addresses.length === 0 ||
		addresses.some((entry) => isBlockedIpAddress(entry.address))
	) {
		throw new PushDeliveryError(
			"Push endpoint resolved to a restricted network address",
			{
				isGone: true,
				statusCode: 400,
			}
		);
	}

	return { addresses, url: validation.url };
}

function createPinnedPushAgent(addresses: LookupAddress[]): HttpsAgent {
	const [primary] = addresses;
	return new HttpsAgent({
		keepAlive: false,
		lookup: (_hostname, options, callback) => {
			if (!primary) {
				callback(new Error("No validated public IP for push endpoint"), "", 4);
				return;
			}
			const wantAll =
				typeof options === "object" && options !== null && options.all === true;
			if (wantAll) {
				callback(
					null,
					addresses as unknown as string,
					undefined as unknown as number
				);
				return;
			}
			callback(null, primary.address, primary.family);
		},
	});
}

export async function sendWebPush(
	sub: PushSubscriptionTarget,
	payload: PushMessagePayload
): Promise<{ simulated: boolean; statusCode: number }> {
	const { addresses, url } = await resolveSafePushAddresses(sub.endpoint);

	if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
		const pinnedAgent = createPinnedPushAgent(addresses);
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
					agent: pinnedAgent,
					timeout: 10_000,
					vapidDetails: {
						privateKey: env.VAPID_PRIVATE_KEY,
						publicKey: env.VAPID_PUBLIC_KEY,
						subject: env.VAPID_SUBJECT,
					},
				}
			);

			logInfo("PushSender:VAPID", "Dispatched Web Push", {
				endpointOrigin: url.origin,
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
		} finally {
			pinnedAgent.destroy();
		}
	}

	if (env.NODE_ENV === "production") {
		throw new UnrecoverableError("VAPID keys are not configured in production");
	}

	await Promise.resolve();
	logWarning("PushSender:Simulator", "Simulated Web Push dispatch (dev mode)", {
		endpointOrigin: url.origin,
		title: payload.title,
	});

	return { simulated: true, statusCode: 202 };
}
