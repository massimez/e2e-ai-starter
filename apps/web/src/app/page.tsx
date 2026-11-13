import { APP_CONFIG } from "@workspace/api/config";
import {
	PERMISSION_MATRIX,
	type PermissionMatrixEntry,
} from "@workspace/api/permissions";
import {
	EMAIL_QUEUE_NAME,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	NOTIFICATION_QUEUE_NAME,
} from "@workspace/api/queues";
import { formatBytes, STORAGE_CONFIG } from "@workspace/api/storage";
import { Button } from "@workspace/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { ArrowDown, Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import { CopyButton } from "@/components/copy-button";
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

const WORKSPACE_ROWS = [
	{
		name: "apps/web",
		runtime: "Next.js 16 (:3000)",
		summary:
			"App Router frontend, /api/* rewrites to Hono, proxy session checks, and typed RPC client.",
	},
	{
		name: "apps/api",
		runtime: "Hono on Bun (:3001)",
		summary:
			"Better Auth handlers, RBAC middleware, presigned S3/R2 storage routes, and queue producers.",
	},
	{
		name: "apps/worker",
		runtime: "BullMQ (:3002)",
		summary:
			"Background processor for transactional emails, in-app alerts, Web Push, and /healthz probes.",
	},
	{
		name: "packages/ai-core",
		runtime: "@workspace/ai-core",
		summary:
			"Mastra AI agents, multi-provider model router (Gemini, OpenAI, Anthropic, OpenRouter), @mastra/pg pgvector memory, and Zod contracts.",
	},
	{
		name: "packages/db",
		runtime: "@workspace/db",
		summary:
			"Drizzle ORM PostgreSQL schema (public), pgvector init/migrations, and seed script.",
	},
	{
		name: "packages/ui",
		runtime: "@workspace/ui",
		summary:
			"Shared Radix UI primitives, Tailwind v4 design tokens, notification center, and auth dialogs.",
	},
] as const;

const CAPABILITY_SPECS = [
	{
		detail:
			"Email and password login with required verification, hashed 6-digit Email OTP, optional Google OAuth, 4 org roles (owner, admin, member, viewer), tenant isolation middleware, and atomic ownership transfer.",
		path: "@workspace/api/permissions",
		title: "Auth, Orgs & RBAC",
	},
	{
		detail:
			"Native Bun Hono server exporting AppType for typed client requests, Redis rate limiting, Pino secret redaction, PostgreSQL audit logs, and Drizzle connection caching on globalThis.",
		path: "@workspace/api/hc",
		title: "Hono API & Drizzle Postgres",
	},
	{
		detail:
			"Presigned PUT uploads capped at 10 MB with a 9-type MIME allowlist (SVG excluded), S3 HeadObject verification before commit, row-locked org quotas via FOR UPDATE, and authenticated downloads.",
		path: "@workspace/api/storage",
		title: "Private S3 / R2 Storage",
	},
	{
		detail:
			"Separate worker runtime consuming Zod-validated email and notification queues, rendering transactional Resend HTML emails, persisting in-app alerts, and delivering VAPID Web Push.",
		path: "@workspace/api/queues",
		title: "BullMQ Worker & Push",
	},
	{
		detail:
			"Tenant-scoped Mastra agents on any supported provider (Gemini default), read-only Drizzle tools reading server RequestContext, AI SDK v7 SSE streaming at /api/ai/chat, and pgvector semantic memory.",
		path: "@workspace/ai-core/contracts",
		title: "Mastra AI & pgvector",
	},
] as const;

