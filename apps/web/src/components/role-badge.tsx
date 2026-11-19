import type { OrganizationRoleName } from "@workspace/shared/permissions";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { Crown, Eye, Shield, Sparkles, User } from "lucide-react";

const ROLE_SLUG_SEPARATOR_REGEX = /[-_]+/u;

interface RoleDisplayMeta {
	badgeClass: string;
	icon: typeof Crown;
	key: OrganizationRoleName;
	name: string;
}

const ROLE_DISPLAY_LIST: readonly RoleDisplayMeta[] = [
	{
		badgeClass:
			"border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
		icon: Crown,
		key: "owner",
		name: "Owner",
	},
	{
		badgeClass:
			"border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
		icon: Shield,
		key: "admin",
		name: "Admin",
	},
	{
		badgeClass:
			"border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
		icon: User,
		key: "member",
		name: "Member",
	},
	{
		badgeClass: "border-muted-foreground/20 bg-muted/60 text-muted-foreground",
		icon: Eye,
		key: "viewer",
		name: "Viewer",
	},
] as const;

const ROLE_META_BY_KEY = new Map<string, RoleDisplayMeta>(
	ROLE_DISPLAY_LIST.map((role) => [role.key, role])
);

function formatRoleLabel(roleSlug: string, label?: string): string {
	if (label?.trim()) {
		return label.trim();
	}
	const known = ROLE_META_BY_KEY.get(roleSlug);
	if (known) {
		return known.name;
	}
	return roleSlug
		.split(ROLE_SLUG_SEPARATOR_REGEX)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

export function RoleBadge({
	className,
	label,
	role,
}: {
	className?: string;
	label?: string;
	role: string;
}) {
	const meta = ROLE_META_BY_KEY.get(role);
	if (!meta) {
		return (
			<Badge
				className={cn(
					"gap-1.5 border-indigo-500/20 bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-400",
					className
				)}
				variant="outline"
			>
				<Sparkles className="h-3 w-3" />
				{formatRoleLabel(role, label)}
			</Badge>
		);
	}
	const Icon = meta.icon;
	return (
		<Badge
			className={cn("gap-1.5 font-medium", meta.badgeClass, className)}
			variant="outline"
		>
			<Icon className="h-3 w-3" />
			{label?.trim() || meta.name}
		</Badge>
	);
}
