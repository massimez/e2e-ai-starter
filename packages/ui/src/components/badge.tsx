import { Slot as SlotPrimitive } from "@radix-ui/react-slot";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

export interface BadgeProps
	extends React.ComponentProps<"span">,
		VariantProps<typeof badgeVariants> {
	asChild?: boolean;
	disabled?: boolean;
}

const badgeVariants = cva(
	"focus:ring-ring inline-flex items-center justify-center border border-transparent font-medium whitespace-nowrap focus:ring-2 focus:ring-offset-2 focus:outline-hidden [&_svg]:-ms-px [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				primary: "bg-primary text-primary-foreground",
				secondary: "bg-secondary text-secondary-foreground",
				success:
					"bg-(--color-success-accent,var(--color-green-500)) text-(--color-success-foreground,var(--color-white))",
				warning:
					"bg-(--color-warning-accent,var(--color-yellow-500)) text-(--color-warning-foreground,var(--color-white))",
				info: "bg-(--color-info-accent,var(--color-violet-500)) text-(--color-info-foreground,var(--color-white))",
				outline:
					"border-border text-secondary-foreground border bg-transparent",
				destructive: "bg-destructive text-destructive-foreground",
			},
			appearance: {
				default: "",
				light: "",
				outline: "",
				ghost: "border-transparent bg-transparent",
			},
			disabled: {
				true: "pointer-events-none opacity-50",
			},
			size: {
				lg: "h-7 min-w-7 gap-1.5 rounded-md px-(--badge-lg-px,0.5rem) text-xs [&_svg]:size-3.5",
				md: "h-6 min-w-6 gap-1.5 rounded-md px-[0.45rem] text-xs [&_svg]:size-3.5",
				sm: "h-5 min-w-5 gap-1 rounded-sm px-[0.325rem] text-[0.6875rem] leading-(--badge-sm-leading,0.75rem) [&_svg]:size-3",
				xs: "h-4 min-w-4 gap-1 rounded-sm px-(--badge-xs-px,0.25rem) text-[0.625rem] leading-(--badge-xs-leading,0.5rem) [&_svg]:size-3",
			},
			shape: {
				default: "",
				circle: "rounded-full",
			},
		},
		compoundVariants: [
			/* Light */
			{
				variant: "primary",
				appearance: "light",
				className:
					"bg-(--color-primary-soft,var(--color-blue-50)) text-(--color-primary-accent,var(--color-blue-700)) dark:bg-(--color-primary-soft,var(--color-blue-950)) dark:text-(--color-primary-accent,var(--color-blue-400))",
			},
			{
				variant: "secondary",
				appearance: "light",
				className:
					"bg-secondary text-secondary-foreground dark:bg-secondary/50",
			},
			{
				variant: "success",
				appearance: "light",
				className:
					"bg-(--color-success-soft,var(--color-green-100)) text-(--color-success-accent,var(--color-green-800)) dark:bg-(--color-success-soft,var(--color-green-950)) dark:text-(--color-success-accent,var(--color-green-400))",
			},
			{
				variant: "warning",
				appearance: "light",
				className:
					"bg-(--color-warning-soft,var(--color-yellow-100)) text-(--color-warning-accent,var(--color-yellow-700)) dark:bg-(--color-warning-soft,var(--color-yellow-950)) dark:text-(--color-warning-accent,var(--color-yellow-400))",
			},
			{
				variant: "info",
				appearance: "light",
				className:
					"bg-(--color-info-soft,var(--color-violet-100)) text-(--color-info-accent,var(--color-violet-700)) dark:bg-(--color-info-soft,var(--color-violet-950)) dark:text-(--color-info-accent,var(--color-violet-400))",
			},
			{
				variant: "destructive",
				appearance: "light",
				className:
					"bg-(--color-destructive-soft,var(--color-red-50)) text-(--color-destructive-accent,var(--color-red-700)) dark:bg-(--color-destructive-soft,var(--color-red-950)) dark:text-(--color-destructive-accent,var(--color-red-400))",
			},
			/* Outline */
			{
				variant: "primary",
				appearance: "outline",
				className:
					"border-(--color-primary-soft,var(--color-blue-100)) bg-(--color-primary-soft,var(--color-blue-50)) text-(--color-primary-accent,var(--color-blue-700)) dark:border-(--color-primary-soft,var(--color-blue-900)) dark:bg-(--color-primary-soft,var(--color-blue-950)) dark:text-(--color-primary-accent,var(--color-blue-400))",
			},
			{
				variant: "success",
				appearance: "outline",
				className:
					"border-(--color-success-soft,var(--color-green-200)) bg-(--color-success-soft,var(--color-green-50)) text-(--color-success-accent,var(--color-green-700)) dark:border-(--color-success-soft,var(--color-green-900)) dark:bg-(--color-success-soft,var(--color-green-950)) dark:text-(--color-success-accent,var(--color-green-400))",
			},
			{
				variant: "warning",
				appearance: "outline",
				className:
					"border-(--color-warning-soft,var(--color-yellow-200)) bg-(--color-warning-soft,var(--color-yellow-50)) text-(--color-warning-accent,var(--color-yellow-700)) dark:border-(--color-warning-soft,var(--color-yellow-900)) dark:bg-(--color-warning-soft,var(--color-yellow-950)) dark:text-(--color-warning-accent,var(--color-yellow-400))",
			},
			{
				variant: "info",
				appearance: "outline",
				className:
					"border-(--color-info-soft,var(--color-violet-100)) bg-(--color-info-soft,var(--color-violet-50)) text-(--color-info-accent,var(--color-violet-700)) dark:border-(--color-info-soft,var(--color-violet-900)) dark:bg-(--color-info-soft,var(--color-violet-950)) dark:text-(--color-info-accent,var(--color-violet-400))",
			},
			{
				variant: "destructive",
				appearance: "outline",
				className:
					"border-(--color-destructive-soft,var(--color-red-100)) bg-(--color-destructive-soft,var(--color-red-50)) text-(--color-destructive-accent,var(--color-red-700)) dark:border-(--color-destructive-soft,var(--color-red-900)) dark:bg-(--color-destructive-soft,var(--color-red-950)) dark:text-(--color-destructive-accent,var(--color-red-400))",
			},
			/* Ghost */
			{
				variant: "primary",
				appearance: "ghost",
				className: "text-primary",
			},
			{
				variant: "secondary",
				appearance: "ghost",
				className: "text-secondary-foreground",
			},
			{
				variant: "success",
				appearance: "ghost",
				className: "text-(--color-success-accent,var(--color-green-500))",
			},
			{
				variant: "warning",
				appearance: "ghost",
				className: "text-(--color-warning-accent,var(--color-yellow-500))",
			},
			{
				variant: "info",
				appearance: "ghost",
				className: "text-(--color-info-accent,var(--color-violet-500))",
			},
			{
				variant: "destructive",
				appearance: "ghost",
				className: "text-destructive",
			},

			{ size: "lg", appearance: "ghost", className: "px-0" },
			{ size: "md", appearance: "ghost", className: "px-0" },
			{ size: "sm", appearance: "ghost", className: "px-0" },
			{ size: "xs", appearance: "ghost", className: "px-0" },
		],
		defaultVariants: {
			variant: "primary",
			appearance: "default",
			size: "md",
		},
	}
);

function Badge({
	className,
	variant,
	size,
	appearance,
	shape,
	asChild = false,
	disabled,
	...props
}: BadgeProps) {
	const Comp = asChild ? SlotPrimitive : "span";

	return (
		<Comp
			className={cn(
				badgeVariants({ variant, size, appearance, shape, disabled }),
				className
			)}
			data-slot="badge"
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
