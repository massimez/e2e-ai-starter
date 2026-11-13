"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	NotificationCategory,
	NotificationChannel,
} from "@workspace/api/queues";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { publicWebEnv } from "@/env";
import { client, parseApiResponse } from "./api-client";

export interface NotificationPreferenceRecord {
	category: NotificationCategory;
	channel: NotificationChannel;
	enabled: boolean;
	id: string;
	userId: string;
}

export type PushSupportState =
	| "checking"
	| "unsupported"
	| "unconfigured"
	| "ready";

const NOTIFICATION_PREFS_QUERY_KEY = ["notifications", "preferences"] as const;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding)
		.replaceAll("-", "+")
		.replaceAll("_", "/");
	const rawData = window.atob(base64);
	const output = new Uint8Array(new ArrayBuffer(rawData.length));
	for (const [index, char] of Array.from(rawData).entries()) {
		output[index] = char.charCodeAt(0);
	}
	return output;
}

async function getActiveSwRegistration(): Promise<ServiceWorkerRegistration | null> {
	const registrations = await navigator.serviceWorker.getRegistrations();
	const matched = registrations.find((reg) =>
		reg.active?.scriptURL.endsWith("/sw.js")
	);
	if (matched) {
		return matched;
	}
	return (await navigator.serviceWorker.getRegistration("/sw.js")) ?? null;
}

async function subscribeBrowserPush(vapidPublicKey: string): Promise<string> {
	const registration = await navigator.serviceWorker.register("/sw.js", {
		scope: "/",
	});
	await navigator.serviceWorker.ready;

	const existing = await registration.pushManager.getSubscription();
	const subscription =
		existing ??
		(await registration.pushManager.subscribe({
			applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
			userVisibleOnly: true,
		}));

	const subJson = subscription.toJSON();
	if (!(subJson.endpoint && subJson.keys?.auth && subJson.keys?.p256dh)) {
		throw new Error("Browser returned an incomplete push subscription");
	}

	const res = await client.api.notifications.push.subscribe.$post({
		json: {
			endpoint: subJson.endpoint,
			keys: {
				auth: subJson.keys.auth,
				p256dh: subJson.keys.p256dh,
			},
			userAgent: navigator.userAgent,
		},
	});
	await parseApiResponse(res);

	return subscription.endpoint;
}

async function unsubscribeBrowserPush(
	fallbackEndpoint: string | null
): Promise<void> {
	const registration = await getActiveSwRegistration();
	const subscription = await registration?.pushManager.getSubscription();
	const endpoint = subscription?.endpoint ?? fallbackEndpoint;

	if (endpoint) {
		const res = await client.api.notifications.push.unsubscribe.$delete({
			json: { endpoint },
		});
		await parseApiResponse(res);
	}

	if (subscription) {
		await subscription.unsubscribe();
	}
}

export function useNotificationPreferences() {
	const queryClient = useQueryClient();
	const [pendingKey, setPendingKey] = useState<string | null>(null);

	const query = useQuery({
		queryFn: async () => {
			const res = await client.api.notifications.preferences.$get();
			return parseApiResponse<NotificationPreferenceRecord[]>(res);
		},
		queryKey: NOTIFICATION_PREFS_QUERY_KEY,
	});

	const updateMutation = useMutation({
		mutationFn: async (input: {
			category: NotificationCategory;
			channel: NotificationChannel;
			enabled: boolean;
		}) => {
			const res = await client.api.notifications.preferences.$patch({
				json: input,
			});
			return parseApiResponse<NotificationPreferenceRecord>(res);
		},
		onError: (mutationError) => {
			toast.error(
				mutationError instanceof Error
					? mutationError.message
					: "Failed to update notification preference"
			);
		},
		onSettled: () => {
			setPendingKey(null);
		},
		onSuccess: (updatedPref) => {
			queryClient.setQueryData<NotificationPreferenceRecord[]>(
				NOTIFICATION_PREFS_QUERY_KEY,
				(current = []) => {
					const exists = current.some(
						(item) =>
							item.category === updatedPref.category &&
							item.channel === updatedPref.channel
					);
					if (!exists) {
						return [...current, updatedPref];
					}
					return current.map((item) =>
						item.category === updatedPref.category &&
						item.channel === updatedPref.channel
							? updatedPref
							: item
					);
				}
			);
		},
	});

	const togglePreference = (
		category: NotificationCategory,
		channel: NotificationChannel,
		nextEnabled: boolean
	) => {
		setPendingKey(`${category}:${channel}`);
		updateMutation.mutate({
			category,
			channel,
			enabled: nextEnabled,
		});
	};

	return {
		error: query.error,
		isError: query.isError,
		isLoading: query.isLoading,
		pendingKey,
		preferences: query.data ?? [],
		togglePreference,
	};
}

export function usePushNotifications() {
	const [pushSupport, setPushSupport] = useState<PushSupportState>("checking");
	const [permission, setPermission] =
		useState<NotificationPermission>("default");
	const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
	const [isPushBusy, setIsPushBusy] = useState(false);

	const refreshPushStatus = useCallback(async () => {
		const supportsPush =
			typeof window !== "undefined" &&
			"serviceWorker" in navigator &&
			"PushManager" in window &&
			"Notification" in window;

		if (!supportsPush) {
			setPushSupport("unsupported");
			return;
		}

		setPermission(Notification.permission);

		if (!publicWebEnv.vapidPublicKey) {
			setPushSupport("unconfigured");
			return;
		}

		try {
			const registration = await getActiveSwRegistration();
			const subscription = registration
				? await registration.pushManager.getSubscription()
				: null;
			setActiveEndpoint(subscription?.endpoint ?? null);
		} catch {
			setActiveEndpoint(null);
		} finally {
			setPushSupport("ready");
		}
	}, []);

	useEffect(() => {
		void refreshPushStatus();
	}, [refreshPushStatus]);

	const enablePush = async () => {
		if (!publicWebEnv.vapidPublicKey) {
			toast.error("VAPID public key is not configured for this environment");
			return;
		}

		try {
			setIsPushBusy(true);
			let currentPermission = Notification.permission;
			if (currentPermission === "default") {
				currentPermission = await Notification.requestPermission();
				setPermission(currentPermission);
			}

			if (currentPermission !== "granted") {
				toast.error(
					"Notification permission is required to enable browser push alerts"
				);
				return;
			}

			const endpoint = await subscribeBrowserPush(publicWebEnv.vapidPublicKey);
			setActiveEndpoint(endpoint);
			toast.success("Browser push notifications enabled for this device");
		} catch (pushError) {
			toast.error(
				pushError instanceof Error
					? pushError.message
					: "Failed to enable browser push notifications"
			);
		} finally {
			setIsPushBusy(false);
		}
	};

	const disablePush = async () => {
		try {
			setIsPushBusy(true);
			await unsubscribeBrowserPush(activeEndpoint);
			setActiveEndpoint(null);
			toast.success("Browser push notifications disabled for this device");
		} catch (pushError) {
			toast.error(
				pushError instanceof Error
					? pushError.message
					: "Failed to disable browser push notifications"
			);
		} finally {
			setIsPushBusy(false);
		}
	};

	return {
		activeEndpoint,
		disablePush,
		enablePush,
		isPushBusy,
		permission,
		pushSupport,
	};
}
