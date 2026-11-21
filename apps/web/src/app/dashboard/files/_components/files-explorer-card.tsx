"use client";

import {
	formatBytes,
	isRagIndexableContentType,
	STORAGE_CONFIG,
} from "@workspace/shared/storage";
import { Badge } from "@workspace/ui/components/badge";
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
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Download,
	FileText,
	Folder,
	FolderInput,
	FolderOpen,
	Layers,
	Loader2,
	MoreHorizontal,
	Pencil,
	Search,
	Sparkles,
	Trash2,
	X,
} from "lucide-react";
import { type DragEvent, useState } from "react";
import { formatUtcDate } from "@/lib/format";
import {
	getFileTypePresentation,
	resolveDisplayFileName,
	type StorageFolderItem,
	type StorageUploadItem,
} from "./files-workspace-dialogs";

interface FilesExplorerCardProps {
	activeFolder: StorageFolderItem | null;
	canCreateStorage: boolean;
	canDeleteStorage: boolean;
	canUpdateStorage: boolean;
	folderMap: ReadonlyMap<string, StorageFolderItem>;
	indexingUploadId: string | null;
	isPending: boolean;
	isUploading: boolean;
	onDeleteUpload: (item: StorageUploadItem) => void;
	onFilesDropped: (files: File[]) => Promise<void>;
	onIndexKnowledge: (uploadId: string) => void;
	onMoveUpload: (item: StorageUploadItem) => void;
	onRenameUpload: (item: StorageUploadItem) => void;
	onSearchQueryChange: (value: string) => void;
	onSelectFolder: (folderId: string | null) => void;
	onTriggerUpload: () => void;
	searchInputId: string;
	searchQuery: string;
	totalMatches: number;
	uploads: StorageUploadItem[];
}

export function FilesExplorerCard({
	activeFolder,
	canCreateStorage,
	canDeleteStorage,
	canUpdateStorage,
	folderMap,
	indexingUploadId,
	isPending,
	isUploading,
	onDeleteUpload,
	onFilesDropped,
	onIndexKnowledge,
	onMoveUpload,
	onRenameUpload,
	onSearchQueryChange,
	onSelectFolder,
	onTriggerUpload,
	searchInputId,
	searchQuery,
	totalMatches,
	uploads,
}: FilesExplorerCardProps) {
	const [isDragOver, setIsDragOver] = useState(false);

	const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		setIsDragOver(false);
		if (!canCreateStorage || isUploading) {
			return;
		}
		const droppedFiles = Array.from(event.dataTransfer.files ?? []);
		await onFilesDropped(droppedFiles);
	};

	return (
		<Card
			className={`border-border/60 bg-card/80 flex min-h-112 flex-col gap-0 py-0 shadow-xs transition-colors ${
				isDragOver ? "border-primary bg-primary/5 ring-primary/20 ring-2" : ""
			}`}
			onDragLeave={() => setIsDragOver(false)}
			onDragOver={(event) => {
				if (!canCreateStorage) {
					return;
				}
				event.preventDefault();
				setIsDragOver(true);
			}}
			onDrop={handleDrop}
		>
			<CardHeader className="border-border/60 flex flex-col gap-3 border-b px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-2">
					<CardTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold">
						{activeFolder ? (
							<FolderOpen
								aria-hidden="true"
								className="text-primary h-4 w-4 shrink-0"
							/>
						) : (
							<Layers
								aria-hidden="true"
								className="text-primary h-4 w-4 shrink-0"
							/>
						)}
						<span className="truncate">
							{activeFolder ? activeFolder.name : "All Files"}
						</span>
					</CardTitle>
					<Badge appearance="light" size="sm" variant="secondary">
						{totalMatches}
					</Badge>
				</div>

				<div className="relative w-full sm:w-64">
					<Label className="sr-only" htmlFor={searchInputId}>
						Search files
					</Label>
					<Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
					<Input
						className="h-8 pr-7 pl-8 text-xs"
						id={searchInputId}
						onChange={(event) => onSearchQueryChange(event.target.value)}
						placeholder="Search files..."
						value={searchQuery}
					/>
					{searchQuery ? (
						<button
							aria-label="Clear file search"
							className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 transition-colors"
							onClick={() => onSearchQueryChange("")}
							type="button"
						>
							<X aria-hidden="true" className="h-3.5 w-3.5" />
						</button>
					) : null}
				</div>
			</CardHeader>

			<CardContent className="flex-1 p-0">
				<CommittedFilesSection
					activeFolder={activeFolder}
					canCreateStorage={canCreateStorage}
					canDeleteStorage={canDeleteStorage}
					canUpdateStorage={canUpdateStorage}
					folderMap={folderMap}
					hasSearchQuery={Boolean(searchQuery.trim())}
					indexingUploadId={indexingUploadId}
					isPending={isPending}
					onDeleteUpload={onDeleteUpload}
					onIndexKnowledge={onIndexKnowledge}
					onMoveUpload={onMoveUpload}
					onRenameUpload={onRenameUpload}
					onSelectFolder={onSelectFolder}
					onTriggerUpload={onTriggerUpload}
					showFolderBadge={activeFolder === null}
					uploads={uploads}
				/>
			</CardContent>
		</Card>
	);
}