const CONTRACT_EXPORTS = [
	{
		consumers: "apps/web, apps/api, apps/worker",
		description: "Canonical APP_CONFIG branding and environment defaults.",
		subpath: "@workspace/api/config",
	},
	{
		consumers: "apps/web",
		description:
			"Hono AppType definition used by hc<AppType> and parseApiResponse.",
		subpath: "@workspace/api/hc",
	},
	{
		consumers: "apps/web, packages/ui, apps/api",
		description: "RBAC statements, roles, roleAllows(), and PERMISSION_MATRIX.",
		subpath: "@workspace/api/permissions",
	},
	{
		consumers: "apps/web, apps/api, apps/worker, packages/db",
		description:
			"Queue names, notification categories/channels, and Zod job schemas.",
		subpath: "@workspace/api/queues",
	},
	{
		consumers: "apps/web, apps/api",
		description:
			"STORAGE_CONFIG size/expiry caps, MIME allowlist, and formatBytes().",
		subpath: "@workspace/api/storage",
	},
	{
		consumers: "apps/api, apps/worker",
		description: "Pino structured logger with sensitive key redaction.",
		subpath: "@workspace/api/logger",
	},
	{
		consumers: "apps/api, apps/worker, packages/ai-core",
		description:
			"Pooled PostgreSQL Drizzle client and typed schema tables/relations.",
		subpath: "@workspace/db, @workspace/db/schema",
	},
	{
		consumers: "apps/web, apps/api",
		description:
			"Mastra AI chat/thread Zod schemas, agent IDs, and tenant resource helpers.",
		subpath: "@workspace/ai-core/contracts",
	},
] as const;

const ENV_GROUPS = [
	{
		area: "Database, Auth & Routing",
		notes:
			"Matches local Postgres on 127.0.0.1:5432. Set a strong BETTER_AUTH_SECRET in production; INTERNAL_API_URL backs /api/* rewrites.",
		vars: [
			"DATABASE_URL",
			"BETTER_AUTH_SECRET",
			"BETTER_AUTH_URL",
			"CORS_ORIGIN",
			"INTERNAL_API_URL",
			"NEXT_PUBLIC_APP_URL",
		],
	},
	{
		area: "Redis & Private S3 / R2 / MinIO",
		notes:
			"Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (and ensure S3_BUCKET exists) before calling POST /api/storage/presign.",
		vars: [
			"REDIS_URL",
			"REDIS_PREFIX",
			"S3_BUCKET",
			"S3_REGION",
			"S3_ENDPOINT",
			"S3_ACCESS_KEY_ID",
			"S3_SECRET_ACCESS_KEY",
		],
	},
	{
		area: "Optional OAuth, Email & Web Push",
		notes:
			"Google OAuth stays disabled unless credentials and NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true are provided together.",
		vars: [
			"GOOGLE_CLIENT_ID",
			"GOOGLE_CLIENT_SECRET",
			"NEXT_PUBLIC_GOOGLE_AUTH_ENABLED",
			"RESEND_API_KEY",
			"VAPID_PUBLIC_KEY",
			"VAPID_PRIVATE_KEY",
			"WORKER_HEALTH_PORT",
		],
	},
	{
		area: "Mastra AI & pgvector (multi-provider)",
		notes:
			"Pick a chat model with MASTRA_DEFAULT_MODEL (google/*, openai/*, anthropic/*, openrouter/*) and set that provider's key. Semantic recall embeddings use MASTRA_EMBEDDING_MODEL (google/* or openai/*). Mastra tables live in MASTRA_DB_SCHEMA (mastra).",
		vars: [
			"MASTRA_DEFAULT_MODEL",
			"GOOGLE_GENERATIVE_AI_API_KEY",
			"OPENAI_API_KEY",
			"ANTHROPIC_API_KEY",
			"OPENROUTER_API_KEY",
			"MASTRA_EMBEDDING_MODEL",
			"MASTRA_EMBEDDING_DIMENSIONS",
			"MASTRA_DB_SCHEMA",
		],
	},
] as const;

const SCRIPTS = [
	{
		command: "bun run dev",
		purpose: "Start web (:3000), api (:3001), and worker (:3002)",
	},
	{
		command: "bun run dev:ai",
		purpose: "Launch Mastra Studio (mastra dev) for @workspace/ai-core",
	},
	{ command: "bun run build", purpose: "Build all workspaces via Turborepo" },
	{
		command: "bun run check",
		purpose: "Run Ultracite / Biome lint and format checks",
	},
	{
		command: "bun run check-types",
		purpose: "Run TypeScript checks across all 6 workspaces",
	},
	{ command: "bun run test", purpose: "Run the Bun workspace test suite" },
	{
		command: "bun run db:push",
		purpose: "Push Drizzle schema directly to PostgreSQL",
	},
	{
		command: "bun run db:migrate",
		purpose: "Apply SQL migrations from packages/db",
	},
	{
		command: "bun run db:seed",
		purpose:
			"Seed Acme Corporation (admin@acme.example, 1 GB quota, default prefs; no password credential)",
	},
] as const;

