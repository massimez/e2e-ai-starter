"use client";

import type { AiModelOption } from "@workspace/ai-core/contracts";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card } from "@workspace/ui/components/card";
import {
	AlertCircle,
	ArrowLeft,
	Loader2,
	MessageSquarePlus,
	RefreshCw,
} from "lucide-react";
import Link from "next/link";

export function ThreadErrorCard({
	errorMessage,
	onNewConversation,
	onRetry,
}: {
	errorMessage: string;
	onNewConversation: () => void;
	onRetry: () => void;
}) {
	return (
		<Card className="border-border/60 bg-card/80 flex min-h-120 items-center justify-center p-6 shadow-xs">
			<div className="max-w-md space-y-4 text-center" role="alert">
				<div className="bg-destructive/10 text-destructive mx-auto flex h-11 w-11 items-center justify-center rounded-full">
					<AlertCircle aria-hidden="true" className="h-5 w-5" />
				</div>
				<div className="space-y-1">
					<h2 className="text-foreground text-base font-semibold">
						Could not load conversation
					</h2>
					<p className="text-muted-foreground text-xs leading-relaxed">
						{errorMessage}
					</p>
				</div>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button onClick={onRetry} size="sm" type="button" variant="outline">
						<RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
						Retry
					</Button>
					<Button onClick={onNewConversation} size="sm" type="button">
						<MessageSquarePlus aria-hidden="true" className="h-3.5 w-3.5" />
						Start New Chat
					</Button>
				</div>
			</div>
		</Card>
	);
}

export function ThreadLoadingCard() {
	return (
		<Card className="border-border/60 bg-card/80 flex min-h-120 items-center justify-center shadow-xs">
			<div className="text-muted-foreground flex items-center gap-2 text-sm">
				<Loader2
					aria-hidden="true"
					className="text-primary h-4 w-4 animate-spin"
				/>
				<span>Loading conversation...</span>
			</div>
		</Card>
	);
}

export function AiWorkspaceBanner({
	availableModels,
	modelLabel,
	onNewConversation,
	onSelectModel,
	selectedModelId,
	semanticRecall,
}: {
	availableModels: AiModelOption[];
	modelLabel: string;
	onNewConversation: () => void;
	onSelectModel: (modelId: string) => void;
	selectedModelId: string;
	semanticRecall: boolean;
}) {
	const configuredModels = availableModels.filter((m) => m.configured);

	return (
		<div className="border-border/70 bg-card/70 relative overflow-hidden rounded-2xl border p-6 shadow-xs backdrop-blur-md">
			<div className="from-primary/10 via-primary/5 dark:from-primary/15 pointer-events-none absolute inset-0 bg-linear-to-r to-transparent" />
			<div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div className="space-y-2">
					<Link
						className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
						href="/dashboard"
					>
						<ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
						Back to Workspace
					</Link>
					<div className="flex flex-wrap items-center gap-2.5">
						<h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
							AI Workspace Assistant
						</h1>
						<Badge appearance="light" size="sm" variant="primary">
							{selectedModelId || modelLabel}
						</Badge>
						<Badge appearance="light" size="sm" variant="secondary">
							{semanticRecall ? "Smart Memory + RAG" : "Thread Memory"}
						</Badge>
					</div>
					<p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
						Ask questions about your workspace, team members, stored files, and
						indexed documents. Conversations stay private to your active
						organization.
					</p>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{configuredModels.length > 1 ? (
						<label className="flex items-center gap-1.5 text-xs">
							<span className="sr-only">Select AI model</span>
							<select
								aria-label="Select AI model"
								className="border-input bg-background text-foreground focus-visible:ring-ring h-8 rounded-lg border px-2.5 text-xs outline-none focus-visible:ring-2"
								onChange={(event) => onSelectModel(event.target.value)}
								value={selectedModelId || modelLabel}
							>
								{configuredModels.map((opt) => (
									<option key={opt.id} value={opt.id}>
										{opt.label}
									</option>
								))}
							</select>
						</label>
					) : null}

					<Button
						onClick={onNewConversation}
						size="sm"
						type="button"
						variant="outline"
					>
						<MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
						New Chat
					</Button>
				</div>
			</div>
		</div>
	);
}
