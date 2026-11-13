"use client";

import { Button } from "@workspace/ui/components/button";
import { AlertCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Route Error Boundary caught exception:", error);
	}, [error]);

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
			<div className="bg-destructive/10 text-destructive mb-4 flex h-14 w-14 items-center justify-center rounded-full">
				<AlertCircle className="h-8 w-8" />
			</div>
			<h1 className="mb-2 text-2xl font-bold tracking-tight">
				Something went wrong
			</h1>
			<p className="text-muted-foreground mb-6 max-w-md text-sm">
				An unexpected runtime error occurred. Please try again or return to the
				home page.
			</p>
			<div className="flex items-center gap-3">
				<Button
					className="gap-2"
					onClick={() => reset()}
					type="button"
					variant="primary"
				>
					<RotateCcw className="h-4 w-4" />
					Try Again
				</Button>
				<Button asChild variant="outline">
					<Link href="/">Return Home</Link>
				</Button>
			</div>
		</div>
	);
}