const HEALTH_PROBES = [
	{
		behavior: "Process liveness returning uptime and timestamp.",
		endpoint: "GET /api/health, GET /api/health/live",
		service: "apps/api (:3001)",
	},
	{
		behavior: "Verifies PostgreSQL and Redis connectivity with timeout guard.",
		endpoint: "GET /api/health/ready",
		service: "apps/api (:3001)",
	},
	{
		behavior: "Worker liveness and BullMQ status (returns 503 while draining).",
		endpoint: "GET /healthz, GET /live",
		service: "apps/worker (:3002)",
	},
	{
		behavior: "Checks worker PostgreSQL and Redis connections before shutdown.",
		endpoint: "GET /readyz",
		service: "apps/worker (:3002)",
	},
] as const;

function PermissionStatusCell({ allowed }: { allowed: boolean }) {
	return (
		<TableCell className="text-center">
			{allowed ? (
				<span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
					<Check aria-hidden="true" className="h-3.5 w-3.5" />
					<span className="sr-only">Allowed</span>
				</span>
			) : (
				<span className="text-muted-foreground/50 inline-flex h-6 w-6 items-center justify-center">
					<Minus aria-hidden="true" className="h-3.5 w-3.5" />
					<span className="sr-only">Not allowed</span>
				</span>
			)}
		</TableCell>
	);
}

