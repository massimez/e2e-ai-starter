"use client";

import type { ReactNode } from "react";
import { Streamdown, type StreamdownProps } from "streamdown";

function sanitizeStreamdownUrl(rawUrl: string): string {
	try {
		const url = new URL(rawUrl);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.toString()
			: "";
	} catch {
		return "";
	}
}

export interface MarkdownRendererProps {
	children: string;
	className?: string;
	isAnimating?: boolean;
	mode?: StreamdownProps["mode"];
}

export function MarkdownRenderer({
	children,
	className,
	isAnimating = false,
	mode = "streaming",
}: MarkdownRendererProps) {
	return (
		<Streamdown
			className={className ?? "space-y-2 text-sm leading-relaxed"}
			isAnimating={isAnimating}
			linkSafety={{ enabled: false }}
			mode={mode}
			urlTransform={sanitizeStreamdownUrl}
		>
			{children}
		</Streamdown>
	);
}

export function renderSafeMarkdown(
	text: string,
	keyPrefix: string,
	options?: Pick<MarkdownRendererProps, "className" | "isAnimating" | "mode">
): ReactNode {
	return (
		<MarkdownRenderer
			className={options?.className}
			isAnimating={options?.isAnimating}
			key={keyPrefix}
			mode={options?.mode}
		>
			{text}
		</MarkdownRenderer>
	);
}
