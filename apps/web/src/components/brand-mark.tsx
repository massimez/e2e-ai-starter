import { cn } from "@workspace/ui/lib/utils";

export function BrandMark({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={cn("h-6 w-6 shrink-0", className)}
			fill="none"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect
				className="stroke-border fill-card"
				height="20"
				rx="5"
				strokeWidth="1.5"
				width="20"
				x="2"
				y="2"
			/>
			<path
				className="stroke-primary"
				d="M9 8H7.5A1.5 1.5 0 0 0 6 9.5v5A1.5 1.5 0 0 0 7.5 16H9"
				strokeLinecap="round"
				strokeWidth="1.75"
			/>
			<path
				className="stroke-primary"
				d="M15 8h1.5A1.5 1.5 0 0 1 18 9.5v5a1.5 1.5 0 0 1-1.5 1.5H15"
				strokeLinecap="round"
				strokeWidth="1.75"
			/>
			<rect
				className="fill-foreground"
				height="2.5"
				rx="0.75"
				width="2.5"
				x="10.75"
				y="10.75"
			/>
		</svg>
	);
}
