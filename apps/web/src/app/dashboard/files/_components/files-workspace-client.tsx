"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	formatBytes,
	isAllowedContentType,
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
import { DeleteConfirmationDialog } from "@workspace/ui/components/delete-confirmation-dialog";
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
	ArrowLeft,
	Download,
	FileText,
	Folder,
	FolderInput,
	FolderOpen,
	FolderPlus,
	HardDrive,
	Layers,
	Loader2,
	MoreHorizontal,
	Pencil,
	Search,
	Sparkles,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import Link from "next/link";
import {
	type ChangeEvent,
	type DragEvent,
	type FormEvent,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { client, parseApiResponse } from "@/lib/api-client";
import { formatUtcDate } from "@/lib/format";
import {
	orgHeadersInit,
	useCurrentOrganization,
} from "@/lib/organization-hooks";
import {
	getFileTypePresentation,
	MoveFileFolderDialog,
	RenameDialog,
	resolveDisplayFileName,
	type StorageFolderItem,
	type StorageUploadItem,
} from "./files-workspace-dialogs";

interface StorageUsageData {
	availableSpace: number;
	currentUsage: number;
	formattedCurrentUsage: string;
	formattedStorageLimit: string;
	storageLimit: number;
	usagePercent: number;
}

interface ListUploadsResponse {
	items: StorageUploadItem[];
	pagination: {
		hasMore: boolean;
		limit: number;
		page: number;
		total: number;
		totalPages: number;
	};
}

function resolveUploadContentType(file: File): string {
	if (
		file.name.toLowerCase().endsWith(".md") &&
		(!file.type || file.type === "text/x-markdown")
	) {
		return "text/markdown";
	}
	return file.type || "text/plain";
}

function resolveQuotaBarColorClass(usagePercent: number): string {
	if (usagePercent >= 90) {
		return "bg-destructive";
	}
	if (usagePercent >= 75) {
		return "bg-amber-500";
	}
	return "bg-primary";
}

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

function resolveDeleteFolderConfirmLabel(
	folder: StorageFolderItem | null
): string {
	const count = folder?.fileCount ?? 0;
	return count > 0 ? `Delete Folder & ${count} File(s)` : "Delete Folder";
}

async function uploadAndCommitSingleFile(params: {
	activeOrgId: string | undefined;
	file: File;
	folderId: string | null;
	onIndexKnowledge: (uploadId: string) => Promise<unknown>;
}) {
	const { activeOrgId, file, folderId, onIndexKnowledge } = params;
	const contentType = resolveUploadContentType(file);
	if (!isAllowedContentType(contentType)) {
		throw new Error(`File type "${contentType}" is not allowed`);
	}
	if (file.size <= 0 || file.size > STORAGE_CONFIG.MAX_FILE_SIZE) {
		throw new Error(
			`${file.name} exceeds the ${formatBytes(STORAGE_CONFIG.MAX_FILE_SIZE)} limit`
		);
	}

	const presigned = await parseApiResponse<{
		fileKey: string;
		uploadId: string;
		url: string;
	}>(
		await client.api.storage.presign.$post(
			{
				json: {
					contentType,
					fileName: file.name,
					folderId,
					size: file.size,
				},
			},
			orgHeadersInit(activeOrgId)
		)
	);

	const putRes = await fetch(presigned.url, {
		body: file,
		headers: {
			"Content-Type": contentType,
		},
		method: "PUT",
	});

	if (!putRes.ok) {
		throw new Error(`Storage upload failed for ${file.name}`);
	}

	await parseApiResponse(
		await client.api.storage.commit.$post(
			{
				json: {
					fileKeys: [presigned.fileKey],
				},
			},
			orgHeadersInit(activeOrgId)
		)
	);

	if (isRagIndexableContentType(contentType)) {
		await onIndexKnowledge(presigned.uploadId).catch(() => null);
	}
}

function useStorageMutations(params: {
	activeOrgId: string | undefined;
	onCreatedFolder: (folder: StorageFolderItem) => void;
	onDeletedFolder: (folderId: string, deletedFilesCount: number) => void;
	onDeletedUpload: () => void;
	onMovedUpload: () => void;
	onRenamedFolder: () => void;
	onRenamedUpload: () => void;
}) {
	const queryClient = useQueryClient();
	const { activeOrgId } = params;

	const invalidateStorage = () => {
		void queryClient.invalidateQueries({
			queryKey: ["storage"],
		});
	};

	const createFolderMutation = useMutation({
		mutationFn: async (name: string) =>
			parseApiResponse<StorageFolderItem>(
				await client.api.storage.folders.$post(
					{ json: { name } },
					orgHeadersInit(activeOrgId)
				)
			),
		onError: (err: Error) => {
			toast.error(err.message || "Failed to create folder");
		},
		onSuccess: (created) => {
			toast.success(`Folder "${created.name}" created`);
			params.onCreatedFolder(created);
			invalidateStorage();
		},
	});

	const renameFolderMutation = useMutation({
		mutationFn: async ({ id, name }: { id: string; name: string }) =>
			parseApiResponse<StorageFolderItem>(
				await client.api.storage.folders[":id"].$patch(
					{ json: { name }, param: { id } },
					orgHeadersInit(activeOrgId)
				)
			),
		onError: (err: Error) => {
			toast.error(err.message || "Failed to rename folder");
		},
		onSuccess: (updated) => {
			toast.success(`Folder renamed to "${updated.name}"`);
			params.onRenamedFolder();
			invalidateStorage();
		},
	});

	const deleteFolderMutation = useMutation({
		mutationFn: async (folderId: string) =>
			parseApiResponse<{
				deletedBytes: number;
				deletedFilesCount: number;
				id: string;
				success: boolean;
			}>(
				await client.api.storage.folders[":id"].$delete(
					{ param: { id: folderId } },
					orgHeadersInit(activeOrgId)
				)
			),
		onError: (err: Error) => {
			toast.error(err.message || "Failed to delete folder");
		},
		onSuccess: (result) => {
			params.onDeletedFolder(result.id, result.deletedFilesCount);
			invalidateStorage();
		},
	});

	const updateUploadMutation = useMutation({
		mutationFn: async ({
			fileName,
			folderId,
			id,
		}: {
			fileName?: string;
			folderId?: string | null;
			id: string;
		}) =>
			parseApiResponse<StorageUploadItem>(
				await client.api.storage.files[":id"].$patch(
					{
						json: {
							...(fileName === undefined ? {} : { fileName }),
							...(folderId === undefined ? {} : { folderId }),
						},
						param: { id },
					},
					orgHeadersInit(activeOrgId)
				)
			),
		onError: (err: Error) => {
			toast.error(err.message || "Failed to update file");
		},
		onSuccess: (_updated, variables) => {
			if (variables.fileName !== undefined) {
				toast.success("File renamed");
				params.onRenamedUpload();
			}
			if (variables.folderId !== undefined) {
				toast.success("File moved");
				params.onMovedUpload();
			}
			invalidateStorage();
		},
	});

	const indexKnowledgeMutation = useMutation({
		mutationFn: async (uploadId: string) =>
			parseApiResponse<{ chunkCount: number; id: string; indexed: boolean }>(
				await client.api.storage.files[":id"].index.$post(
					{ param: { id: uploadId } },
					orgHeadersInit(activeOrgId)
				)
			),
		onError: (err: Error) => {
			toast.error(err.message || "Could not index file for AI search");
		},
		onSuccess: (result) => {
			if (result.indexed) {
				toast.success(
					`Indexed ${result.chunkCount} knowledge chunks for AI search`
				);
			} else {
				toast.info(
					"File saved (configure an embedding API key to enable pgvector indexing)"
				);
			}
			invalidateStorage();
		},
	});

	const deleteUploadMutation = useMutation({
		mutationFn: async (uploadId: string) =>
			parseApiResponse<{ id: string; success: boolean }>(
				await client.api.storage.files[":id"].$delete(
					{ param: { id: uploadId } },
					orgHeadersInit(activeOrgId)
				)
			),
		onError: (err: Error) => {
			toast.error(err.message || "Failed to delete file");
		},
		onSuccess: () => {
			toast.success("File deleted");
			params.onDeletedUpload();
			invalidateStorage();
		},
	});

	return {
		createFolderMutation,
		deleteFolderMutation,
		deleteUploadMutation,
		indexKnowledgeMutation,
		invalidateStorage,
		renameFolderMutation,
		updateUploadMutation,
	};
}

export function FilesWorkspaceClient() {
	const searchInputId = useId();
	const folderInputId = useId();
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const { activeOrg, activeOrgId, hasPermission } = useCurrentOrganization();
	const orgScope = activeOrgId ?? "none";

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

	const usageQuery = useQuery<StorageUsageData>({
		enabled: Boolean(activeOrgId),
		queryFn: async () =>
			parseApiResponse<StorageUsageData>(
				await client.api.storage.usage.$get(
					undefined,
					orgHeadersInit(activeOrgId)
				)
			),
		queryKey: ["storage", "usage", orgScope],
	});

	const foldersQuery = useQuery<StorageFolderItem[]>({
		enabled: Boolean(activeOrgId),
		queryFn: async () =>
			parseApiResponse<StorageFolderItem[]>(
				await client.api.storage.folders.$get(
					undefined,
					orgHeadersInit(activeOrgId)
				)
			),
		queryKey: ["storage", "folders", orgScope],
	});

	const uploadsQuery = useQuery<ListUploadsResponse>({
		enabled: Boolean(activeOrgId),
		queryFn: async () =>
			parseApiResponse<ListUploadsResponse>(
				await client.api.storage.$get(
					{
						query: {
							...(selectedFolderId ? { folderId: selectedFolderId } : {}),
							limit: "50",
							page: "1",
							...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
							status: "committed",
						},
					},
					orgHeadersInit(activeOrgId)
				)
			),
		queryKey: [
			"storage",
			"uploads",
			orgScope,
			selectedFolderId ?? "all",
			searchQuery.trim(),
		],
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

	const usage = usageQuery.data;
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

	return (
		<div className="flex flex-col gap-6">
			{/* Top Header Banner */}
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
				{/* Left Column: Quota + Folders */}
				<div className="flex flex-col gap-4">
					<StorageQuotaCard usage={usage} />

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

				{/* Right Column: File Explorer */}
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
					if (!folderToRename) {
						return;
					}
					await renameFolderMutation.mutateAsync({
						id: folderToRename.id,
						name,
					});
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
					if (!uploadToRename) {
						return;
					}
					await updateUploadMutation.mutateAsync({
						fileName,
						id: uploadToRename.id,
					});
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
					if (!uploadToDelete) {
						return;
					}
					await deleteUploadMutation.mutateAsync(uploadToDelete.id);
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
				confirmLabel={resolveDeleteFolderConfirmLabel(folderToDelete)}
				description={resolveDeleteFolderDescription(folderToDelete)}
				onConfirm={async () => {
					if (!folderToDelete) {
						return;
					}
					await deleteFolderMutation.mutateAsync(folderToDelete.id);
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

function StorageQuotaCard({ usage }: { usage: StorageUsageData | undefined }) {
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

function FilesExplorerCard({
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

function FoldersSidebarCard({
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
