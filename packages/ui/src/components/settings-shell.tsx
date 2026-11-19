import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

interface SettingsPageProps {
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	description: string;
	headingLevel?: "h1" | "h2";
	title: string;
	titleAccessory?: ReactNode;
}

export function SettingsPage({
	title,
	description,
	children,
	action,
	className,
	headingLevel = "h1",
	titleAccessory,
}: SettingsPageProps) {
	const HeadingTag = headingLevel;

	return (
		<div className={cn("flex w-full min-w-full flex-col gap-6", className)}>
			{/* Hero Settings Banner with Ambient Glow */}
			<div className="border-border/70 bg-card/70 relative overflow-hidden rounded-2xl border p-6 shadow-xs backdrop-blur-md sm:p-8">
				<div className="from-primary/10 via-primary/5 dark:from-primary/15 pointer-events-none absolute inset-0 bg-linear-to-r to-transparent" />
				<div className="bg-primary/10 pointer-events-none absolute -top-12 -right-12 h-44 w-44 rounded-full blur-3xl" />
				<div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div className="min-w-0 space-y-1.5">
						<div className="flex flex-wrap items-center gap-2.5">
							<HeadingTag className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
								{title}
							</HeadingTag>
							{titleAccessory}
						</div>
						<p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
							{description}
						</p>
					</div>
					{action ? (
						<div className="flex shrink-0 items-center gap-2.5">{action}</div>
					) : null}
				</div>
			</div>

			{children}
		</div>
	);
}

interface SettingsSectionProps {
	children: ReactNode;
	className?: string;
	id?: string;
}

export function SettingsSection({
	children,
	className,
	id,
}: SettingsSectionProps) {
	return (
		<section
			className={cn(
				"border-border/60 bg-card/70 hover:border-border/80 overflow-hidden rounded-2xl border shadow-xs backdrop-blur-xs transition-all duration-200",
				className
			)}
			id={id}
		>
			{children}
		</section>
	);
}

interface SettingsSectionHeaderProps {
	action?: ReactNode;
	className?: string;
	description?: string;
	title?: string;
}

export function SettingsSectionHeader({
	title,
	description,
	action,
	className,
}: SettingsSectionHeaderProps) {
	return (
		<div
			className={cn(
				"border-border/60 bg-muted/20 flex flex-col gap-3 border-b px-6 py-4.5 sm:flex-row sm:items-center sm:justify-between",
				className
			)}
		>
			<div className="space-y-1">
				{title ? (
					<h2 className="text-foreground text-base font-semibold tracking-tight">
						{title}
					</h2>
				) : null}
				{description ? (
					<p className="text-muted-foreground max-w-2xl text-xs leading-relaxed sm:text-sm">
						{description}
					</p>
				) : null}
			</div>
			{action ? <div className="flex items-center gap-2">{action}</div> : null}
		</div>
	);
}

interface SettingsSectionContentProps {
	children: ReactNode;
	className?: string;
}

export function SettingsSectionContent({
	children,
	className,
}: SettingsSectionContentProps) {
	return <div className={cn("p-6 sm:p-7", className)}>{children}</div>;
}
