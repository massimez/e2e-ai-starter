"use client";

import { extractErrorMessage } from "@workspace/ui/lib/utils";
import {
	CheckCircle2,
	Copy,
	FileIcon,
	Loader2,
	UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./button";

const BYTES_PER_KB = 1024;
const DEFAULT_MAX_FILE_SIZE = 10 * BYTES_PER_KB * BYTES_PER_KB;
const DEFAULT_ALLOWED_CONTENT_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"image/gif",
	"application/pdf",
	"text/plain",
	"text/csv",
	"application/json",
] as const;

function formatFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 Bytes";
	}
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"] as const;
	const i = Math.min(
		Math.floor(Math.log(bytes) / Math.log(BYTES_PER_KB)),
		sizes.length - 1
	);
	return `${Number.parseFloat((bytes / BYTES_PER_KB ** i).toFixed(2))} ${sizes[i]}`;
}

function isAllowedMimeType(
	contentType: string,
	allowedTypes: readonly string[]
): boolean {
	const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return allowedTypes.includes(normalized);
}

export interface UploadedFileRecord {
	fileKey: string;
	fileName: string;
	publicUrl: string;
	size: number;
}

export interface StorageDropzoneProps {
	allowedContentTypes?: readonly string[];
	apiUrl?: string;
	maxSizeBytes?: number;
	onUploadComplete?: (file: UploadedFileRecord) => void;
}

async function performPresignedUpload(options: {
	apiUrl: string;
	file: File;
	onProgress: (progress: number) => void;
	signal: AbortSignal;
}): Promise<UploadedFileRecord> {
	const { apiUrl, file, onProgress, signal } = options;

	onProgress(10);
	const presignRes = await fetch(`${apiUrl}/api/storage/presign`, {
		body: JSON.stringify({
			contentType: file.type,
			fileName: file.name,
			size: file.size,
		}),
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		method: "POST",
		signal,
	});

	if (!presignRes.ok) {
		throw new Error(
			await extractErrorMessage(
				presignRes,
				"Failed to generate presigned upload URL"
			)
		);
	}

	const presignData = (await presignRes.json()) as {
		data: {
			fileKey: string;
			fileUrl?: string;
			publicUrl: string;
			url: string;
		};
	};
	const { url: uploadUrl, fileKey, fileUrl, publicUrl } = presignData.data;

	onProgress(40);
	const s3Res = await fetch(uploadUrl, {
		body: file,
		headers: { "Content-Type": file.type },
		method: "PUT",
		signal,
	});

	if (!s3Res.ok) {
		throw new Error("Failed to transfer file to storage bucket");
	}

	onProgress(80);
	const commitRes = await fetch(`${apiUrl}/api/storage/commit`, {
		body: JSON.stringify({ fileKeys: [fileKey] }),
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		method: "POST",
		signal,
	});

	if (!commitRes.ok) {
		throw new Error(
			await extractErrorMessage(commitRes, "Failed to commit upload status")
		);
	}

	onProgress(100);
	return {
		fileKey,
		fileName: file.name,
		publicUrl: fileUrl ?? publicUrl,
		size: file.size,
	};
}

