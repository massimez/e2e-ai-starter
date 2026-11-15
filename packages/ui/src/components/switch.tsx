"use client";

import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

export interface SwitchProps
	extends Omit<
		React.ButtonHTMLAttributes<HTMLButtonElement>,
		"checked" | "onChange"
	> {
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
}

function Switch({
	checked = false,
	className,
	disabled,
	onCheckedChange,
	onClick,
	...props
}: SwitchProps) {
	return (
		<button
			aria-checked={checked}
			className={cn(
				"peer focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
				checked ? "bg-primary" : "bg-input dark:bg-input/80",
				className
			)}
			data-slot="switch"
			data-state={checked ? "checked" : "unchecked"}
			disabled={disabled}
			onClick={(event) => {
				onClick?.(event);
				if (!(event.defaultPrevented || disabled)) {
					onCheckedChange?.(!checked);
				}
			}}
			role="switch"
			type="button"
			{...props}
		>
			<span
				className={cn(
					"bg-background pointer-events-none block size-4 rounded-full ring-0 transition-transform",
					checked ? "translate-x-4" : "translate-x-0"
				)}
				data-slot="switch-thumb"
			/>
		</button>
	);
}

export { Switch };
