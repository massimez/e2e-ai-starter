import { APP_CONFIG } from "@workspace/shared/config";
import { formatBytes, STORAGE_CONFIG } from "@workspace/shared/storage";
import type { Metadata } from "next";
import Link from "next/link";
import { HeroWorkspaceCta } from "@/components/hero-workspace-cta";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const HOME_TITLE = `${APP_CONFIG.name}: ${APP_CONFIG.tagline}`;
const HOME_DESCRIPTION = APP_CONFIG.description;

export const metadata: Metadata = {
	alternates: {
		canonical: "/",
	},
	description: HOME_DESCRIPTION,
	keywords: [...APP_CONFIG.keywords],
	openGraph: {
		description: HOME_DESCRIPTION,
		title: HOME_TITLE,
		type: "website",
		url: "/",
	},
	title: {
		absolute: HOME_TITLE,
	},
	twitter: {
		card: "summary_large_image",
		description: HOME_DESCRIPTION,
		title: HOME_TITLE,
	},
};

const HIGHLIGHTS = [
	{
		contract: "Better Auth + Organizations",
		detail:
			"Email OTP, password + Google OAuth, multi-tenant sessions, and dynamic RBAC built in.",
		href: "/settings/workspace/members",
		title: "Multi-Tenant Auth",
	},
	{
		contract: "@workspace/ai-core + pgvector",
		detail:
			"Provider-agnostic Mastra agents with streaming SSE chat and tenant-scoped workspace tools.",
		href: "/dashboard/ai",
		title: "Streaming AI Workspace",
	},
	{
		contract: "@workspace/api/hc",
		detail:
			"End-to-end typed Hono RPC behind a streaming Next.js Route Handler proxy with Redis rate limits.",
		href: "/api/health/ready",
		title: "Typed Hono API",
	},
	{
		contract: `S3 / R2 (${formatBytes(STORAGE_CONFIG.MAX_FILE_SIZE, 0)} max)`,
		detail:
			"Presigned S3/MinIO uploads with row-locked quotas, private file streaming, and BullMQ jobs.",
		href: "/settings/workspace/notifications",
		title: "Storage & Background Jobs",
	},
] as const;

export default function HomePage() {
	return (
		<div className="bg-background flex min-h-screen flex-col">
			<SiteHeader />

			<main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16 sm:px-6 sm:py-24">
				<section className="max-w-3xl space-y-6">
					<p className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
						Fullstack AI Monorepo Starter
					</p>
					<h1 className="text-foreground text-4xl font-semibold tracking-tight sm:text-5xl">
						{APP_CONFIG.tagline}
					</h1>
					<p className="text-muted-foreground text-base leading-relaxed sm:text-lg">
						{APP_CONFIG.description}
					</p>
					<div className="flex flex-wrap items-center gap-3 pt-2">
						<HeroWorkspaceCta />
						<Link
							className="border-border hover:bg-muted text-foreground inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium transition-colors"
							href="/dashboard/ai"
						>
							Open AI Workspace
						</Link>
					</div>
				</section>

				<section className="border-border/70 bg-border/70 mt-16 grid gap-px overflow-hidden rounded-xl border md:grid-cols-2">
					{HIGHLIGHTS.map((item) => (
						<Link
							className="bg-card hover:bg-muted/30 flex flex-col justify-between gap-3 p-6 transition-colors"
							href={item.href}
							key={item.title}
						>
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<h2 className="text-foreground text-base font-semibold">
									{item.title}
								</h2>
								<code className="text-muted-foreground font-mono text-xs">
									{item.contract}
								</code>
							</div>
							<p className="text-muted-foreground text-sm leading-relaxed">
								{item.detail}
							</p>
						</Link>
					))}
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
