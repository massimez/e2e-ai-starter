import { APP_CONFIG } from "@workspace/shared/config";
import { GitHubIcon } from "@workspace/ui/components/icons/brands";

export function SiteFooter() {
	return (
		<footer className="border-border/70 text-muted-foreground w-full border-t">
			<div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
				<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
					<span className="text-foreground font-medium">{APP_CONFIG.name}</span>
					<span>
						Next.js 16, Hono, Better Auth, Drizzle ORM, Mastra AI, pgvector,
						S3/R2, and BullMQ.
					</span>
				</div>

				<nav aria-label="Footer" className="flex items-center gap-4">
					<a
						className="hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-sm font-mono transition-colors focus-visible:ring-2 focus-visible:outline-none"
						href="/api/health/ready"
					>
						/api/health/ready
					</a>
					<a
						aria-label="GitHub (opens in a new tab)"
						className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-9 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
						href="https://github.com"
						rel="noopener noreferrer"
						target="_blank"
					>
						<GitHubIcon aria-hidden="true" className="size-4" />
					</a>
				</nav>
			</div>
		</footer>
	);
}
