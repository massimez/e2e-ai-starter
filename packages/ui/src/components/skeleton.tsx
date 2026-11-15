import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("bg-muted animate-pulse rounded-md", className)}
			data-slot="skeleton"
			{...props}
		/>
	);
}

export { Skeleton };
