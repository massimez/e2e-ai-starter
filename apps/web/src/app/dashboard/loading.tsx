import { Loader2 } from "lucide-react";

export default function DashboardLoading() {
	return (
		<div
			aria-live="polite"
			className="mx-auto flex min-h-[60vh] max-w-6xl items-center justify-center p-6"
			role="status"
		>
			<div className="text-muted-foreground flex items-center gap-2.5 text-sm font-medium">
				<Loader2 className="text-primary h-5 w-5 animate-spin" />
				<span>Loading workspace...</span>
			</div>
		</div>
	);
}
