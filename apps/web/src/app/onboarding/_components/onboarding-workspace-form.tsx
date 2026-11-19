"use client";

import { APP_CONFIG } from "@workspace/api/config";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { sanitizeSlug } from "@workspace/ui/lib/utils";
import { AlertCircle, Building2, Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import { useOrganizationMutations } from "@/lib/organization-hooks";

interface OnboardingWorkspaceFormProps {
	nextPath: string;
	userEmail: string;
	userName: string;
}

export function OnboardingWorkspaceForm({
	nextPath,
	userEmail,
	userName,
}: OnboardingWorkspaceFormProps) {
	const router = useRouter();
	const nameId = useId();
	const slugId = useId();
	const errorId = useId();

	const { createOrganization, isCreatingOrganization } =
		useOrganizationMutations({ showToasts: false });

	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isSigningOut, setIsSigningOut] = useState(false);

	const normalizedPreviewSlug = sanitizeSlug(slug.trim() || name.trim());

	const handleNameChange = (value: string) => {
		setName(value);
		if (!isSlugManuallyEdited) {
			setSlug(sanitizeSlug(value));
		}
		if (errorMessage) {
			setErrorMessage(null);
		}
	};

	const handleSlugChange = (value: string) => {
		setIsSlugManuallyEdited(true);
		setSlug(value);
		if (errorMessage) {
			setErrorMessage(null);
		}
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmedName = name.trim();
		if (!trimmedName) {
			setErrorMessage("Enter a workspace name to continue.");
			return;
		}

		const finalSlug = sanitizeSlug(slug.trim() || trimmedName);
		if (!finalSlug) {
			setErrorMessage(
				"Workspace URL slug must contain at least one letter or number."
			);
			return;
		}

		setErrorMessage(null);

		try {
			await createOrganization({ name: trimmedName, slug: finalSlug });
			toast.success("Workspace created and set as your default");
			router.replace(nextPath);
			router.refresh();
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Unable to create workspace. Try a different URL slug."
			);
		}
	};

	const handleSignOut = async () => {
		try {
			setIsSigningOut(true);
			const res = await signOut();
			if (res.error) {
				toast.error(res.error.message || "Failed to sign out");
				return;
			}
			router.replace("/");
			router.refresh();
		} finally {
			setIsSigningOut(false);
		}
	};

	const isBusy = isCreatingOrganization || isSigningOut;

	return (
		<div className="bg-muted/20 text-foreground flex min-h-screen flex-col">
			<header className="border-border/70 bg-background/95 sticky top-0 z-40 w-full border-b backdrop-blur-xs">
				<div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
					<div className="text-foreground flex min-w-0 items-center gap-2.5 text-base font-semibold tracking-tight">
						<BrandMark className="h-7 w-7" />
						<span className="truncate">{APP_CONFIG.name}</span>
					</div>

					<div className="flex shrink-0 items-center gap-2">
						<span className="text-muted-foreground hidden max-w-52 truncate text-xs sm:inline">
							{userEmail}
						</span>
						<ThemeToggle />
						<Button
							className="gap-1.5"
							disabled={isBusy}
							onClick={() => void handleSignOut()}
							size="sm"
							type="button"
							variant="ghost"
						>
							<LogOut aria-hidden="true" className="h-4 w-4" />
							<span>Sign out</span>
						</Button>
					</div>
				</div>
			</header>

			<main
				className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-12 outline-none sm:px-6"
				id="main-content"
				tabIndex={-1}
			>
				<div className="border-border/70 bg-card/85 rounded-2xl border p-6 shadow-sm backdrop-blur-xs sm:p-8">
					<div className="mb-6 flex items-start gap-3.5">
						<div className="border-border/70 bg-muted/50 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border">
							<Building2 aria-hidden="true" className="h-5 w-5" />
						</div>
						<div className="space-y-1">
							<h1 className="text-foreground text-xl font-semibold tracking-tight">
								Create your workspace
							</h1>
							<p className="text-muted-foreground text-sm leading-relaxed">
								Welcome{userName ? `, ${userName}` : ""}. Organizations isolate
								your AI threads, files, and team access. This workspace will be
								set active and saved as your default.
							</p>
						</div>
					</div>

					<form
						aria-describedby={errorMessage ? errorId : undefined}
						className="space-y-5"
						onSubmit={(event) => void handleSubmit(event)}
					>
						<div className="space-y-1.5">
							<Label className="text-sm font-medium" htmlFor={nameId}>
								Workspace name
							</Label>
							<Input
								autoComplete="organization"
								autoFocus
								disabled={isBusy}
								id={nameId}
								maxLength={80}
								name="name"
								onChange={(event) => handleNameChange(event.target.value)}
								placeholder="e.g. Acme Studio"
								required
								value={name}
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-sm font-medium" htmlFor={slugId}>
								Workspace URL slug
							</Label>
							<div className="flex items-center overflow-hidden rounded-md border">
								<span className="bg-muted/40 text-muted-foreground border-r px-3 py-2 font-mono text-xs select-none">
									workspace /
								</span>
								<Input
									aria-label="Workspace URL slug"
									autoCapitalize="none"
									autoCorrect="off"
									className="border-0 font-mono text-sm shadow-none focus-visible:ring-0"
									disabled={isBusy}
									id={slugId}
									maxLength={80}
									name="slug"
									onChange={(event) => handleSlugChange(event.target.value)}
									placeholder="acme-studio"
									spellCheck={false}
									value={slug}
								/>
							</div>
							<p className="text-muted-foreground text-xs">
								Lowercase letters, numbers, and hyphens.
								{normalizedPreviewSlug ? (
									<>
										{" "}
										Saved as{" "}
										<code className="text-foreground font-mono">
											{normalizedPreviewSlug}
										</code>
										.
									</>
								) : null}
							</p>
						</div>

						{errorMessage ? (
							<div
								className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm"
								id={errorId}
								role="alert"
							>
								<AlertCircle
									aria-hidden="true"
									className="mt-0.5 h-4 w-4 shrink-0"
								/>
								<span>{errorMessage}</span>
							</div>
						) : null}

						<Button
							className="w-full"
							disabled={isBusy || name.trim().length === 0}
							type="submit"
							variant="primary"
						>
							{isCreatingOrganization ? (
								<>
									<Loader2
										aria-hidden="true"
										className="mr-2 h-4 w-4 animate-spin"
									/>
									Creating workspace...
								</>
							) : (
								"Create workspace"
							)}
						</Button>
					</form>
				</div>

				<p className="text-muted-foreground mt-5 text-center text-xs leading-relaxed">
					Waiting on a team invite? Open your invitation link directly to join
					an existing workspace instead.
				</p>
			</main>
		</div>
	);
}