function PermissionMatrixTable({
	entries,
}: {
	entries: readonly PermissionMatrixEntry[];
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="px-4">Capability</TableHead>
					<TableHead className="text-center">Viewer</TableHead>
					<TableHead className="text-center">Member</TableHead>
					<TableHead className="text-center">Admin</TableHead>
					<TableHead className="text-center">Owner</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{entries.map((entry) => (
					<TableRow key={`${entry.category}-${entry.resource}`}>
						<TableCell className="px-4 py-3">
							<div className="text-foreground text-sm font-medium">
								{entry.resource}
							</div>
							<div className="text-muted-foreground text-xs">
								{entry.description}
							</div>
						</TableCell>
						<PermissionStatusCell allowed={entry.viewer} />
						<PermissionStatusCell allowed={entry.member} />
						<PermissionStatusCell allowed={entry.admin} />
						<PermissionStatusCell allowed={entry.owner} />
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export default function HomePage() {
	const _contractsContent = (
		<div className="space-y-6">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="px-4">Subpath</TableHead>
						<TableHead>Consumers</TableHead>
						<TableHead className="px-4">Exports</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{CONTRACT_EXPORTS.map((item) => (
						<TableRow key={item.subpath}>
							<TableCell className="px-4 font-mono text-xs font-medium">
								{item.subpath}
							</TableCell>
							<TableCell className="text-muted-foreground font-mono text-xs">
								{item.consumers}
							</TableCell>
							<TableCell className="text-muted-foreground px-4 text-sm">
								{item.description}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			<div className="grid gap-4 lg:grid-cols-2">
				<div className="border-border/70 bg-card space-y-4 rounded-xl border p-5">
					<div className="flex items-baseline justify-between gap-2">
						<h3 className="text-foreground text-sm font-semibold">
							Storage Constraints
						</h3>
						<code className="text-muted-foreground font-mono text-xs">
							@workspace/api/storage
						</code>
					</div>
					<div className="grid grid-cols-3 gap-3 text-sm">
						<div>
							<div className="text-muted-foreground text-xs">Max file</div>
							<div className="text-foreground mt-0.5 font-mono font-semibold">
								{formatBytes(STORAGE_CONFIG.MAX_FILE_SIZE, 0)}
							</div>
						</div>
						<div>
							<div className="text-muted-foreground text-xs">Presign TTL</div>
							<div className="text-foreground mt-0.5 font-mono font-semibold">
								{STORAGE_CONFIG.PRESIGN_EXPIRY_SECONDS}s
							</div>
						</div>
						<div>
							<div className="text-muted-foreground text-xs">Download TTL</div>
							<div className="text-foreground mt-0.5 font-mono font-semibold">
								{STORAGE_CONFIG.DOWNLOAD_URL_EXPIRY_SECONDS}s
							</div>
						</div>
					</div>
					<div>
						<div className="text-muted-foreground mb-2 text-xs">
							Allowlisted MIME types (
							{STORAGE_CONFIG.ALLOWED_CONTENT_TYPES.length}, SVG excluded)
						</div>
						<div className="flex flex-wrap gap-1.5">
							{STORAGE_CONFIG.ALLOWED_CONTENT_TYPES.map((mime) => (
								<code
									className="border-border/70 bg-background text-foreground rounded border px-2 py-0.5 font-mono text-xs"
									key={mime}
								>
									{mime}
								</code>
							))}
						</div>
					</div>
				</div>

				<div className="border-border/70 bg-card space-y-4 rounded-xl border p-5">
					<div className="flex items-baseline justify-between gap-2">
						<h3 className="text-foreground text-sm font-semibold">
							Queues &amp; Notification Channels
						</h3>
						<code className="text-muted-foreground font-mono text-xs">
							@workspace/api/queues
						</code>
					</div>
					<div className="flex flex-wrap gap-2">
						<code className="border-border/70 bg-background text-foreground rounded border px-2 py-0.5 font-mono text-xs">
							{EMAIL_QUEUE_NAME}
						</code>
						<code className="border-border/70 bg-background text-foreground rounded border px-2 py-0.5 font-mono text-xs">
							{NOTIFICATION_QUEUE_NAME}
						</code>
					</div>
					<div className="space-y-2">
						<div className="text-muted-foreground text-xs">Categories</div>
						<div className="flex flex-wrap gap-1.5">
							{NOTIFICATION_CATEGORIES.map((category) => (
								<code
									className="border-border/70 bg-background rounded border px-2 py-0.5 font-mono text-xs"
									key={category}
								>
									{category}
								</code>
							))}
						</div>
					</div>
					<div className="space-y-2">
						<div className="text-muted-foreground text-xs">
							Delivery channels
						</div>
						<div className="flex flex-wrap gap-1.5">
							{NOTIFICATION_CHANNELS.map((channel) => (
								<code
									className="border-border/70 bg-background rounded border px-2 py-0.5 font-mono text-xs"
									key={channel}
								>
									{channel}
								</code>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	const _rbacContent = (
		<div className="space-y-3">
			<p className="text-muted-foreground text-sm leading-relaxed">
				Live capability mapping imported from{" "}
				<code className="text-foreground font-mono text-xs">
					PERMISSION_MATRIX
				</code>{" "}
				({PERMISSION_MATRIX.length} rules). Server route guards enforce these
				via{" "}
				<code className="text-foreground font-mono text-xs">
					hasOrgPermission(...)
				</code>{" "}
				in{" "}
				<code className="text-foreground font-mono text-xs">
					apps/api/src/middleware/org-permission.ts
				</code>
				.
			</p>
			<PermissionMatrixTable entries={PERMISSION_MATRIX} />
		</div>
	);

	const _setupContent = (
		<div className="space-y-6">
			<div className="border-border/70 bg-card divide-border/70 divide-y rounded-xl border">
				{ENV_GROUPS.map((group) => (
					<div className="space-y-2 p-4" key={group.area}>
						<div className="text-foreground text-sm font-semibold">
							{group.area}
						</div>
						<p className="text-muted-foreground text-xs leading-relaxed">
							{group.notes}
						</p>
						<div className="flex flex-wrap gap-1.5 pt-1">
							{group.vars.map((envVar) => (
								<code
									className="border-border/70 bg-background text-foreground rounded border px-2 py-0.5 font-mono text-xs"
									key={envVar}
								>
									{envVar}
								</code>
							))}
						</div>
					</div>
				))}
			</div>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="px-4">Script</TableHead>
						<TableHead className="px-4">Purpose</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{SCRIPTS.map((script) => (
						<TableRow key={script.command}>
							<TableCell className="px-4 font-mono text-xs font-medium whitespace-nowrap">
								{script.command}
							</TableCell>
							<TableCell className="text-muted-foreground px-4 text-sm">
								{script.purpose}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="px-4">Service</TableHead>
						<TableHead>Probe Endpoint</TableHead>
						<TableHead className="px-4">Behavior</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{HEALTH_PROBES.map((probe) => (
						<TableRow key={probe.endpoint}>
							<TableCell className="px-4 font-mono text-xs whitespace-nowrap">
								{probe.service}
							</TableCell>
							<TableCell className="font-mono text-xs">
								{probe.endpoint}
							</TableCell>
							<TableCell className="text-muted-foreground px-4 text-sm">
								{probe.behavior}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);

	return (
		<div className="flex min-h-screen flex-col">
			<SiteHeader />

			<main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
				<section className="py-12 sm:py-20 lg:py-24">
					<div className="max-w-4xl">
						<h1 className="text-foreground text-3xl font-bold tracking-tight text-balance sm:text-5xl sm:leading-[1.08]">
							Multi-tenant TypeScript starter for teams, storage, and background
							jobs.
						</h1>
						<p className="text-muted-foreground mt-5 max-w-[58ch] text-base leading-relaxed text-pretty sm:text-lg">
							Better Auth organizations, Drizzle ORM on Postgres, private S3/R2
							uploads, and BullMQ email and push workers sharing one workspace
							contract.
						</p>
						<div className="mt-8 flex flex-wrap items-center gap-3">
							<Button asChild autoHeight size="md" variant="primary">
								<a href="#architecture">
									<span>Explore architecture</span>
									<ArrowDown aria-hidden="true" />
								</a>
							</Button>
							<div className="border-border/70 bg-card inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border py-0.5 pr-1 pl-3.5">
								<span
									aria-hidden="true"
									className="text-muted-foreground font-mono text-sm select-none"
								>
									$
								</span>
								<code className="text-foreground font-mono text-sm">
									bun run setup
								</code>
								<CopyButton
									className="text-muted-foreground hover:text-foreground h-9 w-9 p-0"
									label="Copy setup command"
									showText={false}
									value="bun run setup"
								/>
							</div>
						</div>
					</div>
				</section>

				<section
					className="border-border/70 scroll-mt-20 border-t py-14 sm:py-16"
					id="architecture"
				>
					<div className="max-w-2xl">
						<h2 className="text-foreground text-2xl font-semibold tracking-tight sm:text-3xl">
							Six workspaces, connected by typed contracts
						</h2>
						<p className="text-muted-foreground mt-2 text-sm leading-relaxed sm:text-base">
							Browser-safe permissions, storage constants, and queue schemas
							export directly from workspace subpaths without leaking database
							or Redis dependencies to client bundles.
						</p>
					</div>

					<div className="border-border/70 bg-card divide-border/70 mt-8 divide-y rounded-xl border">
						{WORKSPACE_ROWS.map((row) => (
							<div
								className="grid gap-1 px-4 py-3.5 sm:grid-cols-[160px_180px_1fr] sm:items-baseline sm:gap-4"
								key={row.name}
							>
								<span className="text-foreground font-mono text-sm font-medium">
									{row.name}
								</span>
								<span className="text-muted-foreground font-mono text-xs">
									{row.runtime}
								</span>
								<p className="text-muted-foreground text-sm">{row.summary}</p>
							</div>
						))}
					</div>

					<div className="border-border/70 bg-border/70 mt-8 grid gap-px overflow-hidden rounded-xl border md:grid-cols-2">
						{CAPABILITY_SPECS.map((spec) => (
							<div className="bg-card p-6" key={spec.title}>
								<div className="flex flex-wrap items-baseline justify-between gap-2">
									<h3 className="text-foreground text-base font-semibold">
										{spec.title}
									</h3>
									<code className="text-muted-foreground font-mono text-xs">
										{spec.path}
									</code>
								</div>
								<p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">
									{spec.detail}
								</p>
							</div>
						))}
					</div>
				</section>
			</main>

			<SiteFooter />
		</div>
	);
}