interface CommittedFilesSectionProps {
	activeFolder: StorageFolderItem | null;
	canCreateStorage: boolean;
	canDeleteStorage: boolean;
	canUpdateStorage: boolean;
	folderMap: ReadonlyMap<string, StorageFolderItem>;
	hasSearchQuery: boolean;
	indexingUploadId: string | null;
	isPending: boolean;
	onDeleteUpload: (item: StorageUploadItem) => void;
	onIndexKnowledge: (uploadId: string) => void;
	onMoveUpload: (item: StorageUploadItem) => void;
	onRenameUpload: (item: StorageUploadItem) => void;
	onSelectFolder: (folderId: string | null) => void;
	onTriggerUpload: () => void;
	showFolderBadge: boolean;
	uploads: StorageUploadItem[];
}

function resolveEmptyStateTitle(
	hasSearchQuery: boolean,
	activeFolder: StorageFolderItem | null
): string {
	if (hasSearchQuery) {
		return "No matching files";
	}
	if (activeFolder) {
		return `"${activeFolder.name}" is empty`;
	}
	return "No files uploaded yet";
}

function resolveEmptyStateDescription(
	hasSearchQuery: boolean,
	canCreateStorage: boolean
): string {
	if (hasSearchQuery) {
		return "Try a different search term or switch folders.";
	}
	if (canCreateStorage) {
		return `Drop files here or click to browse (up to ${formatBytes(STORAGE_CONFIG.MAX_FILE_SIZE)}).`;
	}
	return "No committed files are available in this view.";
}

function CommittedFilesSection({
	activeFolder,
	canCreateStorage,
	canDeleteStorage,
	canUpdateStorage,
	folderMap,
	hasSearchQuery,
	indexingUploadId,
	isPending,
	onDeleteUpload,
	onIndexKnowledge,
	onMoveUpload,
	onRenameUpload,
	onSelectFolder,
	onTriggerUpload,
	showFolderBadge,
	uploads,
}: CommittedFilesSectionProps) {
	if (isPending) {
		return (
			<div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">
				<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
				<span>Loading files...</span>
			</div>
		);
	}

	if (uploads.length === 0) {
		return (
			<div className="flex h-80 flex-col items-center justify-center p-6 text-center">
				<button
					className={`border-border/70 flex w-full max-w-md flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed p-8 transition-colors ${
						canCreateStorage && !hasSearchQuery
							? "hover:border-primary/50 hover:bg-muted/30 cursor-pointer"
							: "cursor-default"
					}`}
					disabled={!canCreateStorage || hasSearchQuery}
					onClick={onTriggerUpload}
					type="button"
				>
					<div className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-xl">
						{activeFolder ? (
							<FolderOpen aria-hidden="true" className="h-5 w-5" />
						) : (
							<FileText aria-hidden="true" className="h-5 w-5" />
						)}
					</div>
					<div className="space-y-1">
						<p className="text-foreground text-sm font-semibold">
							{resolveEmptyStateTitle(hasSearchQuery, activeFolder)}
						</p>
						<p className="text-muted-foreground text-xs leading-relaxed">
							{resolveEmptyStateDescription(hasSearchQuery, canCreateStorage)}
						</p>
					</div>
				</button>
			</div>
		);
	}

	return (
		<ul className="divide-border/60 divide-y">
			{uploads.map((item) => (
				<CommittedFileRow
					assignedFolder={
						item.folderId ? (folderMap.get(item.folderId) ?? null) : null
					}
					canCreateStorage={canCreateStorage}
					canDeleteStorage={canDeleteStorage}
					canUpdateStorage={canUpdateStorage}
					isIndexingThis={indexingUploadId === item.id}
					item={item}
					key={item.id}
					onDeleteUpload={onDeleteUpload}
					onIndexKnowledge={onIndexKnowledge}
					onMoveUpload={onMoveUpload}
					onRenameUpload={onRenameUpload}
					onSelectFolder={onSelectFolder}
					showFolderBadge={showFolderBadge}
				/>
			))}
		</ul>
	);
}

interface CommittedFileRowProps {
	assignedFolder: StorageFolderItem | null;
	canCreateStorage: boolean;
	canDeleteStorage: boolean;
	canUpdateStorage: boolean;
	isIndexingThis: boolean;
	item: StorageUploadItem;
	onDeleteUpload: (item: StorageUploadItem) => void;
	onIndexKnowledge: (uploadId: string) => void;
	onMoveUpload: (item: StorageUploadItem) => void;
	onRenameUpload: (item: StorageUploadItem) => void;
	onSelectFolder: (folderId: string | null) => void;
	showFolderBadge: boolean;
}

