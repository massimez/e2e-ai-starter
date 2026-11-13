"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface CopyButtonProps {
	className?: string;
	label?: string;
	showText?: boolean;
	value: string;
}

export function CopyButton({
	className,
	label = "Copy command",
	showText = true,
	value,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		},
		[]
	);

	const handleCopy = useCallback(async () => {
		try {
			if (!navigator.clipboard) {
				throw new Error("Clipboard API unavailable");
			}
			await navigator.clipboard.writeText(value);
			setCopied(true);
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
			timeoutRef.current = setTimeout(() => {
				setCopied(false);
			}, 1800);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Unable to copy to clipboard"
			);
		}
	}, [value]);

	return (
		<Button
			aria-label={copied ? "Copied to clipboard" : label}
			className={cn("h-7 gap-1.5 px-2 text-xs", className)}
			onClick={() => void handleCopy()}
			size={showText ? "sm" : "icon"}
			type="button"
			variant="ghost"
		>
			{copied ? (
				<Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-500" />
			) : (
				<Copy aria-hidden="true" className="h-3.5 w-3.5" />
			)}
			{showText ? <span>{copied ? "Copied" : "Copy"}</span> : null}
		</Button>
	);
}
