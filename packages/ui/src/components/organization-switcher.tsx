"use client";

import {
	Building2,
	Check,
	ChevronsUpDown,
	Loader2,
	PlusCircle,
	Sparkles,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Label } from "./label";

export interface OrganizationItem {
	id: string;
	logo?: string | null;
	name: string;
	slug: string;
}

export interface OrganizationSwitcherProps {
	activeOrgId?: string | null;
	onCreateOrg?: (name: string, slug: string) => Promise<void>;
	onSelectOrg?: (orgId: string) => Promise<void>;
	organizations: OrganizationItem[];
}

export function sanitizeSlug(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9]/gu, "-")
		.replace(/-+/gu, "-")
		.replace(/^-+|-+$/gu, "");
}

export function OrganizationSwitcher({
	organizations,
	activeOrgId,
	onSelectOrg,
	onCreateOrg,
}: OrganizationSwitcherProps) {
	const orgNameId = useId();
	const orgSlugId = useId();

	const [isOpen, setIsOpen] = useState(false);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [newOrgName, setNewOrgName] = useState("");
	const [newOrgSlug, setNewOrgSlug] = useState("");
	const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);

	const activeOrg = organizations.find((o) => o.id === activeOrgId);

	const resetCreateForm = () => {
		setNewOrgName("");
		setNewOrgSlug("");
		setIsSlugManuallyEdited(false);
	};

	const handleCreateOpenChange = (open: boolean) => {
		setIsCreateOpen(open);
		if (!open) {
			resetCreateForm();
		}
	};

	const handleSelect = async (orgId: string) => {
		if (orgId === activeOrgId) {
			setIsOpen(false);
			return;
		}

		try {
			if (onSelectOrg) {
				await onSelectOrg(orgId);
			}
			setIsOpen(false);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to switch organization"
			);
		}
	};

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedName = newOrgName.trim();
		if (!trimmedName) {
			toast.error("Organization name is required");
			return;
		}

		const slug = sanitizeSlug(newOrgSlug.trim() || trimmedName);
		if (!slug) {
			toast.error("Please enter a valid organization slug");
			return;
		}

		try {
			setIsSubmitting(true);
			if (onCreateOrg) {
				await onCreateOrg(trimmedName, slug);
			}
			setIsCreateOpen(false);
			resetCreateForm();
			toast.success("Organization created successfully");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to create organization"
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<>
			<DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
				<DropdownMenuTrigger asChild>
					<button
						aria-label="Select organization"
						className="group border-border/60 bg-muted/30 hover:border-primary/40 hover:bg-muted/60 focus-visible:ring-ring flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-medium shadow-2xs transition-all duration-200 focus-visible:ring-2 focus-visible:outline-hidden sm:gap-2.5 sm:px-3 sm:text-sm"
						type="button"
					>
						<div className="from-primary/20 via-primary/10 to-primary/5 text-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-linear-to-br text-[10px] font-bold transition-transform group-hover:scale-105">
							{activeOrg ? (
								activeOrg.name.charAt(0).toUpperCase()
							) : (
								<Building2 className="h-3 w-3" />
							)}
						</div>
						<span className="text-foreground max-w-24 truncate sm:max-w-[150px]">
							{activeOrg ? activeOrg.name : "Select Workspace"}
						</span>
						<ChevronsUpDown className="text-muted-foreground group-hover:text-foreground ml-0.5 h-3.5 w-3.5 opacity-60 transition-colors" />
					</button>
				</DropdownMenuTrigger>

				<DropdownMenuContent
					align="start"
					className="w-60 rounded-xl p-1.5 shadow-xl backdrop-blur-md"
				>
					<DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
						Workspaces
					</DropdownMenuLabel>
					<DropdownMenuGroup>
						{organizations.length === 0 ? (
							<div className="text-muted-foreground px-2.5 py-3 text-center text-xs">
								No workspaces yet
							</div>
						) : (
							organizations.map((org) => {
								const isSelected = org.id === activeOrgId;
								return (
									<DropdownMenuItem
										className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
											isSelected
												? "bg-primary/10 text-primary font-semibold"
												: "text-foreground hover:bg-muted/50"
										}`}
										key={org.id}
										onClick={() => handleSelect(org.id)}
									>
										<div className="flex items-center gap-2.5 truncate">
											<div className="bg-primary/10 text-primary flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold">
												{org.name.charAt(0).toUpperCase()}
											</div>
											<span className="truncate">{org.name}</span>
										</div>
										{isSelected && (
											<Check className="text-primary h-4 w-4 shrink-0" />
										)}
									</DropdownMenuItem>
								);
							})
						)}
					</DropdownMenuGroup>

					<DropdownMenuSeparator className="my-1" />

					<DropdownMenuItem
						className="text-primary focus:bg-primary/10 focus:text-primary flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium"
						onClick={() => setIsCreateOpen(true)}
					>
						<PlusCircle className="h-4 w-4" />
						Create New Workspace
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog onOpenChange={handleCreateOpenChange} open={isCreateOpen}>
				<DialogContent className="sm:max-w-106.25">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-lg font-bold">
							<Sparkles className="text-primary h-5 w-5" />
							Create Organization
						</DialogTitle>
						<DialogDescription className="text-xs leading-relaxed">
							Create a new multi-tenant workspace to collaborate with your team
							and scale projects.
						</DialogDescription>
					</DialogHeader>

					<form className="space-y-4 py-2" onSubmit={handleCreate}>
						<div className="space-y-1.5">
							<Label className="text-xs font-medium" htmlFor={orgNameId}>
								Workspace Name
							</Label>
							<Input
								id={orgNameId}
								onChange={(e) => {
									const nextName = e.target.value;
									setNewOrgName(nextName);
									if (!isSlugManuallyEdited) {
										setNewOrgSlug(sanitizeSlug(nextName));
									}
								}}
								placeholder="e.g. Acme Studio"
								required
								value={newOrgName}
							/>
						</div>

						<div className="space-y-1.5">
							<Label className="text-xs font-medium" htmlFor={orgSlugId}>
								URL Vanity Slug
							</Label>
							<Input
								id={orgSlugId}
								onChange={(e) => {
									setIsSlugManuallyEdited(true);
									setNewOrgSlug(e.target.value);
								}}
								placeholder="acme-studio"
								value={newOrgSlug}
							/>
						</div>

						<DialogFooter className="pt-2">
							<Button
								onClick={() => handleCreateOpenChange(false)}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={isSubmitting}
								size="sm"
								type="submit"
								variant="primary"
							>
								{isSubmitting ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Creating...
									</>
								) : (
									"Create Workspace"
								)}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
