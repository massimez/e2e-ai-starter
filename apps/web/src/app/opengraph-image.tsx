import { APP_CONFIG } from "@workspace/shared/config";
import { ImageResponse } from "next/og";

export const alt = `${APP_CONFIG.name}: Multi-tenant AI starter for teams, storage, and background jobs`;

export const size = {
	height: 630,
	width: 1200,
};

export const contentType = "image/png";

const WORKSPACES = [
	"apps/web",
	"apps/api",
	"apps/worker",
	"packages/ai-core",
	"packages/db",
	"packages/ui",
] as const;

export default function OpenGraphImage() {
	return new ImageResponse(
		<div
			style={{
				backgroundColor: "#09090b",
				color: "#fafafa",
				display: "flex",
				flexDirection: "column",
				height: "100%",
				justifyContent: "space-between",
				padding: "64px 72px",
				width: "100%",
			}}
		>
			<div
				style={{
					alignItems: "center",
					display: "flex",
					justifyContent: "space-between",
					width: "100%",
				}}
			>
				<div
					style={{
						alignItems: "center",
						display: "flex",
						gap: "16px",
					}}
				>
					<div
						style={{
							alignItems: "center",
							backgroundColor: "#18181b",
							border: "2px solid #fafafa",
							borderRadius: "10px",
							color: "#fafafa",
							display: "flex",
							fontSize: "22px",
							fontWeight: 700,
							height: "44px",
							justifyContent: "center",
							width: "44px",
						}}
					>
						[]
					</div>
					<span
						style={{
							color: "#fafafa",
							fontSize: "28px",
							fontWeight: 700,
							letterSpacing: "-0.02em",
						}}
					>
						{APP_CONFIG.name}
					</span>
				</div>
				<span
					style={{
						color: "#a1a1aa",
						fontSize: "20px",
					}}
				>
					Bun + Turborepo Monorepo
				</span>
			</div>

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "20px",
					maxWidth: "960px",
				}}
			>
				<div
					style={{
						color: "#ffffff",
						display: "flex",
						fontSize: "54px",
						fontWeight: 700,
						letterSpacing: "-0.03em",
						lineHeight: 1.12,
					}}
				>
					Multi-tenant AI starter for teams, storage, and background jobs.
				</div>
				<div
					style={{
						color: "#a1a1aa",
						display: "flex",
						fontSize: "25px",
						lineHeight: 1.45,
					}}
				>
					Better Auth organizations, Mastra AI with pgvector memory, Drizzle ORM
					on Postgres, Hono typed RPC, private S3/R2 uploads, and BullMQ
					workers.
				</div>
			</div>

			<div
				style={{
					alignItems: "center",
					borderTop: "1px solid #27272a",
					display: "flex",
					gap: "14px",
					paddingTop: "28px",
				}}
			>
				{WORKSPACES.map((workspace) => (
					<div
						key={workspace}
						style={{
							backgroundColor: "#18181b",
							border: "1px solid #27272a",
							borderRadius: "8px",
							color: "#d4d4d8",
							display: "flex",
							fontSize: "19px",
							padding: "8px 16px",
						}}
					>
						{workspace}
					</div>
				))}
			</div>
		</div>,
		size
	);
}
