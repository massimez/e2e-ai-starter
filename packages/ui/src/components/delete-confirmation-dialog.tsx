"use client";

import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Loader2 } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";

export interface DeleteConfirmationDialogProps {
	children?: React.ReactNode;
	confirmationKeyword?: string;
	confirmLabel?: string;
	description?: string;
	disabled?: boolean;
	onConfirm: () => void | Promise<void>;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	title?: string;
}

export function DeleteConfirmationDialog({
	onConfirm,
	title = "Are you absolutely sure?",
	description = "This action cannot be undone. This will permanently delete the item.",
	confirmLabel = "Delete",
	confirmationKeyword,
	children,
	disabled,
	open,
	onOpenChange,
}: DeleteConfirmationDialogProps) {
	const inputId = useId();
	const [typedKeyword, setTypedKeyword] = useState("");
	const [isOpen, setIsOpen] = useState(open ?? false);
	const [isConfirming, setIsConfirming] = useState(false);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && isConfirming) {
			return;
		}
		if (!nextOpen) {
			setTypedKeyword("");
		}
		if (onOpenChange) {
			onOpenChange(nextOpen);
		} else {
			setIsOpen(nextOpen);
		}
	};

	const canConfirm = confirmationKeyword
		? typedKeyword.trim().toLowerCase() ===
			confirmationKeyword.trim().toLowerCase()
		: true;

	const handleConfirm = async () => {
		if (!canConfirm || isConfirming || disabled) {
			return;
		}
		setIsConfirming(true);
		try {
			await onConfirm();
			if (onOpenChange) {
				setTypedKeyword("");
				onOpenChange(false);
			} else {
				setTypedKeyword("");
				setIsOpen(false);
			}
		} finally {
			setIsConfirming(false);
		}
	};

	return (
		<AlertDialog
			onOpenChange={handleOpenChange}
			open={open === undefined ? isOpen : open}
		>
			{children ? (
				<AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
			) : null}
			<AlertDialogContent className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>

				{confirmationKeyword ? (
					<div className="space-y-2 py-2">
						<Label className="text-muted-foreground text-xs" htmlFor={inputId}>
							Please type{" "}
							<span className="text-foreground font-semibold">
								{confirmationKeyword}
							</span>{" "}
							to confirm:
						</Label>
						<Input
							autoFocus
							disabled={isConfirming}
							id={inputId}
							onChange={(e) => setTypedKeyword(e.target.value)}
							placeholder={confirmationKeyword}
							value={typedKeyword}
						/>
					</div>
				) : null}

				<AlertDialogFooter>
					<AlertDialogCancel
						disabled={isConfirming}
						onClick={() => handleOpenChange(false)}
					>
						Cancel
					</AlertDialogCancel>
					<Button
						disabled={disabled || !canConfirm || isConfirming}
						onClick={() => {
							void handleConfirm();
						}}
						type="button"
						variant="destructive"
					>
						{isConfirming ? (
							<>
								<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
								Processing...
							</>
						) : (
							confirmLabel
						)}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
