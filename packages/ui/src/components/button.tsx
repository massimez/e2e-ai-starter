import { Slot as SlotPrimitive } from "@radix-ui/react-slot";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, type LucideIcon } from "lucide-react";

import type * as React from "react";

const buttonVariants = cva(
	"group ring-offset-background inline-flex cursor-pointer items-center justify-center text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-60 has-data-[arrow=true]:justify-between [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				primary:
					"bg-primary text-primary-foreground hover:bg-primary/90 data-[state=open]:bg-primary/90",
				mono: "bg-zinc-950 text-white hover:bg-zinc-950/90 data-[state=open]:bg-zinc-950/90 dark:bg-zinc-300 dark:text-black dark:hover:bg-zinc-300/90 dark:data-[state=open]:bg-zinc-300/90",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 data-[state=open]:bg-destructive/90",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/90 data-[state=open]:bg-secondary/90",
				outline:
					"border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground border",
				dashed:
					"border-input bg-background text-accent-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:text-accent-foreground border border-dashed",
				ghost:
					"hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
				dim: "text-muted-foreground hover:text-foreground data-[state=open]:text-foreground",
				link: "text-primary underline-offset-4 hover:underline",

				foreground: "",
				inverse: "",
			},
			appearance: {
				default: "",
				ghost: "",
			},
			underline: {
				solid: "",
				dashed: "",
			},
			underlined: {
				solid: "",
				dashed: "",
			},
			size: {
				lg: "h-12 gap-2 rounded-md px-5 text-base [&_svg:not([class*=size-])]:size-5",
				md: "h-11 gap-2 rounded-md px-4 text-sm [&_svg:not([class*=size-])]:size-4",
				sm: "h-9 gap-1.5 rounded-md px-3.5 text-sm [&_svg:not([class*=size-])]:size-4",
				icon: "size-11 shrink-0 rounded-md [&_svg:not([class*=size-])]:size-4",
			},
			autoHeight: {
				true: "",
				false: "",
			},
			shape: {
				default: "",
				circle: "rounded-full",
			},
			mode: {
				default:
					"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
				icon: "focus-visible:ring-ring shrink-0 focus-visible:ring-2 focus-visible:ring-offset-2",
				link: "text-primary h-auto rounded-none bg-transparent p-0 hover:bg-transparent data-[state=open]:bg-transparent",
				input:
					"hover:bg-background [&_svg]:hover:text-foreground data-[state=open]:bg-background focus-visible:border-ring focus-visible:ring-ring/30 [[data-state=open]>&]:border-ring [[data-state=open]>&]:ring-ring/30 aria-invalid:border-destructive/60 aria-invalid:ring-destructive/10 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/20 in-data-[invalid=true]:border-destructive/60 in-data-[invalid=true]:ring-destructive/10 dark:in-data-[invalid=true]:border-destructive dark:in-data-[invalid=true]:ring-destructive/20 justify-start font-normal focus-visible:ring-[3px] focus-visible:outline-hidden [&_svg]:transition-colors [[data-state=open]>&]:ring-[3px] [[data-state=open]>&]:outline-hidden",
			},
			placeholder: {
				true: "text-muted-foreground",
				false: "",
			},
		},
		compoundVariants: [
			// Icons opacity for default mode
			{
				variant: "ghost",
				mode: "default",
				className:
					"[&_svg:not([role=img]):not([class*=text-]):not([class*=opacity-])]:opacity-60",
			},
			{
				variant: "outline",
				mode: "default",
				className:
					"[&_svg:not([role=img]):not([class*=text-]):not([class*=opacity-])]:opacity-60",
			},
			{
				variant: "dashed",
				mode: "default",
				className:
					"[&_svg:not([role=img]):not([class*=text-]):not([class*=opacity-])]:opacity-60",
			},
			{
				variant: "secondary",
				mode: "default",
				className:
					"[&_svg:not([role=img]):not([class*=text-]):not([class*=opacity-])]:opacity-60",
			},

			// Icons opacity for default mode
			{
				variant: "outline",
				mode: "input",
				className:
					"[&_svg:not([role=img]):not([class*=text-]):not([class*=opacity-])]:opacity-60",
			},
			{
				variant: "outline",
				mode: "icon",
				className:
					"[&_svg:not([role=img]):not([class*=text-]):not([class*=opacity-])]:opacity-60 data-[state=open]:[&_svg:not([role=img]):not([class*=text-]):not([class*=opacity-])]:opacity-100",
			},

			// Auto height
			{
				size: "md",
				autoHeight: true,
				className: "h-auto min-h-11",
			},
			{
				size: "sm",
				autoHeight: true,
				className: "h-auto min-h-9",
			},
			{
				size: "lg",
				autoHeight: true,
				className: "h-auto min-h-12",
			},

			// Shadow support
			{
				variant: "primary",
				mode: "default",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "mono",
				mode: "default",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "secondary",
				mode: "default",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "outline",
				mode: "default",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "dashed",
				mode: "default",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "destructive",
				mode: "default",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},

			// Shadow support
			{
				variant: "primary",
				mode: "icon",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "mono",
				mode: "icon",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "secondary",
				mode: "icon",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "outline",
				mode: "icon",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "dashed",
				mode: "icon",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},
			{
				variant: "destructive",
				mode: "icon",
				appearance: "default",
				className: "shadow-xs shadow-black/5",
			},

			// Link
			{
				variant: "primary",
				mode: "link",
				underline: "solid",
				className:
					"text-primary hover:text-primary/90 font-medium hover:underline hover:decoration-solid hover:underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "primary",
				mode: "link",
				underline: "dashed",
				className:
					"text-primary hover:text-primary/90 font-medium decoration-1 hover:underline hover:decoration-dashed hover:underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "primary",
				mode: "link",
				underlined: "solid",
				className:
					"text-primary hover:text-primary/90 font-medium underline decoration-solid underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "primary",
				mode: "link",
				underlined: "dashed",
				className:
					"text-primary hover:text-primary/90 font-medium underline decoration-dashed decoration-1 underline-offset-4 [&_svg]:opacity-60",
			},

			{
				variant: "inverse",
				mode: "link",
				underline: "solid",
				className:
					"font-medium text-inherit hover:underline hover:decoration-solid hover:underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "inverse",
				mode: "link",
				underline: "dashed",
				className:
					"font-medium text-inherit decoration-1 hover:underline hover:decoration-dashed hover:underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "inverse",
				mode: "link",
				underlined: "solid",
				className:
					"font-medium text-inherit underline decoration-solid underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "inverse",
				mode: "link",
				underlined: "dashed",
				className:
					"font-medium text-inherit underline decoration-dashed decoration-1 underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},

			{
				variant: "foreground",
				mode: "link",
				underline: "solid",
				className:
					"text-foreground font-medium hover:underline hover:decoration-solid hover:underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "foreground",
				mode: "link",
				underline: "dashed",
				className:
					"text-foreground font-medium decoration-1 hover:underline hover:decoration-dashed hover:underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "foreground",
				mode: "link",
				underlined: "solid",
				className:
					"text-foreground font-medium underline decoration-solid underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},
			{
				variant: "foreground",
				mode: "link",
				underlined: "dashed",
				className:
					"text-foreground font-medium underline decoration-dashed decoration-1 underline-offset-4 [&_svg:not([role=img]):not([class*=text-])]:opacity-60",
			},

			// Ghost
			{
				variant: "primary",
				appearance: "ghost",
				className:
					"text-primary/90 hover:bg-primary/5 data-[state=open]:bg-primary/5 bg-transparent",
			},
			{
				variant: "destructive",
				appearance: "ghost",
				className:
					"text-destructive/90 hover:bg-destructive/5 data-[state=open]:bg-destructive/5 bg-transparent",
			},
			{
				variant: "ghost",
				mode: "icon",
				className: "text-muted-foreground",
			},

			// Size
			{
				size: "sm",
				mode: "icon",
				className: "h-9 w-9 p-0 [&_svg:not([class*=size-])]:size-4",
			},
			{
				size: "md",
				mode: "icon",
				className: "h-11 w-11 p-0 [&_svg:not([class*=size-])]:size-4",
			},
			{
				size: "icon",
				className: "h-11 w-11 p-0 [&_svg:not([class*=size-])]:size-4",
			},
			{
				size: "lg",
				mode: "icon",
				className: "h-12 w-12 p-0 [&_svg:not([class*=size-])]:size-5",
			},

			// Input mode
			{
				mode: "input",
				placeholder: true,
				variant: "outline",
				className: "text-muted-foreground font-normal",
			},
			{
				mode: "input",
				variant: "outline",
				size: "sm",
				className: "gap-1.25",
			},
			{
				mode: "input",
				variant: "outline",
				size: "md",
				className: "gap-1.5",
			},
			{
				mode: "input",
				variant: "outline",
				size: "lg",
				className: "gap-1.5",
			},
		],
		defaultVariants: {
			variant: "primary",
			mode: "default",
			size: "md",
			shape: "default",
			appearance: "default",
		},
	}
);

