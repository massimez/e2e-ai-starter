"use client";

import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import {
	FileCode,
	FileImage,
	FileSpreadsheet,
	FileText,
	Folder,
	FolderInput,
	Loader2,
} from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useState,
} from "react";

export interface StorageFolderItem {
	createdAt: string;
	fileCount?: number;
	id: string;
	name: string;
	organizationId: string;
	parentId: string | null;
}

export interface StorageUploadItem {
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

export const ROOT_FOLDER_SELECT_VALUE = "__root__";

export function resolveDisplayFileName(item: StorageUploadItem): string {
	const metaName = item.metadata?.originalName;
	if (typeof metaName === "string" && metaName.trim().length > 0) {
		return metaName.trim();
	}
	return item.fileKey.split("/").at(-1) || item.fileKey;
}

export function getFileTypePresentation(contentType: string | null): {
	badgeClassName: string;
	Icon: typeof FileText;
} {
	const normalized = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

	if (normalized.startsWith("image/")) {
		return {
			badgeClassName:
				"bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
			Icon: FileImage,
		};
	}
	if (normalized === "application/pdf") {
		return {
			badgeClassName:
				"bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
			Icon: FileText,
		};
	}
	if (normalized === "text/csv") {
		return {
			badgeClassName:
				"bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
			Icon: FileSpreadsheet,
		};
	}
	if (normalized === "application/json" || normalized === "text/markdown") {
		return {
			badgeClassName: "bg-primary/10 text-primary border-primary/20",
			Icon: FileCode,
		};
	}
	return {
		badgeClassName: "bg-muted text-muted-foreground border-border/60",
		Icon: FileText,
	};
}

interface RenameDialogProps {
	description: ReactNode;
	fieldLabel: string;
	Icon: typeof FileText;
	initialValue: string;
	isPending: boolean;
	maxLength: number;
	onClose: () => void;
	onSubmit: (value: string) => Promise<void>;
	open: boolean;
	placeholder: string;
	title: string;
}

export function RenameDialog({
	description,
	fieldLabel,
	Icon,
	initialValue,
	isPending,
	maxLength,
	onClose,
	onSubmit,
	open,
	placeholder,
	title,
}: RenameDialogProps) {
	const inputId = useId();
	const [value, setValue] = useState("");

	useEffect(() => {
		if (open) {
			setValue(initialValue);
		}
	}, [initialValue, open]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = value.trim();
		if (!trimmed || isPending) {
			return;
		}
		if (trimmed === initialValue) {
			onClose();
			return;
		}
		await onSubmit(trimmed);
	};

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!(nextOpen || isPending)) {
					onClose();
				}
			}}
			open={open}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-base">
						<Icon aria-hidden="true" className="text-primary h-4 w-4" />
						{title}
					</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor={inputId}>{fieldLabel}</Label>
						<Input
							autoFocus
							disabled={isPending}
							id={inputId}
							maxLength={maxLength}
							onChange={(event) => setValue(event.target.value)}
							placeholder={placeholder}
							value={value}
						/>
					</div>

					<DialogFooter>
						<Button
							disabled={isPending}
							onClick={onClose}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={!value.trim() || isPending}
							size="sm"
							type="submit"
						>
							{isPending ? (
								<Loader2
									aria-hidden="true"
									className="h-3.5 w-3.5 animate-spin"
								/>
							) : null}
							Save Name
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

interface MoveFileFolderDialogProps {
	folders: StorageFolderItem[];
	isPending: boolean;
	onClose: () => void;
	onSubmit: (params: { folderId: string | null; id: string }) => Promise<void>;
	upload: StorageUploadItem | null;
}

export function MoveFileFolderDialog({
	folders,
	isPending,
	onClose,
	onSubmit,
	upload,
}: MoveFileFolderDialogProps) {
	const selectId = useId();
	const [selectedValue, setSelectedValue] = useState<string>(
		ROOT_FOLDER_SELECT_VALUE
	);

	useEffect(() => {
		setSelectedValue(upload?.folderId ?? ROOT_FOLDER_SELECT_VALUE);
	}, [upload]);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!upload || isPending) {
			return;
		}
		const nextFolderId =
			selectedValue === ROOT_FOLDER_SELECT_VALUE ? null : selectedValue;
		if (nextFolderId === (upload.folderId ?? null)) {
			onClose();
			return;
		}
		await onSubmit({ folderId: nextFolderId, id: upload.id });
	};

	const displayName = upload ? resolveDisplayFileName(upload) : "";

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || isPending)) {
					onClose();
				}
			}}
			open={Boolean(upload)}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-base">
						<FolderInput aria-hidden="true" className="text-primary h-4 w-4" />
						Move File to Folder
					</DialogTitle>
					<DialogDescription>
						Choose a destination folder for{" "}
						<span className="text-foreground font-medium">{displayName}</span>.
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<Label htmlFor={selectId}>Destination folder</Label>
						<Select
							disabled={isPending}
							onValueChange={setSelectedValue}
							value={selectedValue}
						>
							<SelectTrigger className="h-10 text-sm" id={selectId}>
								<SelectValue placeholder="Select folder" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ROOT_FOLDER_SELECT_VALUE}>
									No folder (All Files)
								</SelectItem>
								{folders.map((folder) => (
									<SelectItem key={folder.id} value={folder.id}>
										<span className="inline-flex items-center gap-1.5">
											<Folder aria-hidden="true" className="h-3.5 w-3.5" />
											{folder.name}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<DialogFooter>
						<Button
							disabled={isPending}
							onClick={onClose}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={isPending} size="sm" type="submit">
							{isPending ? (
								<Loader2
									aria-hidden="true"
									className="h-3.5 w-3.5 animate-spin"
								/>
							) : null}
							Move File
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
