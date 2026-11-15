"use client";

import {
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	type NotificationCategory,
	type NotificationChannel,
} from "@workspace/api/queues";
import { Switch } from "@workspace/ui/components/switch";
import {
	AlertCircle,
	type Bell,
	Loader2,
	Mail,
	Monitor,
	Smartphone,
} from "lucide-react";
import type { NotificationPreferenceRecord } from "@/lib/notification-hooks";

const CATEGORY_METADATA: Record<
	NotificationCategory,
	{ description: string; label: string }
> = {
	billing: {
		description: "Invoices, usage thresholds, and subscription changes.",
		label: "Billing & Plan",
	},
	project: {
		description: "File uploads, processing jobs, and shared workspace items.",
		label: "Project & Storage",
	},
	security: {
		description: "Sign-in alerts, password resets, and permission updates.",
		label: "Security Alerts",
	},
	system: {
		description: "Service announcements, maintenance notices, and updates.",
		label: "System Updates",
	},
	team: {
		description: "Invitations, role changes, and membership updates.",
		label: "Team Activity",
	},
};

const CHANNEL_METADATA: Record<
	NotificationChannel,
	{ icon: typeof Bell; label: string }
> = {
	email: {
		icon: Mail,
		label: "Email",
	},
	in_app: {
		icon: Monitor,
		label: "In-App",
	},
	push: {
		icon: Smartphone,
		label: "Web Push",
	},
};

function getPreferenceEnabled(
	preferences: NotificationPreferenceRecord[],
	category: NotificationCategory,
	channel: NotificationChannel
): boolean {
	const match = preferences.find(
		(pref) => pref.category === category && pref.channel === channel
	);
	return match?.enabled ?? false;
}

export function PreferenceMatrixContent({
	error,
	isError,
	isLoading,
	onToggle,
	pendingKey,
	preferences,
}: {
	error: unknown;
	isError: boolean;
	isLoading: boolean;
	onToggle: (
		category: NotificationCategory,
		channel: NotificationChannel,
		nextEnabled: boolean
	) => void;
	pendingKey: string | null;
	preferences: NotificationPreferenceRecord[];
}) {
	if (isLoading) {
		return (
			<div className="flex h-40 items-center justify-center">
				<Loader2 className="text-primary h-6 w-6 animate-spin" />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2.5 rounded-xl border p-4 text-xs">
				<AlertCircle className="h-4 w-4 shrink-0" />
				<span>
					{error instanceof Error
						? error.message
						: "Failed to load notification preferences."}
				</span>
			</div>
		);
	}

	return (
		<div className="border-border/60 overflow-x-auto rounded-2xl border">
			<table className="w-full text-left text-sm">
				<thead>
					<tr className="border-border/60 bg-muted/20 border-b">
						<th className="px-6 py-3.5 text-xs font-semibold">
							Notification Category
						</th>
						{NOTIFICATION_CHANNELS.map((channel) => {
							const Icon = CHANNEL_METADATA[channel].icon;
							return (
								<th
									className="px-4 py-3.5 text-center text-xs font-semibold"
									key={channel}
								>
									<span className="inline-flex items-center gap-1.5">
										<Icon className="text-muted-foreground h-3.5 w-3.5" />
										{CHANNEL_METADATA[channel].label}
									</span>
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody className="divide-border/50 divide-y">
					{NOTIFICATION_CATEGORIES.map((category) => {
						const meta = CATEGORY_METADATA[category];
						return (
							<tr
								className="hover:bg-muted/10 transition-colors"
								key={category}
							>
								<td className="px-6 py-4">
									<p className="text-foreground font-medium">{meta.label}</p>
									<p className="text-muted-foreground text-xs">
										{meta.description}
									</p>
								</td>
								{NOTIFICATION_CHANNELS.map((channel) => {
									const enabled = getPreferenceEnabled(
										preferences,
										category,
										channel
									);
									const cellKey = `${category}:${channel}`;
									const isCellPending = pendingKey === cellKey;
									return (
										<td className="px-4 py-4 text-center" key={channel}>
											<div className="flex justify-center">
												<Switch
													aria-label={`${meta.label} via ${CHANNEL_METADATA[channel].label}`}
													checked={enabled}
													disabled={isCellPending}
													onCheckedChange={(checked) =>
														onToggle(category, channel, checked)
													}
												/>
											</div>
										</td>
									);
								})}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
