"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import {
	AlertCircle,
	Bell,
	BellOff,
	CheckCircle2,
	Loader2,
} from "lucide-react";
import {
	type PushSupportState,
	usePushNotifications,
} from "@/lib/notification-hooks";

function PushStatusBadge({
	activeEndpoint,
	pushSupport,
}: {
	activeEndpoint: string | null;
	pushSupport: PushSupportState;
}) {
	if (pushSupport !== "ready") {
		return null;
	}
	if (activeEndpoint) {
		return (
			<Badge
				className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
				variant="outline"
			>
				<CheckCircle2 className="h-3 w-3" /> Active on Device
			</Badge>
		);
	}
	return (
		<Badge className="gap-1" variant="secondary">
			<BellOff className="h-3 w-3" /> Not Subscribed
		</Badge>
	);
}

function StatusBanner({ message }: { message: string }) {
	return (
		<div className="border-border/60 bg-muted/20 text-muted-foreground flex items-center gap-2.5 rounded-xl border p-4 text-xs">
			<AlertCircle className="h-4 w-4 shrink-0" />
			<span>{message}</span>
		</div>
	);
}

export function PushSettingsSection() {
	const {
		activeEndpoint,
		disablePush,
		enablePush,
		isPushBusy,
		permission,
		pushSupport,
	} = usePushNotifications();

	return (
		<SettingsSection>
			<SettingsSectionHeader
				action={
					<PushStatusBadge
						activeEndpoint={activeEndpoint}
						pushSupport={pushSupport}
					/>
				}
				description="Register this browser with the workspace service worker to receive real-time Web Push alerts."
				title="Browser Push Delivery"
			/>
			<SettingsSectionContent className="space-y-4">
				{pushSupport === "checking" ? (
					<div className="text-muted-foreground flex items-center gap-2 text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Checking browser push capabilities...
					</div>
				) : null}

				{pushSupport === "unsupported" ? (
					<StatusBanner message="This browser or context does not support Service Workers and the Web Push API." />
				) : null}

				{pushSupport === "unconfigured" ? (
					<StatusBanner message="Web Push delivery is unavailable on this deployment because VAPID keys are not configured." />
				) : null}

				{pushSupport === "ready" ? (
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-1">
							<p className="text-foreground text-sm font-semibold">
								{activeEndpoint
									? "Desktop & Browser Push Active"
									: "Enable Real-Time Push Alerts"}
							</p>
							<p className="text-muted-foreground max-w-xl text-xs leading-relaxed">
								{permission === "denied"
									? "Notifications are blocked in your browser permissions. Allow notifications for this site in browser settings to subscribe."
									: "Delivered through /sw.js only for categories with Web Push enabled below."}
							</p>
						</div>

						{activeEndpoint ? (
							<Button
								disabled={isPushBusy}
								onClick={disablePush}
								size="sm"
								type="button"
								variant="outline"
							>
								{isPushBusy ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<BellOff className="mr-2 h-4 w-4" />
								)}
								Disable on This Device
							</Button>
						) : (
							<Button
								disabled={isPushBusy || permission === "denied"}
								onClick={enablePush}
								size="sm"
								type="button"
								variant="primary"
							>
								{isPushBusy ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Bell className="mr-2 h-4 w-4" />
								)}
								Enable Push Notifications
							</Button>
						)}
					</div>
				) : null}
			</SettingsSectionContent>
		</SettingsSection>
	);
}