function Button({
	className,
	selected,
	variant,
	shape,
	appearance,
	mode,
	size,
	autoHeight,
	underlined,
	underline,
	asChild = false,
	placeholder = false,
	type,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		selected?: boolean;
		asChild?: boolean;
	}) {
	if (asChild) {
		return (
			<SlotPrimitive
				className={cn(
					buttonVariants({
						variant,
						size,
						shape,
						appearance,
						mode,
						autoHeight,
						placeholder,
						underlined,
						underline,
						className,
					}),
					props.disabled && "pointer-events-none opacity-50"
				)}
				data-slot="button"
				{...(selected && { "data-state": "open" })}
				{...props}
			/>
		);
	}

	return (
		<button
			className={cn(
				buttonVariants({
					variant,
					size,
					shape,
					appearance,
					mode,
					autoHeight,
					placeholder,
					underlined,
					underline,
					className,
				})
			)}
			data-slot="button"
			type={type ?? "button"}
			{...(selected && { "data-state": "open" })}
			{...props}
		/>
	);
}

interface ButtonArrowProps extends React.SVGProps<SVGSVGElement> {
	icon?: LucideIcon; // Allows passing any Lucide icon
}

function ButtonArrow({
	icon: Icon = ChevronDown,
	className,
	...props
}: ButtonArrowProps) {
	return (
		<Icon
			className={cn("ms-auto -me-1", className)}
			data-slot="button-arrow"
			{...props}
		/>
	);
}

export { Button, ButtonArrow, buttonVariants };
