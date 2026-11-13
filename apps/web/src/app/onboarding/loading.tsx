import { Loader2 } from "lucide-react";

export default function OnboardingLoading() {
	return (
		<div
			aria-live="polite"
			className="bg-muted/20 flex min-h-screen items-center justify-center p-6"
			role="status"
		>
			<div className="text-muted-foreground flex items-center gap-2.5 text-sm font-medium">
				<Loader2 className="text-primary h-5 w-5 animate-spin" />
				<span>Preparing workspace setup...</span>
			</div>
		</div>
	);
}
