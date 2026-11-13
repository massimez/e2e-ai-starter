"use client";

import {
	Content,
	Group,
	Icon,
	Item,
	ItemIndicator,
	ItemText,
	Portal,
	Root,
	ScrollDownButton,
	ScrollUpButton,
	Label as SelectLabelPrimitive,
	Separator,
	Trigger,
	Value,
	Viewport,
} from "@radix-ui/react-select";
import { cn } from "@workspace/ui/lib/utils";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps } from "react";

function Select({ ...props }: ComponentProps<typeof Root>) {
	return <Root data-slot="select" {...props} />;
}

function SelectGroup({ ...props }: ComponentProps<typeof Group>) {
	return <Group data-slot="select-group" {...props} />;
}

function SelectValue({ ...props }: ComponentProps<typeof Value>) {
	return <Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	className,
	children,
	...props
}: ComponentProps<typeof Trigger>) {
	return (
		<Trigger
			className={cn(
				"border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive data-placeholder:text-muted-foreground dark:bg-input/30 flex h-11 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3.5 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
				className
			)}
			data-slot="select-trigger"
			{...props}
		>
			{children}
			<Icon asChild>
				<ChevronDown className="h-4 w-4 opacity-50" />
			</Icon>
		</Trigger>
	);
}

function SelectContent({
	className,
	children,
	position = "popper",
	...props
}: ComponentProps<typeof Content>) {
	return (
		<Portal>
			<Content
				className={cn(
					"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 bg-popover text-popover-foreground data-[state=closed]:animate-out data-[state=open]:animate-in relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md border shadow-md",
					position === "popper" &&
						"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
					className
				)}
				data-slot="select-content"
				position={position}
				{...props}
			>
				<ScrollUpButton className="flex cursor-default items-center justify-center py-1">
					<ChevronUp className="h-4 w-4" />
				</ScrollUpButton>
				<Viewport
					className={cn(
						"p-1",
						position === "popper" &&
							"h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
					)}
				>
					{children}
				</Viewport>
				<ScrollDownButton className="flex cursor-default items-center justify-center py-1">
					<ChevronDown className="h-4 w-4" />
				</ScrollDownButton>
			</Content>
		</Portal>
	);
}

function SelectLabel({
	className,
	...props
}: ComponentProps<typeof SelectLabelPrimitive>) {
	return (
		<SelectLabelPrimitive
			className={cn(
				"text-muted-foreground px-2 py-1.5 text-xs font-semibold",
				className
			)}
			data-slot="select-label"
			{...props}
		/>
	);
}

function SelectItem({
	className,
	children,
	...props
}: ComponentProps<typeof Item>) {
	return (
		<Item
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className
			)}
			data-slot="select-item"
			{...props}
		>
			<span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
				<ItemIndicator>
					<Check className="h-4 w-4" />
				</ItemIndicator>
			</span>
			<ItemText>{children}</ItemText>
		</Item>
	);
}

function SelectSeparator({
	className,
	...props
}: ComponentProps<typeof Separator>) {
	return (
		<Separator
			className={cn("bg-muted -mx-1 my-1 h-px", className)}
			data-slot="select-separator"
			{...props}
		/>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
