"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	FolderOpen,
	LayoutDashboard,
	LogOut,
	Settings,
	Sparkles,
	User,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { signOut } from "@/lib/auth-client";

export interface AccountMenuUser {
	email?: string | null;
	image?: string | null;
	name?: string | null;
}

interface UserAccountMenuProps {
	redirectAfterSignOut?: string;
	role?: string | null;
	user?: AccountMenuUser | null;
}

/** Shared profile dropdown rendered in both landing and dashboard headers. */
export function UserAccountMenu({
	redirectAfterSignOut,
	role,
	user,
}: UserAccountMenuProps) {
	const router = useRouter();

	const handleSignOut = async () => {
		const res = await signOut();
		if (res.error) {
			toast.error(res.error.message || "Failed to sign out");
			return;
		}
		if (redirectAfterSignOut) {
			router.push(redirectAfterSignOut);
		}
		router.refresh();
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					aria-label="Account menu"
					className="group border-border/60 bg-muted/40 hover:border-primary/40 focus-visible:ring-ring relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border p-0 shadow-xs transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:outline-hidden"
					type="button"
				>
					<Avatar className="h-full w-full">
						{user?.image ? (
							<AvatarImage alt={user.name || "User avatar"} src={user.image} />
						) : null}
						<AvatarFallback className="from-primary/15 to-primary/5 text-primary bg-linear-to-br text-xs font-bold">
							{user?.name ? (
								user.name.charAt(0).toUpperCase()
							) : (
								<User className="h-4 w-4" />
							)}
						</AvatarFallback>
					</Avatar>
					<span className="border-background absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 bg-emerald-500 ring-1 ring-emerald-500/20" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-60 rounded-xl p-1.5 shadow-lg backdrop-blur-md"
			>
				<DropdownMenuLabel className="p-2">
					<div className="flex items-center justify-between gap-2">
						<div className="truncate text-sm font-semibold">
							{user?.name || "User Account"}
						</div>
						{role ? (
							<Badge
								className="bg-primary/10 text-primary shrink-0 text-[10px] capitalize"
								variant="outline"
							>
								{role}
							</Badge>
						) : null}
					</div>
					{user?.email ? (
						<div className="text-muted-foreground truncate text-xs font-normal">
							{user.email}
						</div>
					) : null}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />

				<DropdownMenuItem asChild>
					<Link
						className="flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-sm"
						href="/dashboard"
					>
						<LayoutDashboard className="text-muted-foreground h-4 w-4" />
						Dashboard
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link
						className="flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-sm"
						href="/dashboard/files"
					>
						<FolderOpen className="text-muted-foreground h-4 w-4" />
						Files & Knowledge
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link
						className="flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-sm"
						href="/dashboard/ai"
					>
						<Sparkles className="text-muted-foreground h-4 w-4" />
						AI Assistant
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild>
					<Link
						className="flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-sm"
						href="/dashboard/settings"
					>
						<Settings className="text-muted-foreground h-4 w-4" />
						Workspace Settings
					</Link>
				</DropdownMenuItem>

				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2.5 rounded-lg p-2 text-sm"
					onClick={() => void handleSignOut()}
				>
					<LogOut className="h-4 w-4" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
