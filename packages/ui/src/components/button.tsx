import { Slot as SlotPrimitive } from "@radix-ui/react-slot";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const buttonVariants = cva(
	"ring-offset-background focus-visible:ring-ring inline-flex cursor-pointer items-center justify-center text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				primary:
					"bg-primary text-primary-foreground hover:bg-primary/90 data-[state=open]:bg-primary/90",
				destructive:
					"bg-destructive text-destructive-foreground hover:bg-destructive/90 data-[state=open]:bg-destructive/90",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-secondary/90 data-[state=open]:bg-secondary/90",
				outline:
					"border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground border",
				ghost:
					"hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				lg: "h-12 gap-2 rounded-md px-5 text-base [&_svg:not([class*=size-])]:size-5",
				md: "h-11 gap-2 rounded-md px-4 text-sm [&_svg:not([class*=size-])]:size-4",
				sm: "h-9 gap-1.5 rounded-md px-3.5 text-sm [&_svg:not([class*=size-])]:size-4",
				icon: "size-11 shrink-0 rounded-md [&_svg:not([class*=size-])]:size-4",
			},
			autoHeight: {
				true: "h-auto min-h-10 py-2.5 whitespace-normal",
				false: "",
			},
		},
		defaultVariants: {
			variant: "primary",
			size: "md",
		},
	}
);

function Button({
	className,
	variant,
	size,
	autoHeight,
	asChild = false,
	type,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? SlotPrimitive : "button";

	return (
		<Comp
			className={cn(
				buttonVariants({ variant, size, autoHeight, className }),
				asChild && props.disabled && "pointer-events-none opacity-50"
			)}
			data-slot="button"
			{...(asChild ? {} : { type: type ?? "button" })}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
