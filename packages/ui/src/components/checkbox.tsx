"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Check, Minus } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef } from "react";

export type CheckedState = boolean | "indeterminate";

export interface CheckboxProps
	extends Omit<
		React.InputHTMLAttributes<HTMLInputElement>,
		"checked" | "onChange" | "type"
	> {
	checked?: CheckedState;
	onCheckedChange?: (checked: boolean) => void;
}

function getCheckboxDataState(
	isIndeterminate: boolean,
	isChecked: boolean
): "indeterminate" | "checked" | "unchecked" {
	if (isIndeterminate) {
		return "indeterminate";
	}
	if (isChecked) {
		return "checked";
	}
	return "unchecked";
}

function CheckboxIndicator({
	isChecked,
	isIndeterminate,
}: {
	isChecked: boolean;
	isIndeterminate: boolean;
}) {
	if (isIndeterminate) {
		return <Minus className="size-3.5 stroke-[2.5]" />;
	}
	if (isChecked) {
		return <Check className="size-3.5 stroke-[2.5]" />;
	}
	return null;
}

function Checkbox({
	checked = false,
	className,
	disabled,
	onCheckedChange,
	...props
}: CheckboxProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const isChecked = checked === true;
	const isIndeterminate = checked === "indeterminate";
	const dataState = getCheckboxDataState(isIndeterminate, isChecked);

	useEffect(() => {
		if (inputRef.current) {
			inputRef.current.indeterminate = isIndeterminate;
		}
	}, [isIndeterminate]);

	return (
		<span className="relative inline-flex size-4 shrink-0 items-center justify-center">
			<input
				checked={isChecked}
				className={cn(
					"peer border-input bg-background checked:border-primary checked:bg-primary focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 size-4 shrink-0 appearance-none rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
					isIndeterminate && "border-primary bg-primary",
					className
				)}
				data-slot="checkbox"
				data-state={dataState}
				disabled={disabled}
				onChange={(event) => onCheckedChange?.(event.target.checked)}
				ref={inputRef}
				type="checkbox"
				{...props}
			/>
			<span
				aria-hidden="true"
				className="text-primary-foreground pointer-events-none absolute inset-0 flex items-center justify-center"
			>
				<CheckboxIndicator
					isChecked={isChecked}
					isIndeterminate={isIndeterminate}
				/>
			</span>
		</span>
	);
}

export { Checkbox };