function CommittedFileRow({
	assignedFolder,
	canCreateStorage,
	canDeleteStorage,
	canUpdateStorage,
	isIndexingThis,
	item,
	onDeleteUpload,
	onIndexKnowledge,
	onMoveUpload,
	onRenameUpload,
	onSelectFolder,
	showFolderBadge,
}: CommittedFileRowProps) {
	const displayName = resolveDisplayFileName(item);
	const canIndex = isRagIndexableContentType(item.contentType);
	const chunkCount = item.metadata?.ragChunkCount ?? 0;
	const isIndexed = Boolean(item.metadata?.ragIndexedAt && chunkCount > 0);
	const { badgeClassName, Icon: FileTypeIcon } = getFileTypePresentation(
		item.contentType
	);

	return (
		<li className="hover:bg-muted/25 flex items-center justify-between gap-3 px-5 py-3 transition-colors">
			<div className="flex min-w-0 items-center gap-3">
				<div
					className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${badgeClassName}`}
				>
					<FileTypeIcon aria-hidden="true" className="h-4 w-4" />
				</div>

				<div className="min-w-0 space-y-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-foreground truncate text-sm font-medium">
							{displayName}
						</span>

						{showFolderBadge && assignedFolder ? (
							<button
								className="border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors"
								onClick={() => onSelectFolder(assignedFolder.id)}
								title={`View folder ${assignedFolder.name}`}
								type="button"
							>
								<Folder aria-hidden="true" className="h-3 w-3 shrink-0" />
								<span className="max-w-28 truncate">{assignedFolder.name}</span>
							</button>
						) : null}

						{isIndexed ? (
							<Badge appearance="light" size="sm" variant="primary">
								AI Indexed ({chunkCount})
							</Badge>
						) : null}
					</div>

					<div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
						<span>{formatBytes(item.size ?? 0)}</span>
						<span>·</span>
						<span>{item.contentType ?? "application/octet-stream"}</span>
						<span>·</span>
						<span>{formatUtcDate(item.createdAt)}</span>
					</div>
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-1.5">
				{canIndex && canCreateStorage && !isIndexed ? (
					<Button
						className="h-8 text-xs"
						disabled={isIndexingThis}
						onClick={() => onIndexKnowledge(item.id)}
						size="sm"
						type="button"
						variant="outline"
					>
						{isIndexingThis ? (
							<Loader2
								aria-hidden="true"
								className="h-3.5 w-3.5 animate-spin"
							/>
						) : (
							<Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
						)}
						Index AI
					</Button>
				) : null}

				<Button asChild className="h-8 text-xs" size="sm" variant="outline">
					<a
						download={displayName}
						href={item.fileUrl}
						rel="noopener noreferrer"
						target="_blank"
					>
						<Download aria-hidden="true" className="h-3.5 w-3.5" />
						Download
					</a>
				</Button>

				<FileRowActionsMenu
					canCreateStorage={canCreateStorage}
					canDeleteStorage={canDeleteStorage}
					canIndex={canIndex}
					canUpdateStorage={canUpdateStorage}
					displayName={displayName}
					isIndexed={isIndexed}
					isIndexingThis={isIndexingThis}
					item={item}
					onDeleteUpload={onDeleteUpload}
					onIndexKnowledge={onIndexKnowledge}
					onMoveUpload={onMoveUpload}
					onRenameUpload={onRenameUpload}
				/>
			</div>
		</li>
	);
}

interface FileRowActionsMenuProps {
	canCreateStorage: boolean;
	canDeleteStorage: boolean;
	canIndex: boolean;
	canUpdateStorage: boolean;
	displayName: string;
	isIndexed: boolean;
	isIndexingThis: boolean;
	item: StorageUploadItem;
	onDeleteUpload: (item: StorageUploadItem) => void;
	onIndexKnowledge: (uploadId: string) => void;
	onMoveUpload: (item: StorageUploadItem) => void;
	onRenameUpload: (item: StorageUploadItem) => void;
}

function FileRowActionsMenu({
	canCreateStorage,
	canDeleteStorage,
	canIndex,
	canUpdateStorage,
	displayName,
	isIndexed,
	isIndexingThis,
	item,
	onDeleteUpload,
	onIndexKnowledge,
	onMoveUpload,
	onRenameUpload,
}: FileRowActionsMenuProps) {
	const showIndexOption = canIndex && canCreateStorage;
	const hasMenuActions =
		canUpdateStorage || canDeleteStorage || showIndexOption;

	if (!hasMenuActions) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={`More actions for ${displayName}`}
					className="size-8"
					size="icon"
					type="button"
					variant="ghost"
				>
					<MoreHorizontal aria-hidden="true" className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				{canUpdateStorage ? (
					<>
						<DropdownMenuItem onClick={() => onRenameUpload(item)}>
							<Pencil aria-hidden="true" className="h-3.5 w-3.5" />
							Rename file
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onMoveUpload(item)}>
							<FolderInput aria-hidden="true" className="h-3.5 w-3.5" />
							Move to folder
						</DropdownMenuItem>
					</>
				) : null}

				{showIndexOption ? (
					<DropdownMenuItem
						disabled={isIndexingThis}
						onClick={() => onIndexKnowledge(item.id)}
					>
						<Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
						{isIndexed ? "Re-index for AI" : "Index for AI"}
					</DropdownMenuItem>
				) : null}

				{canDeleteStorage ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => onDeleteUpload(item)}
							variant="destructive"
						>
							<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
							Delete file
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
