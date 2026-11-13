"use client";

import { useEffect } from "react";

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Root Global Error Boundary:", error);
	}, [error]);

	return (
		<html lang="en">
			<body className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center p-6 text-center font-sans antialiased">
				<h1 className="mb-2 text-2xl font-bold">Application Error</h1>
				<p className="text-muted-foreground mb-6 max-w-md text-sm">
					A critical unexpected error interrupted the application.
				</p>
				<button
					className="bg-primary text-primary-foreground inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium"
					onClick={() => reset()}
					type="button"
				>
					Reload Application
				</button>
			</body>
		</html>
	);
}
