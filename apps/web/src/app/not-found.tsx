import { Button } from "@workspace/ui/components/button";
import { FileQuestion, Home } from "lucide-react";
import Link from "next/link";

export default function NotFoundPage() {
	return (
		<div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
			<div className="bg-muted text-muted-foreground mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
				<FileQuestion className="text-primary h-9 w-9" />
			</div>
			<span className="text-muted-foreground text-sm font-bold tracking-widest uppercase">
				404 Error
			</span>
			<h1 className="mt-2 mb-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
				Page Not Found
			</h1>
			<p className="text-muted-foreground mb-8 max-w-md text-sm sm:text-base">
				Sorry, we couldn&apos;t find the page you were looking for. It might
				have been moved or deleted.
			</p>
			<Button asChild className="gap-2" size="lg">
				<Link href="/">
					<Home className="h-4 w-4" />
					Back to Safety
				</Link>
			</Button>
		</div>
	);
}