export function StorageDropzone({
	allowedContentTypes = DEFAULT_ALLOWED_CONTENT_TYPES,
	apiUrl = "",
	maxSizeBytes = DEFAULT_MAX_FILE_SIZE,
	onUploadComplete,
}: StorageDropzoneProps) {
	const inputId = useId();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);
	const [uploadedFiles, setUploadedFiles] = useState<UploadedFileRecord[]>([]);

	useEffect(
		() => () => {
			abortControllerRef.current?.abort();
		},
		[]
	);

	const handleUpload = useCallback(
		async (file: File) => {
			if (
				!Number.isFinite(file.size) ||
				file.size <= 0 ||
				file.size > maxSizeBytes
			) {
				toast.error(`File size exceeds ${formatFileSize(maxSizeBytes)} limit.`);
				return;
			}
			if (!(file.type && isAllowedMimeType(file.type, allowedContentTypes))) {
				toast.error(
					`Unsupported file type (${file.type || "unknown"}). Allowed formats: PNG, JPEG, WebP, PDF, TXT, CSV.`
				);
				return;
			}

			abortControllerRef.current?.abort();
			const controller = new AbortController();
			abortControllerRef.current = controller;

			setIsUploading(true);
			try {
				const record = await performPresignedUpload({
					apiUrl,
					file,
					onProgress: setUploadProgress,
					signal: controller.signal,
				});
				setUploadedFiles((prev) => [record, ...prev]);
				onUploadComplete?.(record);
				toast.success(`"${file.name}" uploaded successfully!`);
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				toast.error(
					error instanceof Error ? error.message : "Upload failed unexpectedly"
				);
			} finally {
				if (fileInputRef.current) {
					fileInputRef.current.value = "";
				}
				setIsUploading(false);
				setUploadProgress(0);
			}
		},
		[allowedContentTypes, apiUrl, maxSizeBytes, onUploadComplete]
	);

	const handleFiles = (fileList: FileList | File[]) => {
		const files = Array.from(fileList);
		if (files.length === 0) {
			return;
		}
		if (files.length > 1) {
			toast.info("Multiple files selected. Uploading the first file only.");
		}
		const [firstFile] = files;
		if (firstFile) {
			void handleUpload(firstFile);
		}
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		handleFiles(e.dataTransfer.files);
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files) {
			handleFiles(e.target.files);
		}
		e.target.value = "";
	};

	const copyUrl = async (url: string) => {
		const resolved =
			url.startsWith("/") && typeof window !== "undefined"
				? `${window.location.origin}${url}`
				: url;
		try {
			await navigator.clipboard.writeText(resolved);
			toast.success("File URL copied to clipboard!");
		} catch {
			toast.error("Failed to copy URL to clipboard");
		}
	};

	return (
		<div className="space-y-5">
			<button
				aria-label="Upload cloud assets"
				className={`group focus-visible:ring-ring relative flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 focus-visible:ring-2 focus-visible:outline-hidden ${
					isDragging
						? "border-primary bg-primary/5 scale-[1.01]"
						: "border-border/70 bg-card/40 hover:border-primary/50 hover:bg-card/70"
				}`}
				disabled={isUploading}
				onClick={() => fileInputRef.current?.click()}
				onDragLeave={() => setIsDragging(false)}
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragging(true);
				}}
				onDrop={handleDrop}
				type="button"
			>
				<input
					accept={allowedContentTypes.join(",")}
					className="hidden"
					disabled={isUploading}
					id={inputId}
					onChange={handleFileSelect}
					ref={fileInputRef}
					type="file"
				/>

				<div className="border-primary/20 from-primary/20 via-primary/10 to-primary/5 text-primary mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border bg-linear-to-br shadow-xs transition-transform duration-300 group-hover:scale-110">
					{isUploading ? (
						<Loader2 className="h-7 w-7 animate-spin" />
					) : (
						<UploadCloud className="h-7 w-7" />
					)}
				</div>

				<h3 className="text-foreground mb-1.5 text-sm font-bold sm:text-base">
					{isUploading
						? `Uploading to Cloud Storage... ${uploadProgress}%`
						: "Drag and drop cloud assets, or click to browse"}
				</h3>
				<p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
					Direct presigned S3 / MinIO upload • Private by default • Max{" "}
					{formatFileSize(maxSizeBytes)}
				</p>
			</button>

			{uploadedFiles.length > 0 && (
				<div className="space-y-2.5">
					<h4 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
						Recently Committed Assets
					</h4>
					<div className="space-y-2">
						{uploadedFiles.map((file) => (
							<div
								className="border-border/60 bg-card/70 hover:border-primary/30 flex items-center justify-between rounded-xl border p-3.5 shadow-2xs backdrop-blur-xs transition-colors"
								key={file.fileKey}
							>
								<div className="flex items-center gap-3 truncate">
									<div className="bg-primary/10 text-primary flex h-8 w-8 items-center justify-center rounded-lg">
										<FileIcon className="h-4 w-4 shrink-0" />
									</div>
									<div className="truncate text-left">
										<p className="text-foreground truncate text-xs font-semibold">
											{file.fileName}
										</p>
										<p className="text-muted-foreground font-mono text-[11px]">
											{formatFileSize(file.size)}
										</p>
									</div>
								</div>

								<div className="flex shrink-0 items-center gap-2">
									<Button
										className="h-8 gap-1.5 px-3 text-xs"
										onClick={(e) => {
											e.stopPropagation();
											void copyUrl(file.publicUrl);
										}}
										size="sm"
										type="button"
										variant="outline"
									>
										<Copy className="h-3 w-3" />
										Copy File URL
									</Button>
									<CheckCircle2 className="h-4 w-4 text-emerald-500" />
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
