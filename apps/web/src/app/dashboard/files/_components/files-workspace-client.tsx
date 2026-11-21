"use client";

import { STORAGE_CONFIG } from "@workspace/shared/storage";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
import { ArrowLeft, FileText, FolderOpen, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import {
	type ChangeEvent,
	type FormEvent,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useCurrentOrganization } from "@/lib/organization-hooks";
import { FilesExplorerCard } from "./files-explorer-card";
import {
	MoveFileFolderDialog,
	RenameDialog,
	resolveDisplayFileName,
	type StorageFolderItem,
	type StorageUploadItem,
} from "./files-workspace-dialogs";
import { FoldersSidebarCard, StorageQuotaCard } from "./folders-sidebar";
import {
	uploadAndCommitSingleFile,
	useStorageMutations,
	useStorageQueries,
} from "./use-storage-workspace";

function resolveDeleteFolderDescription(
	folder: StorageFolderItem | null
): string {
	if (!folder) {
		return "";
	}
	const count = folder.fileCount ?? 0;
	if (count > 0) {
		return `Are you sure you want to delete "${folder.name}"? This will permanently delete the folder and all ${count} file(s) inside it from object storage and AI knowledge vectors.`;
	}
	return `Are you sure you want to permanently delete the empty folder "${folder.name}"?`;
}

export function FilesWorkspaceClient() {
	const searchInputId = useId();
	const folderInputId = useId();
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const { activeOrg, activeOrgId, hasPermission } = useCurrentOrganization();
	const canCreateStorage = hasPermission("storage:create");
	const canUpdateStorage =
		hasPermission("storage:update") || hasPermission("storage:create");
	const canDeleteStorage = hasPermission("storage:delete");

	const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [newFolderName, setNewFolderName] = useState("");
	const [isUploading, setIsUploading] = useState(false);

	const [uploadToDelete, setUploadToDelete] =
		useState<StorageUploadItem | null>(null);
	const [uploadToRename, setUploadToRename] =
		useState<StorageUploadItem | null>(null);
	const [uploadToMove, setUploadToMove] = useState<StorageUploadItem | null>(
		null
	);
	const [folderToRename, setFolderToRename] =
		useState<StorageFolderItem | null>(null);
	const [folderToDelete, setFolderToDelete] =
		useState<StorageFolderItem | null>(null);

	const { foldersQuery, uploadsQuery, usageQuery } = useStorageQueries({
		activeOrgId,
		searchQuery,
		selectedFolderId,
	});

	const {
		createFolderMutation,
		deleteFolderMutation,
		deleteUploadMutation,
		indexKnowledgeMutation,
		invalidateStorage,
		renameFolderMutation,
		updateUploadMutation,
	} = useStorageMutations({
		activeOrgId,
		onCreatedFolder: (created) => {
			setNewFolderName("");
			setSelectedFolderId(created.id);
		},
		onDeletedFolder: (deletedId, deletedFilesCount) => {
			if (selectedFolderId === deletedId) {
				setSelectedFolderId(null);
			}
			setFolderToDelete(null);
			toast.success(
				deletedFilesCount > 0
					? `Folder and ${deletedFilesCount} file(s) permanently deleted`
					: "Folder deleted"
			);
		},
		onDeletedUpload: () => setUploadToDelete(null),
		onMovedUpload: () => setUploadToMove(null),
		onRenamedFolder: () => setFolderToRename(null),
		onRenamedUpload: () => setUploadToRename(null),
	});

	const handleCreateFolder = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = newFolderName.trim();
		if (!trimmed || createFolderMutation.isPending) {
			return;
		}
		createFolderMutation.mutate(trimmed);
	};

	const processSelectedFiles = async (files: File[]) => {
		if (files.length === 0 || !activeOrgId || !canCreateStorage) {
			return;
		}
		setIsUploading(true);
		try {
			for (const file of files) {
				// Sequential presign -> PUT -> commit keeps quota locking deterministic
				// biome-ignore lint/performance/noAwaitInLoops: sequential per-file S3 upload + commit
				await uploadAndCommitSingleFile({
					activeOrgId,
					file,
					folderId: selectedFolderId,
					onIndexKnowledge: (uploadId) =>
						indexKnowledgeMutation.mutateAsync(uploadId),
				});
			}
			toast.success(
				files.length === 1 ? "File uploaded" : `${files.length} files uploaded`
			);
			invalidateStorage();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "File upload failed"
			);
		} finally {
			setIsUploading(false);
		}
	};

	const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
		const fileList = event.target.files;
		if (!fileList || fileList.length === 0) {
			return;
		}
		const files = Array.from(fileList);
		event.target.value = "";
		await processSelectedFiles(files);
	};

	const folders = foldersQuery.data ?? [];
	const uploads = uploadsQuery.data?.items ?? [];
	const totalMatches = uploadsQuery.data?.pagination.total ?? uploads.length;

	const folderMap = useMemo(() => {
		const map = new Map<string, StorageFolderItem>();
		for (const folder of folders) {
			map.set(folder.id, folder);
		}
		return map;
	}, [folders]);

	const activeFolder = selectedFolderId
		? (folderMap.get(selectedFolderId) ?? null)
		: null;
	const folderDeleteCount = folderToDelete?.fileCount ?? 0;

	return (
		<div className="flex flex-col gap-6">
			<div className="border-border/70 bg-card/70 relative overflow-hidden rounded-2xl border p-6 shadow-xs backdrop-blur-md">
				<div className="from-primary/10 via-primary/5 dark:from-primary/15 pointer-events-none absolute inset-0 bg-linear-to-r to-transparent" />
				<div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div className="space-y-1.5">
						<Link
							className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
							href="/dashboard"
						>
							<ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
							Back to Workspace
						</Link>
						<div className="flex flex-wrap items-center gap-2.5">
							<h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
								Files & Knowledge
							</h1>
							{activeOrg ? (
								<Badge appearance="light" size="sm" variant="primary">
									{activeOrg.name}
								</Badge>
							) : null}
						</div>
						<p className="text-muted-foreground max-w-2xl text-sm">
							Private S3 storage with folder organization and tenant-scoped
							pgvector indexing for AI search.
						</p>
					</div>

					<div className="flex shrink-0 items-center gap-2">
						<input
							accept={`${STORAGE_CONFIG.ALLOWED_CONTENT_TYPES.join(",")},.md`}
							className="hidden"
							multiple
							onChange={handleFilesSelected}
							ref={fileInputRef}
							type="file"
						/>
						<Button
							disabled={!canCreateStorage || isUploading}
							onClick={() => fileInputRef.current?.click()}
							size="sm"
							type="button"
						>
							{isUploading ? (
								<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
							) : (
								<Upload aria-hidden="true" className="h-4 w-4" />
							)}
							{isUploading ? "Uploading..." : "Upload Files"}
						</Button>
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
				<div className="flex flex-col gap-4">
					<StorageQuotaCard usage={usageQuery.data} />
					<FoldersSidebarCard
						canCreateStorage={canCreateStorage}
						canDeleteStorage={canDeleteStorage}
						canUpdateStorage={canUpdateStorage}
						folderInputId={folderInputId}
						folders={folders}
						isCreatingFolder={createFolderMutation.isPending}
						newFolderName={newFolderName}
						onCreateFolder={handleCreateFolder}
						onDeleteFolder={setFolderToDelete}
						onNewFolderNameChange={setNewFolderName}
						onRenameFolder={setFolderToRename}
						onSelectFolder={setSelectedFolderId}
						selectedFolderId={selectedFolderId}
					/>
				</div>

				<FilesExplorerCard
					activeFolder={activeFolder}
					canCreateStorage={canCreateStorage}
					canDeleteStorage={canDeleteStorage}
					canUpdateStorage={canUpdateStorage}
					folderMap={folderMap}
					indexingUploadId={
						indexKnowledgeMutation.isPending
							? (indexKnowledgeMutation.variables ?? null)
							: null
					}
					isPending={uploadsQuery.isPending}
					isUploading={isUploading}
					onDeleteUpload={setUploadToDelete}
					onFilesDropped={processSelectedFiles}
					onIndexKnowledge={(uploadId) =>
						indexKnowledgeMutation.mutate(uploadId)
					}
					onMoveUpload={setUploadToMove}
					onRenameUpload={setUploadToRename}
					onSearchQueryChange={setSearchQuery}
					onSelectFolder={setSelectedFolderId}
					onTriggerUpload={() => fileInputRef.current?.click()}
					searchInputId={searchInputId}
					searchQuery={searchQuery}
					totalMatches={totalMatches}
					uploads={uploads}
				/>
			</div>

			<RenameDialog
				description={
					<>
						Enter a new name for{" "}
						<span className="text-foreground font-medium">
							{folderToRename?.name ?? "this folder"}
						</span>
						. Files inside will remain assigned to this folder.
					</>
				}
				fieldLabel="Folder name"
				Icon={FolderOpen}
				initialValue={folderToRename?.name ?? ""}
				isPending={renameFolderMutation.isPending}
				maxLength={120}
				onClose={() => setFolderToRename(null)}
				onSubmit={async (name) => {
					if (folderToRename) {
						await renameFolderMutation.mutateAsync({
							id: folderToRename.id,
							name,
						});
					}
				}}
				open={Boolean(folderToRename)}
				placeholder="e.g. Contracts & Legal"
				title="Rename Folder"
			/>

			<RenameDialog
				description="Update the display name used across your workspace and downloads."
				fieldLabel="File name"
				Icon={FileText}
				initialValue={
					uploadToRename ? resolveDisplayFileName(uploadToRename) : ""
				}
				isPending={updateUploadMutation.isPending}
				maxLength={255}
				onClose={() => setUploadToRename(null)}
				onSubmit={async (fileName) => {
					if (uploadToRename) {
						await updateUploadMutation.mutateAsync({
							fileName,
							id: uploadToRename.id,
						});
					}
				}}
				open={Boolean(uploadToRename)}
				placeholder="Enter file name..."
				title="Rename File"
			/>

			<MoveFileFolderDialog
				folders={folders}
				isPending={updateUploadMutation.isPending}
				onClose={() => setUploadToMove(null)}
				onSubmit={async ({ folderId, id }) => {
					await updateUploadMutation.mutateAsync({ folderId, id });
				}}
				upload={uploadToMove}
			/>

			<DeleteConfirmationDialog
				confirmLabel="Delete File"
				description={`Are you sure you want to permanently delete "${
					uploadToDelete ? resolveDisplayFileName(uploadToDelete) : ""
				}" from workspace storage and remove its AI knowledge vectors?`}
				onConfirm={async () => {
					if (uploadToDelete) {
						await deleteUploadMutation.mutateAsync(uploadToDelete.id);
					}
				}}
				onOpenChange={(open) => {
					if (!open) {
						setUploadToDelete(null);
					}
				}}
				open={Boolean(uploadToDelete)}
				title="Delete File"
			/>

			<DeleteConfirmationDialog
				confirmLabel={
					folderDeleteCount > 0
						? `Delete Folder & ${folderDeleteCount} File(s)`
						: "Delete Folder"
				}
				description={resolveDeleteFolderDescription(folderToDelete)}
				onConfirm={async () => {
					if (folderToDelete) {
						await deleteFolderMutation.mutateAsync(folderToDelete.id);
					}
				}}
				onOpenChange={(open) => {
					if (!open) {
						setFolderToDelete(null);
					}
				}}
				open={Boolean(folderToDelete)}
				title="Delete Folder"
			/>
		</div>
	);
}
