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
			<body
				style={{
					alignItems: "center",
					backgroundColor: "#ffffff",
					color: "#09090b",
					colorScheme: "light dark",
					display: "flex",
					flexDirection: "column",
					fontFamily:
						'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					justifyContent: "center",
					margin: 0,
					minHeight: "100vh",
					padding: "24px",
					textAlign: "center",
				}}
			>
				<main
					style={{
						backgroundColor: "#fafafa",
						border: "1px solid #e4e4e7",
						borderRadius: "16px",
						boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
						maxWidth: "420px",
						padding: "32px 24px",
						width: "100%",
					}}
				>
					<h1
						style={{
							fontSize: "24px",
							fontWeight: 700,
							lineHeight: 1.2,
							margin: "0 0 8px",
						}}
					>
						Application Error
					</h1>
					<p
						style={{
							color: "#52525b",
							fontSize: "14px",
							lineHeight: 1.5,
							margin: "0 0 24px",
						}}
					>
						A critical unexpected error interrupted the application.
					</p>
					<button
						onClick={() => reset()}
						style={{
							backgroundColor: "#18181b",
							border: "none",
							borderRadius: "8px",
							color: "#fafafa",
							cursor: "pointer",
							fontSize: "14px",
							fontWeight: 500,
							height: "44px",
							padding: "0 20px",
						}}
						type="button"
					>
						Reload Application
					</button>
				</main>
			</body>
		</html>
	);
}
