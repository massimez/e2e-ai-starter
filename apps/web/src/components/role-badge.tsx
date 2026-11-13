import type { OrganizationRoleName } from "@workspace/api/permissions";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { Crown, Eye, Shield, User } from "lucide-react";

export interface RoleDisplayMeta {
	badgeClass: string;
	borderClass: string;
	description: string;
	icon: typeof Crown;
	key: OrganizationRoleName;
	name: string;
	powerTag: string;
}

export const ROLE_DISPLAY_LIST: readonly RoleDisplayMeta[] = [
	{
		badgeClass:
			"border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
		borderClass: "hover:border-amber-500/40",
		description:
			"Full administrative authority over workspace billing, ownership, and deletion.",
		icon: Crown,
		key: "owner",
		name: "Owner",
		powerTag: "Full Authority",
	},
	{
		badgeClass:
			"border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
		borderClass: "hover:border-blue-500/40",
		description:
			"Manages team members, invitations, projects, storage, and workspace profile.",
		icon: Shield,
		key: "admin",
		name: "Admin",
		powerTag: "Manager",
	},
	{
		badgeClass:
			"border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
		borderClass: "hover:border-emerald-500/40",
		description:
			"Standard collaborator who can create and modify projects and upload storage assets.",
		icon: User,
		key: "member",
		name: "Member",
		powerTag: "Contributor",
	},
	{
		badgeClass: "border-muted-foreground/20 bg-muted/60 text-muted-foreground",
		borderClass: "hover:border-border",
		description:
			"Read-only access across workspace documents, projects, and notifications.",
		icon: Eye,
		key: "viewer",
		name: "Viewer",
		powerTag: "Auditor",
	},
] as const;

const ROLE_META_BY_KEY = new Map<string, RoleDisplayMeta>(
	ROLE_DISPLAY_LIST.map((role) => [role.key, role])
);

export function RoleBadge({
	className,
	role,
}: {
	className?: string;
	role: string;
}) {
	const meta = ROLE_META_BY_KEY.get(role) ?? ROLE_META_BY_KEY.get("viewer");
	if (!meta) {
		return (
			<Badge className={className} variant="outline">
				{role}
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
			{meta.name}
		</Badge>
	);
}
