"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	formatBytes,
	isAllowedContentType,
	isRagIndexableContentType,
	STORAGE_CONFIG,
} from "@workspace/shared/storage";
import { toast } from "sonner";
import { client, parseApiResponse } from "@/lib/api-client";
import { orgHeadersInit } from "@/lib/organization-hooks";
import type {
	StorageFolderItem,
	StorageUploadItem,
} from "./files-workspace-dialogs";

export interface StorageUsageData {
	availableSpace: number;
	currentUsage: number;
	formattedCurrentUsage: string;
	formattedStorageLimit: string;
	storageLimit: number;
	usagePercent: number;
}

export interface ListUploadsResponse {
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

export async function uploadAndCommitSingleFile(params: {
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

export function useStorageQueries(params: {
	activeOrgId: string | undefined;
	searchQuery: string;
	selectedFolderId: string | null;
}) {
	const { activeOrgId, searchQuery, selectedFolderId } = params;
	const orgScope = activeOrgId ?? "none";

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

	return { foldersQuery, uploadsQuery, usageQuery };
}

export function useStorageMutations(params: {
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
