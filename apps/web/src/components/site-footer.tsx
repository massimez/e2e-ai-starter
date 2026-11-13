import { APP_CONFIG } from "@workspace/api/config";

export function SiteFooter() {
	return (
		<footer className="border-border/70 text-muted-foreground w-full border-t">
			<div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
				<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
					<span className="text-foreground font-medium">{APP_CONFIG.name}</span>
					<span>
						Next.js 16, Hono, Better Auth, Drizzle ORM, S3/R2, and BullMQ.
					</span>
				</div>

				<nav aria-label="Footer" className="flex flex-wrap items-center gap-5">
					<a
						className="hover:text-foreground font-mono transition-colors"
						href="/api/health/ready"
					>
						/api/health/ready
					</a>
				</nav>
			</div>
		</footer>
	);
}
