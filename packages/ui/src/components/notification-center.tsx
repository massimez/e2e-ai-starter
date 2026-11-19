"use client";

import {
	AlertCircle,
	Bell,
	Check,
	CheckCheck,
	ExternalLink,
	Inbox,
	Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeInternalRedirect, sanitizeSameOriginPath } from "../lib/utils";
import { Badge } from "./badge";
import { Button } from "./button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./dropdown-menu";

export interface NotificationItem {
	body?: string;
	category: "billing" | "project" | "security" | "system" | "team";
	content?: string;
	createdAt: string;
	data?: Record<string, unknown> | null;
	id: string;
	isRead: boolean;
	link?: string | null;
	title: string;
}

export interface NotificationCenterProps {
	apiUrl?: string;
	enabled?: boolean;
	onNavigate?: (path: string) => void;
}

function getNotificationBody(item: NotificationItem): string {
	return item.body ?? item.content ?? "";
}

function getNotificationLink(item: NotificationItem): string | null {
	const rawLink =
		item.link ??
		(item.data && typeof item.data.link === "string" ? item.data.link : null);
	return sanitizeSameOriginPath(rawLink);
}

export function NotificationCenter({
	apiUrl = "",
	enabled = true,
	onNavigate,
}: NotificationCenterProps) {
	const [unreadCount, setUnreadCount] = useState<number>(0);
	const [notifications, setNotifications] = useState<NotificationItem[]>([]);
	const [isLoading, setIsLoading] = useState<boolean>(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isOpen, setIsOpen] = useState<boolean>(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const isAuthBlockedRef = useRef<boolean>(false);
	const markingReadIdsRef = useRef<Set<string>>(new Set());

	const navigateTo = useCallback(
		(path: string) => {
			setIsOpen(false);
			const internalPath = sanitizeInternalRedirect(path);
			if (onNavigate && internalPath) {
				onNavigate(internalPath);
				return;
			}
			window.location.assign(path);
		},
		[onNavigate]
	);

	const fetchUnreadCount = useCallback(
		async (signal?: AbortSignal) => {
			if (!enabled || isAuthBlockedRef.current) {
				return;
			}
			if (
				typeof document !== "undefined" &&
				document.visibilityState === "hidden"
			) {
				return;
			}
			try {
				const res = await fetch(`${apiUrl}/api/notifications/unread-count`, {
					credentials: "include",
					signal,
				});
				if (res.status === 401 || res.status === 403) {
					isAuthBlockedRef.current = true;
					setUnreadCount(0);
					return;
				}
				if (res.ok) {
					isAuthBlockedRef.current = false;
					const json = (await res.json()) as {
						data: { unreadCount: number };
						success: boolean;
					};
					if (json.success) {
						setUnreadCount(json.data.unreadCount);
					}
				}
			} catch {
				// Ignore offline, unauthenticated, or aborted polling ticks
			}
		},
		[apiUrl, enabled]
	);

	const fetchNotifications = useCallback(async () => {
		if (!enabled) {
			return;
		}
		abortControllerRef.current?.abort();
		const controller = new AbortController();
		abortControllerRef.current = controller;

		setIsLoading(true);
		setErrorMessage(null);
		try {
			const res = await fetch(`${apiUrl}/api/notifications?limit=10`, {
				credentials: "include",
				signal: controller.signal,
			});
			if (!res.ok) {
				setErrorMessage("Unable to load notifications.");
				return;
			}
			const json = (await res.json()) as {
				data: { items: NotificationItem[] };
				success: boolean;
			};
			if (json.success) {
				isAuthBlockedRef.current = false;
				setNotifications(json.data.items);
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				return;
			}
			setErrorMessage("Unable to load notifications.");
		} finally {
			if (abortControllerRef.current === controller) {
				abortControllerRef.current = null;
				setIsLoading(false);
			}
		}
	}, [apiUrl, enabled]);

	useEffect(() => {
		if (!enabled) {
			setUnreadCount(0);
			setNotifications([]);
			return;
		}
		isAuthBlockedRef.current = false;
		const controller = new AbortController();
		void fetchUnreadCount(controller.signal);

		const interval = setInterval(() => {
			void fetchUnreadCount(controller.signal);
		}, 30_000);

		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void fetchUnreadCount(controller.signal);
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			controller.abort();
			abortControllerRef.current?.abort();
		};
	}, [enabled, fetchUnreadCount]);

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open);
		if (open) {
			void fetchNotifications();
		}
	};

	const handleMarkAsRead = async (id: string) => {
		if (markingReadIdsRef.current.has(id)) {
			return;
		}
		markingReadIdsRef.current.add(id);
		try {
			const res = await fetch(`${apiUrl}/api/notifications/${id}/read`, {
				credentials: "include",
				keepalive: true,
				method: "PATCH",
			});
			if (!res.ok) {
				setErrorMessage("Failed to mark notification as read.");
				return;
			}
			let decremented = false;
			setNotifications((prev) =>
				prev.map((n) => {
					if (n.id === id && !n.isRead) {
						decremented = true;
						return { ...n, isRead: true };
					}
					return n;
				})
			);
			if (decremented) {
				setUnreadCount((c) => Math.max(0, c - 1));
			}
		} catch {
			setErrorMessage("Failed to mark notification as read.");
		} finally {
			markingReadIdsRef.current.delete(id);
		}
	};

	const handleMarkAllAsRead = async () => {
		try {
			const res = await fetch(`${apiUrl}/api/notifications/read-all`, {
				credentials: "include",
				method: "PATCH",
			});
			if (!res.ok) {
				setErrorMessage("Failed to mark all notifications as read.");
				return;
			}
			setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
			setUnreadCount(0);
		} catch {
			setErrorMessage("Failed to mark all notifications as read.");
		}
	};

	const getCategoryBadgeVariant = (
		category: NotificationItem["category"]
	): "destructive" | "outline" | "primary" | "secondary" => {
		switch (category) {
			case "security":
				return "destructive";
			case "billing":
				return "secondary";
			case "team":
			case "project":
				return "primary";
			default:
				return "outline";
		}
	};

	const renderContent = () => {
		if (isLoading && notifications.length === 0) {
			return (
				<div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
					<Loader2 className="text-primary mr-2 h-4 w-4 animate-spin" />
					Loading notifications...
				</div>
			);
		}

		if (errorMessage && notifications.length === 0) {
			return (
				<div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-8 text-center">
					<AlertCircle className="text-destructive h-6 w-6" />
					<p className="text-xs font-medium">{errorMessage}</p>
					<Button
						onClick={() => void fetchNotifications()}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			);
		}

		if (notifications.length === 0) {
			return (
				<div className="text-muted-foreground flex flex-col items-center justify-center py-8 text-center">
					<Inbox className="text-muted-foreground/50 mb-2 h-8 w-8" />
					<p className="text-sm font-medium">All caught up!</p>
					<p className="text-xs">No notifications to display</p>
				</div>
			);
		}

		return notifications.map((n) => {
			const safeLink = getNotificationLink(n);
			const bodyText = getNotificationBody(n);

			return (
				<div
					className={`hover:bg-muted/50 flex items-start gap-2 p-3 transition-colors ${
						n.isRead ? "" : "bg-muted/20"
					}`}
					key={n.id}
				>
					<button
						className="focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-hidden"
						onClick={() => {
							if (!n.isRead) {
								void handleMarkAsRead(n.id);
							}
							if (safeLink) {
								navigateTo(safeLink);
							}
						}}
						type="button"
					>
						<div className="flex w-full items-center gap-1.5">
							<Badge
								className="h-4 px-1.5 text-[10px] font-medium tracking-wide uppercase"
								variant={getCategoryBadgeVariant(n.category)}
							>
								{n.category}
							</Badge>
							<span
								className={`truncate text-sm leading-none font-medium ${
									n.isRead ? "" : "text-foreground font-semibold"
								}`}
							>
								{n.title}
							</span>
						</div>

						{bodyText ? (
							<p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
								{bodyText}
							</p>
						) : null}

						{safeLink ? (
							<span className="text-primary inline-flex items-center text-[11px] hover:underline">
								View details <ExternalLink className="ml-1 h-2.5 w-2.5" />
							</span>
						) : null}
					</button>

					{!n.isRead && (
						<Button
							aria-label="Mark as read"
							className="text-muted-foreground hover:text-foreground size-8 shrink-0 p-0"
							onClick={() => void handleMarkAsRead(n.id)}
							size="sm"
							type="button"
							variant="ghost"
						>
							<Check className="h-3.5 w-3.5" />
						</Button>
					)}
				</div>
			);
		});
	};

	return (
		<DropdownMenu onOpenChange={handleOpenChange} open={isOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Open notifications"
					className="relative h-9 w-9 rounded-lg"
					size="sm"
					type="button"
					variant="ghost"
				>
					<Bell className="h-4 w-4" />
					{unreadCount > 0 ? (
						<span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold">
							{unreadCount > 9 ? "9+" : String(unreadCount)}
						</span>
					) : null}
				</Button>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				align="end"
				className="w-80 rounded-xl p-0 sm:w-96"
				sideOffset={8}
			>
				<div className="flex items-center justify-between border-b px-4 py-3">
					<DropdownMenuLabel className="p-0 text-sm font-semibold">
						Notifications
					</DropdownMenuLabel>
					{unreadCount > 0 && (
						<Button
							className="text-muted-foreground hover:text-foreground h-auto p-0 text-xs"
							onClick={() => void handleMarkAllAsRead()}
							type="button"
							variant="ghost"
						>
							<CheckCheck className="mr-1 h-3.5 w-3.5" />
							Mark all as read
						</Button>
					)}
				</div>

				{errorMessage && notifications.length > 0 ? (
					<div
						className="bg-destructive/10 text-destructive border-b px-4 py-1.5 text-xs"
						role="alert"
					>
						{errorMessage}
					</div>
				) : null}

				<div className="max-h-80 divide-y overflow-y-auto overscroll-contain">
					{renderContent()}
				</div>

				<DropdownMenuSeparator className="m-0" />
				<div className="p-2 text-center">
					<Button
						className="w-full text-xs"
						onClick={() => navigateTo("/dashboard/settings/notifications")}
						size="sm"
						type="button"
						variant="ghost"
					>
						View notification settings
					</Button>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
