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
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	ArrowLeft,
	Database,
	Download,
	FileText,
	Folder,
	FolderPlus,
	HardDrive,
	Loader2,
	Search,
	Sparkles,
	Trash2,
	Upload,
} from "lucide-react";
import Link from "next/link";
import {
	type ChangeEvent,
	type FormEvent,
	useId,
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

interface StorageUsageData {
	availableSpace: number;
	currentUsage: number;
	formattedCurrentUsage: string;
	formattedStorageLimit: string;
	storageLimit: number;
	usagePercent: number;
}

interface StorageFolderItem {
	createdAt: string;
	id: string;
	name: string;
	organizationId: string;
	parentId: string | null;
}

interface StorageUploadItem {
	contentType: string | null;
	createdAt: string;
	fileKey: string;
	fileUrl: string;
	folderId: string | null;
	id: string;
	metadata: {
		originalName?: string;
		ragChunkCount?: number;
		ragIndexedAt?: string | null;
		[key: string]: unknown;
	} | null;
	size: number | null;
	status: "pending" | "committed" | "failed";
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

function resolveDisplayFileName(item: StorageUploadItem): string {
	const metaName = item.metadata?.originalName;
	if (typeof metaName === "string" && metaName.trim().length > 0) {
		return metaName.trim();
	}
	return item.fileKey.split("/").at(-1) || item.fileKey;
}

export function FilesWorkspaceClient() {
	const queryClient = useQueryClient();
	const searchInputId = useId();
	const folderInputId = useId();
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const { activeOrg, activeOrgId, hasPermission } = useCurrentOrganization();
	const orgScope = activeOrgId ?? "none";

	const canCreateStorage = hasPermission("storage:create");
	const canDeleteStorage = hasPermission("storage:delete");

	const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(
		undefined
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [newFolderName, setNewFolderName] = useState("");
	const [isUploading, setIsUploading] = useState(false);
	const [uploadToDelete, setUploadToDelete] =
		useState<StorageUploadItem | null>(null);

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
		onSuccess: () => {
			setNewFolderName("");
			toast.success("Folder created");
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
			setUploadToDelete(null);
			toast.success("File deleted from storage");
			invalidateStorage();
		},
	});

	const handleCreateFolder = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = newFolderName.trim();
		if (!trimmed || createFolderMutation.isPending) {
			return;
		}
		createFolderMutation.mutate(trimmed);
	};

	const uploadSingleFile = async (file: File) => {
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
						folderId: selectedFolderId ?? null,
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
			await indexKnowledgeMutation
				.mutateAsync(presigned.uploadId)
				.catch(() => null);
		}
	};

	const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>) => {
		const fileList = event.target.files;
		if (!fileList || fileList.length === 0 || !activeOrgId) {
			return;
		}
		const files = Array.from(fileList);
		event.target.value = "";
		setIsUploading(true);

		try {
			for (const file of files) {
				// Sequential presign -> PUT -> commit keeps quota locking deterministic
				// biome-ignore lint/performance/noAwaitInLoops: sequential per-file S3 upload + commit
				await uploadSingleFile(file);
			}
			toast.success(
				files.length === 1
					? "File uploaded and committed"
					: `${files.length} files uploaded and committed`
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

	const usage = usageQuery.data;
	const folders = foldersQuery.data ?? [];
	const uploads = uploadsQuery.data?.items ?? [];

	return (
		<div className="flex flex-col gap-6">
			{/* Top Header Banner */}
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
								Workspace Files & RAG Knowledge
							</h1>
							{activeOrg ? (
								<Badge appearance="light" size="sm" variant="primary">
									{activeOrg.name}
								</Badge>
							) : null}
							<Badge appearance="light" size="sm" variant="secondary">
								Private S3 + pgvector
							</Badge>
						</div>
						<p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
							Upload private documents to S3/MinIO storage. PDF, Markdown, plain
							text, CSV, and JSON files can be indexed into tenant-scoped
							pgvector embeddings for AI Assistant knowledge search.
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
					<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs">
						<CardHeader className="border-border/60 flex flex-row items-center justify-between border-b px-4 py-3">
							<CardTitle className="flex items-center gap-2 text-sm font-semibold">
								<HardDrive
									aria-hidden="true"
									className="text-primary h-4 w-4"
								/>
								Storage Quota
							</CardTitle>
							<span className="text-muted-foreground text-xs font-medium">
								{usage ? `${usage.usagePercent}%` : "..."}
							</span>
						</CardHeader>
						<CardContent className="space-y-2.5 p-4 text-xs">
							<div className="bg-muted h-2 w-full overflow-hidden rounded-full">
								<div
									className="bg-primary h-full rounded-full transition-all"
									style={{
										width: `${Math.min(100, usage?.usagePercent ?? 0)}%`,
									}}
								/>
							</div>
							<div className="text-muted-foreground flex items-center justify-between">
								<span>{usage?.formattedCurrentUsage ?? "0 Bytes"} used</span>
								<span>{usage?.formattedStorageLimit ?? "1 GB"} limit</span>
							</div>
						</CardContent>
					</Card>

					<Card className="border-border/60 bg-card/70 gap-0 py-0 shadow-xs">
						<CardHeader className="border-border/60 border-b px-4 py-3">
							<CardTitle className="flex items-center gap-2 text-sm font-semibold">
								<Folder aria-hidden="true" className="text-primary h-4 w-4" />
								Folders
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3 p-3">
							<ul className="space-y-1 text-xs">
								<li>
									<button
										className={`w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${
											selectedFolderId === undefined
												? "bg-primary/10 text-primary font-medium"
												: "text-foreground hover:bg-muted/60"
										}`}
										onClick={() => setSelectedFolderId(undefined)}
										type="button"
									>
										All Workspace Files
									</button>
								</li>
								{folders.map((folder) => (
									<li key={folder.id}>
										<button
											className={`flex w-full items-center gap-2 truncate rounded-lg px-2.5 py-1.5 text-left transition-colors ${
												selectedFolderId === folder.id
													? "bg-primary/10 text-primary font-medium"
													: "text-foreground hover:bg-muted/60"
											}`}
											onClick={() => setSelectedFolderId(folder.id)}
											type="button"
										>
											<Folder
												aria-hidden="true"
												className="h-3.5 w-3.5 shrink-0"
											/>
											<span className="truncate">{folder.name}</span>
										</button>
									</li>
								))}
							</ul>

							{canCreateStorage ? (
								<form
									className="border-border/60 flex items-center gap-1.5 border-t pt-2.5"
									onSubmit={handleCreateFolder}
								>
									<Label className="sr-only" htmlFor={folderInputId}>
										New folder name
									</Label>
									<Input
										className="h-8 text-xs"
										id={folderInputId}
										onChange={(event) => setNewFolderName(event.target.value)}
										placeholder="New folder..."
										value={newFolderName}
									/>
									<Button
										aria-label="Create folder"
										className="size-8 shrink-0"
										disabled={
											!newFolderName.trim() || createFolderMutation.isPending
										}
										size="icon"
										type="submit"
										variant="outline"
									>
										<FolderPlus aria-hidden="true" className="h-3.5 w-3.5" />
									</Button>
								</form>
							) : null}
						</CardContent>
					</Card>
				</div>

				{/* Right Column: File List */}
				<Card className="border-border/60 bg-card/80 flex min-h-112 flex-col gap-0 py-0 shadow-xs">
					<CardHeader className="border-border/60 flex flex-col gap-3 border-b px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
						<CardTitle className="flex items-center gap-2 text-sm font-semibold">
							<Database aria-hidden="true" className="text-primary h-4 w-4" />
							Committed Files ({uploads.length})
						</CardTitle>
						<div className="relative w-full sm:w-64">
							<Label className="sr-only" htmlFor={searchInputId}>
								Search files
							</Label>
							<Search className="text-muted-foreground absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" />
							<Input
								className="h-8 pl-8 text-xs"
								id={searchInputId}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder="Search files..."
								value={searchQuery}
							/>
						</div>
					</CardHeader>

					<CardContent className="flex-1 p-0">
						<CommittedFilesSection
							canCreateStorage={canCreateStorage}
							canDeleteStorage={canDeleteStorage}
							indexingUploadId={
								indexKnowledgeMutation.isPending
									? (indexKnowledgeMutation.variables ?? null)
									: null
							}
							isPending={uploadsQuery.isPending}
							onDeleteUpload={setUploadToDelete}
							onIndexKnowledge={(uploadId) =>
								indexKnowledgeMutation.mutate(uploadId)
							}
							uploads={uploads}
						/>
					</CardContent>
				</Card>
			</div>

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
				title="Delete Workspace File"
			/>
		</div>
	);
}

interface CommittedFilesSectionProps {
	canCreateStorage: boolean;
	canDeleteStorage: boolean;
	indexingUploadId: string | null;
	isPending: boolean;
	onDeleteUpload: (item: StorageUploadItem) => void;
	onIndexKnowledge: (uploadId: string) => void;
	uploads: StorageUploadItem[];
}

function CommittedFilesSection({
	canCreateStorage,
	canDeleteStorage,
	indexingUploadId,
	isPending,
	onDeleteUpload,
	onIndexKnowledge,
	uploads,
}: CommittedFilesSectionProps) {
	if (isPending) {
		return (
			<div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">
				<Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
				<span>Loading workspace files...</span>
			</div>
		);
	}

	if (uploads.length === 0) {
		return (
			<div className="flex h-72 flex-col items-center justify-center gap-3 p-6 text-center">
				<div className="bg-primary/10 text-primary flex h-11 w-11 items-center justify-center rounded-2xl">
					<FileText aria-hidden="true" className="h-5 w-5" />
				</div>
				<div className="max-w-sm space-y-1">
					<p className="text-foreground text-sm font-semibold">
						No committed files found
					</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Upload PDFs, images, or text/CSV/JSON knowledge files to make them
						available across your workspace and AI Assistant.
					</p>
				</div>
			</div>
		);
	}

	return (
		<ul className="divide-border/60 divide-y">
			{uploads.map((item) => {
				const displayName = resolveDisplayFileName(item);
				const canIndex = isRagIndexableContentType(item.contentType);
				const chunkCount = item.metadata?.ragChunkCount ?? 0;
				const isIndexed = Boolean(
					item.metadata?.ragIndexedAt && chunkCount > 0
				);
				const isIndexingThis = indexingUploadId === item.id;

				return (
					<li
						className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
						key={item.id}
					>
						<div className="min-w-0 space-y-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-foreground truncate text-sm font-medium">
									{displayName}
								</span>
								<Badge appearance="light" size="sm" variant="secondary">
									{formatBytes(item.size ?? 0)}
								</Badge>
								{isIndexed ? (
									<Badge appearance="light" size="sm" variant="primary">
										AI Indexed ({chunkCount} chunks)
									</Badge>
								) : null}
							</div>
							<div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
								<span>{item.contentType ?? "application/octet-stream"}</span>
								<span>•</span>
								<span>Uploaded {formatUtcDate(item.createdAt)}</span>
							</div>
						</div>

						<div className="flex shrink-0 items-center gap-2">
							{canIndex && canCreateStorage ? (
								<Button
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
									{isIndexed ? "Re-index AI" : "Index for AI"}
								</Button>
							) : null}

							<Button asChild size="sm" variant="outline">
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

							{canDeleteStorage ? (
								<Button
									aria-label={`Delete ${displayName}`}
									className="text-muted-foreground hover:text-destructive size-8"
									onClick={() => onDeleteUpload(item)}
									size="icon"
									type="button"
									variant="ghost"
								>
									<Trash2 aria-hidden="true" className="h-4 w-4" />
								</Button>
							) : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
