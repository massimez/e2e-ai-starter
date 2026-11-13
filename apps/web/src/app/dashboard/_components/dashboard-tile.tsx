import { cn } from "@workspace/ui/lib/utils";
import { ArrowRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export interface DashboardTileProps {
	badge?: string;
	className?: string;
	description: string;
	href?: string;
	icon: LucideIcon;
	title: string;
	trailing?: ReactNode;
}

function TileTrailing({
	badge,
	trailing,
	hasHref,
}: {
	badge?: string;
	hasHref: boolean;
	trailing?: ReactNode;
}) {
	if (badge) {
		return (
			<span className="border-primary/20 bg-primary/10 text-primary inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium">
				{badge}
			</span>
		);
	}

	if (trailing) {
		return <>{trailing}</>;
	}

	if (hasHref) {
		return (
			<div className="text-muted-foreground group-hover:text-primary flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 group-hover:translate-x-0.5">
				<ArrowRight className="h-4 w-4" />
			</div>
		);
	}

	return null;
}

export function DashboardTile({
	title,
	description,
	icon: Icon,
	href,
	badge,
	trailing,
	className,
}: DashboardTileProps) {
	const content = (
		<>
			{href ? (
				<div className="from-primary/10 via-primary/5 pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
			) : null}
			<div className="relative flex flex-1 flex-col justify-between gap-4">
				<div className="flex items-start justify-between gap-3">
					<div
						className={cn(
							"border-border/60 bg-background/80 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-xs transition-all duration-300",
							href &&
								"group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary group-hover:scale-105"
						)}
					>
						<Icon className="h-5 w-5" />
					</div>

					<TileTrailing
						badge={badge}
						hasHref={Boolean(href)}
						trailing={trailing}
					/>
				</div>

				<div className="space-y-1">
					<h3 className="text-foreground group-hover:text-primary text-base font-semibold tracking-tight transition-colors">
						{title}
					</h3>
					<p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
						{description}
					</p>
				</div>
			</div>
		</>
	);

	if (href) {
		return (
			<Link
				className={cn(
					"group border-border/60 bg-card/60 hover:border-primary/30 hover:bg-card relative flex flex-col overflow-hidden rounded-2xl border p-5 shadow-xs backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
					className
				)}
				href={href}
			>
				{content}
			</Link>
		);
	}

	return (
		<div
			className={cn(
				"border-border/60 bg-card/50 relative flex flex-col rounded-2xl border p-5 shadow-xs backdrop-blur-xs",
				className
			)}
		>
			{content}
		</div>
	);
}
