"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@workspace/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Folder,
	FolderOpen,
	FolderPlus,
	HardDrive,
	Layers,
	Loader2,
	MoreHorizontal,
	Pencil,
	Trash2,
} from "lucide-react";
import type { FormEvent } from "react";
import type { StorageFolderItem } from "./files-workspace-dialogs";
import type { StorageUsageData } from "./use-storage-workspace";

function resolveQuotaBarColorClass(usagePercent: number): string {
	if (usagePercent >= 90) {
		return "bg-destructive";
	}
	if (usagePercent >= 75) {
		return "bg-amber-500";
	}
	return "bg-primary";
}

export function StorageQuotaCard({
	usage,
}: {
	usage: StorageUsageData | undefined;
}) {
	const usagePercent = usage?.usagePercent ?? 0;

	return (
		<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs">
			<CardHeader className="border-border/60 flex flex-row items-center justify-between border-b px-4 py-3">
				<CardTitle className="flex items-center gap-2 text-sm font-semibold">
					<HardDrive aria-hidden="true" className="text-primary h-4 w-4" />
					Storage Quota
				</CardTitle>
				<span className="text-muted-foreground text-xs font-medium">
					{usage ? `${usage.usagePercent}%` : "..."}
				</span>
			</CardHeader>
			<CardContent className="space-y-2.5 p-4 text-xs">
				<div className="bg-muted h-2 w-full overflow-hidden rounded-full">
					<div
						className={`${resolveQuotaBarColorClass(usagePercent)} h-full rounded-full transition-all duration-300`}
						style={{
							width: `${Math.min(100, usagePercent)}%`,
						}}
					/>
				</div>
				<div className="text-muted-foreground flex items-center justify-between">
					<span>{usage?.formattedCurrentUsage ?? "0 Bytes"} used</span>
					<span>{usage?.formattedStorageLimit ?? "1 GB"} limit</span>
				</div>
			</CardContent>
		</Card>
	);
}

interface FoldersSidebarCardProps {
	canCreateStorage: boolean;
	canDeleteStorage: boolean;
	canUpdateStorage: boolean;
	folderInputId: string;
	folders: StorageFolderItem[];
	isCreatingFolder: boolean;
	newFolderName: string;
	onCreateFolder: (event: FormEvent<HTMLFormElement>) => void;
	onDeleteFolder: (folder: StorageFolderItem) => void;
	onNewFolderNameChange: (value: string) => void;
	onRenameFolder: (folder: StorageFolderItem) => void;
	onSelectFolder: (folderId: string | null) => void;
	selectedFolderId: string | null;
}

export function FoldersSidebarCard({
	canCreateStorage,
	canDeleteStorage,
	canUpdateStorage,
	folderInputId,
	folders,
	isCreatingFolder,
	newFolderName,
	onCreateFolder,
	onDeleteFolder,
	onNewFolderNameChange,
	onRenameFolder,
	onSelectFolder,
	selectedFolderId,
}: FoldersSidebarCardProps) {
	const hasFolderActions = canUpdateStorage || canDeleteStorage;

	return (
		<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs">
			<CardHeader className="border-border/60 flex flex-row items-center justify-between border-b px-4 py-3">
				<CardTitle className="flex items-center gap-2 text-sm font-semibold">
					<Folder aria-hidden="true" className="text-primary h-4 w-4" />
					Folders
				</CardTitle>
				{folders.length > 0 ? (
					<span className="text-muted-foreground text-xs font-medium">
						{folders.length}
					</span>
				) : null}
			</CardHeader>
			<CardContent className="space-y-3 p-3">
				<ul className="space-y-1 text-xs">
					<li>
						<button
							className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
								selectedFolderId === null
									? "bg-primary/10 text-primary font-semibold"
									: "text-foreground hover:bg-muted/60"
							}`}
							onClick={() => onSelectFolder(null)}
							type="button"
						>
							<Layers aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
							<span className="truncate">All Files</span>
						</button>
					</li>

					{folders.map((folder) => {
						const isSelected = selectedFolderId === folder.id;
						const fileCount = folder.fileCount ?? 0;

						return (
							<li
								className={`group flex items-center justify-between gap-1 rounded-lg pr-1.5 transition-colors ${
									isSelected
										? "bg-primary/10 text-primary"
										: "text-foreground hover:bg-muted/60"
								}`}
								key={folder.id}
							>
								<button
									className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left ${
										isSelected ? "font-semibold" : "font-normal"
									}`}
									onClick={() => onSelectFolder(folder.id)}
									type="button"
								>
									{isSelected ? (
										<FolderOpen
											aria-hidden="true"
											className="h-3.5 w-3.5 shrink-0"
										/>
									) : (
										<Folder
											aria-hidden="true"
											className="h-3.5 w-3.5 shrink-0"
										/>
									)}
									<span className="truncate">{folder.name}</span>
								</button>

								<div className="flex shrink-0 items-center gap-1">
									<span className="text-muted-foreground text-[11px] tabular-nums">
										{fileCount}
									</span>

									{hasFolderActions ? (
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<button
													aria-label={`Folder actions for ${folder.name}`}
													className="text-muted-foreground hover:text-foreground hover:bg-background/80 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
													type="button"
												>
													<MoreHorizontal
														aria-hidden="true"
														className="h-3.5 w-3.5"
													/>
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" className="w-40">
												{canUpdateStorage ? (
													<DropdownMenuItem
														onClick={() => onRenameFolder(folder)}
													>
														<Pencil
															aria-hidden="true"
															className="h-3.5 w-3.5"
														/>
														Rename folder
													</DropdownMenuItem>
												) : null}
												{canDeleteStorage ? (
													<DropdownMenuItem
														onClick={() => onDeleteFolder(folder)}
														variant="destructive"
													>
														<Trash2
															aria-hidden="true"
															className="h-3.5 w-3.5"
														/>
														Delete folder
													</DropdownMenuItem>
												) : null}
											</DropdownMenuContent>
										</DropdownMenu>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>

				{canCreateStorage ? (
					<form
						className="border-border/60 flex items-center gap-1.5 border-t pt-2.5"
						onSubmit={onCreateFolder}
					>
						<Label className="sr-only" htmlFor={folderInputId}>
							New folder name
						</Label>
						<Input
							className="h-8 text-xs"
							id={folderInputId}
							maxLength={120}
							onChange={(event) => onNewFolderNameChange(event.target.value)}
							placeholder="New folder..."
							value={newFolderName}
						/>
						<Button
							aria-label="Create folder"
							className="size-8 shrink-0"
							disabled={!newFolderName.trim() || isCreatingFolder}
							size="icon"
							type="submit"
							variant="outline"
						>
							{isCreatingFolder ? (
								<Loader2
									aria-hidden="true"
									className="h-3.5 w-3.5 animate-spin"
								/>
							) : (
								<FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
							)}
						</Button>
					</form>
				) : null}
			</CardContent>
		</Card>
	);
}
