"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import {
	Building2,
	Camera,
	CheckCircle2,
	Globe,
	ImagePlus,
	Loader2,
	Lock,
	Mail,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
	useCurrentOrganization,
	useOrganizationMutations,
} from "@/lib/organization-hooks";
import {
	uploadFileToStorage,
	validateImageUploadFile,
} from "@/lib/storage-upload";

export default function GeneralSettingsPage() {
	const { fullOrg, activeOrg, activeOrgId, canManageSettings, isLoading } =
		useCurrentOrganization();
	const { updateOrganization, isSubmitting } = useOrganizationMutations({
		showToasts: false,
	});

	const orgNameId = useId();
	const orgSlugId = useId();
	const orgEmailId = useId();
	const orgWebsiteId = useId();

	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [email, setEmail] = useState("");
	const [website, setWebsite] = useState("");
	const [logoUrl, setLogoUrl] = useState<string | null>(null);
	const [isUploadingLogo, setIsUploadingLogo] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (fullOrg) {
			setName(fullOrg.name || "");
			setSlug(fullOrg.slug || "");
			setLogoUrl(fullOrg.logo ?? null);
			const metadata = fullOrg.metadata as {
				email?: string;
				website?: string;
			} | null;
			setEmail(metadata?.email ?? "");
			setWebsite(metadata?.website ?? "");
		} else if (activeOrg) {
			setName(activeOrg.name || "");
			setSlug(activeOrg.slug || "");
			setLogoUrl(activeOrg.logo ?? null);
		}
	}, [fullOrg, activeOrg]);

	const handleSaveProfile = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!activeOrgId) {
			return;
		}

		const trimmedName = name.trim();
		if (!trimmedName) {
			toast.error("Organization name is required");
			return;
		}

		const formattedSlug = slug
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-]+/gu, "-")
			.replace(/^-+|-+$/gu, "");

		if (!formattedSlug) {
			toast.error(
				"A valid vanity URL slug (letters, numbers, hyphens) is required"
			);
			return;
		}

		try {
			await updateOrganization({
				logo: logoUrl,
				metadata: {
					email: email.trim(),
					website: website.trim(),
				},
				name: trimmedName,
				organizationId: activeOrgId,
				slug: formattedSlug,
			});
			setSlug(formattedSlug);
			toast.success("Organization profile updated");
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Failed to update organization profile"
			);
		}
	};

	const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!(file && activeOrgId)) {
			return;
		}

		const validationError = validateImageUploadFile(file);
		if (validationError) {
			toast.error(validationError);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
			return;
		}

		try {
			setIsUploadingLogo(true);
			const newLogo = await uploadFileToStorage(file);

			await updateOrganization({
				logo: newLogo,
				organizationId: activeOrgId,
			});
			setLogoUrl(newLogo);

			toast.success("Workspace logo updated successfully");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to upload logo"
			);
		} finally {
			setIsUploadingLogo(false);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	const handleRemoveLogo = async () => {
		if (!activeOrgId) {
			return;
		}
		const previousLogo = logoUrl;
		try {
			setLogoUrl(null);
			await updateOrganization({
				logo: null,
				organizationId: activeOrgId,
			});
			toast.success("Workspace logo removed");
		} catch (error) {
			setLogoUrl(previousLogo);
			toast.error(
				error instanceof Error ? error.message : "Failed to remove logo"
			);
		}
	};

	if (isLoading && !activeOrg) {
		return (
			<div className="flex h-64 items-center justify-center">
				<Loader2 className="text-primary h-8 w-8 animate-spin" />
			</div>
		);
	}

	const fallbackInitials = name ? name.charAt(0).toUpperCase() : "W";

	return (
		<SettingsPage
			description="Manage your organization profile, custom branding, and vanity URL routing."
			headingLevel="h2"
			title="General Organization Profile"
			titleAccessory={
				canManageSettings ? (
					<Badge
						className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
						variant="outline"
					>
						<CheckCircle2 className="h-3 w-3" /> Live Workspace
					</Badge>
				) : (
					<Badge
						className="gap-1 border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
						variant="outline"
					>
						<Lock className="h-3 w-3" /> Read-only Scope
					</Badge>
				)
			}
		>
			{/* Logo & Visual Identity */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Your organization icon appears across invites, notifications, and navigation dropdowns."
					title="Workspace Brand Identity"
				/>
				<SettingsSectionContent>
					<div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
						<button
							aria-label="Upload workspace logo"
							className="group border-border/70 focus-visible:ring-ring relative h-24 w-24 cursor-pointer overflow-hidden rounded-2xl border-2 p-0 shadow-xs transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:outline-hidden"
							disabled={!canManageSettings || isUploadingLogo}
							onClick={() => fileInputRef.current?.click()}
							type="button"
						>
							<Avatar className="h-full w-full rounded-2xl">
								{logoUrl ? <AvatarImage alt={name} src={logoUrl} /> : null}
								<AvatarFallback className="from-primary/20 via-primary/10 to-primary/5 text-primary rounded-2xl bg-linear-to-br text-3xl font-bold">
									{fallbackInitials}
								</AvatarFallback>
							</Avatar>

							{canManageSettings ? (
								<div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
									<Camera className="h-5 w-5" />
									<span className="mt-1 text-[10px] font-medium">Change</span>
								</div>
							) : null}
						</button>

						<div className="space-y-3 text-center sm:text-left">
							<div className="flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
								<input
									accept="image/png,image/jpeg,image/webp,image/gif"
									aria-label="Workspace logo file"
									className="hidden"
									disabled={
										!canManageSettings || isUploadingLogo || isSubmitting
									}
									onChange={handleLogoUpload}
									ref={fileInputRef}
									type="file"
								/>
								<Button
									disabled={
										!canManageSettings || isUploadingLogo || isSubmitting
									}
									onClick={() => fileInputRef.current?.click()}
									size="sm"
									type="button"
									variant="outline"
								>
									{isUploadingLogo ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Uploading...
										</>
									) : (
										<>
											<ImagePlus className="mr-2 h-4 w-4" />
											Upload New Logo
										</>
									)}
								</Button>

								{logoUrl ? (
									<Button
										disabled={!canManageSettings || isSubmitting}
										onClick={handleRemoveLogo}
										size="sm"
										type="button"
										variant="ghost"
									>
										<Trash2 className="text-destructive mr-2 h-4 w-4" />
										Remove
									</Button>
								) : null}
							</div>
							<p className="text-muted-foreground text-xs">
								Recommended format: PNG, JPG, WebP, or GIF. Transparent
								background looks best. Max 5MB.
							</p>
						</div>
					</div>
				</SettingsSectionContent>
			</SettingsSection>

			{/* Core Organization Details */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Primary identifiers and public metadata bound to this tenant context."
					title="Organization Attributes"
				/>
				<SettingsSectionContent>
					<form className="space-y-6" onSubmit={handleSaveProfile}>
						<div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
							<div className="space-y-2">
								<Label
									className="text-foreground flex items-center gap-1.5 text-xs font-medium"
									htmlFor={orgNameId}
								>
									<Building2 className="text-muted-foreground h-3.5 w-3.5" />
									Organization Name
								</Label>
								<Input
									disabled={!canManageSettings || isSubmitting}
									id={orgNameId}
									onChange={(e) => setName(e.target.value)}
									placeholder="e.g. Acme Corporation"
									required
									value={name}
								/>
							</div>

							<div className="space-y-2">
								<Label
									className="text-foreground flex items-center gap-1.5 text-xs font-medium"
									htmlFor={orgSlugId}
								>
									Vanity URL Slug
								</Label>
								<div className="relative">
									<Input
										disabled={!canManageSettings || isSubmitting}
										id={orgSlugId}
										onChange={(e) => setSlug(e.target.value)}
										placeholder="acme-corp"
										required
										value={slug}
									/>
								</div>
								<p className="text-muted-foreground font-mono text-[11px]">
									Scope identifier:{" "}
									<span className="text-foreground">
										/org/{slug || "workspace"}
									</span>
								</p>
							</div>

							<div className="space-y-2">
								<Label
									className="text-foreground flex items-center gap-1.5 text-xs font-medium"
									htmlFor={orgEmailId}
								>
									<Mail className="text-muted-foreground h-3.5 w-3.5" />
									Administrative Email
								</Label>
								<Input
									disabled={!canManageSettings || isSubmitting}
									id={orgEmailId}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="team@acme.com"
									type="email"
									value={email}
								/>
							</div>

							<div className="space-y-2">
								<Label
									className="text-foreground flex items-center gap-1.5 text-xs font-medium"
									htmlFor={orgWebsiteId}
								>
									<Globe className="text-muted-foreground h-3.5 w-3.5" />
									Official Website
								</Label>
								<Input
									disabled={!canManageSettings || isSubmitting}
									id={orgWebsiteId}
									onChange={(e) => setWebsite(e.target.value)}
									placeholder="https://acme.com"
									type="url"
									value={website}
								/>
							</div>
						</div>

						{canManageSettings ? (
							<div className="border-border/50 flex items-center justify-end border-t pt-5">
								<Button
									disabled={isSubmitting}
									size="sm"
									type="submit"
									variant="primary"
								>
									{isSubmitting ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Saving...
										</>
									) : (
										"Save Changes"
									)}
								</Button>
							</div>
						) : null}
					</form>
				</SettingsSectionContent>
			</SettingsSection>
		</SettingsPage>
	);
}
