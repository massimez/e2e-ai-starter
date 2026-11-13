import { closeDb } from "@workspace/db";
import { app } from "./app";
import { env } from "./env";
import { logError, logInfo } from "./lib/logger";
import { closeRedis } from "./lib/redis/client";
import { closeQueues } from "./lib/redis/queue";
import { drainAuditLogs } from "./middleware/audit";
import { closeAiRuntime } from "./modules/ai/service";

const server = Bun.serve({
	fetch(req, bunServer) {
		const remoteAddress = bunServer.requestIP(req)?.address ?? null;
		return app.fetch(req, { remoteAddress });
	},
	port: env.PORT,
});

logInfo("APIServer", `Listening on http://localhost:${server.port}`, {
	env: env.NODE_ENV,
	healthUrl: `http://localhost:${server.port}/api/health`,
});

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
	if (isShuttingDown) {
		return;
	}
	isShuttingDown = true;

	logInfo("APIServer", `Received ${signal}, shutting down gracefully...`);

	const forceExitTimer = setTimeout(() => {
		logError(
			"APIServer",
			new Error("Graceful shutdown timed out after 10s, forcing exit")
		);
		process.exit(1);
	}, 10_000);
	if (typeof forceExitTimer.unref === "function") {
		forceExitTimer.unref();
	}

	try {
		await server.stop(false);
		await drainAuditLogs(3000);
		await Promise.allSettled([
			closeAiRuntime(),
			closeQueues(),
			closeRedis(),
			closeDb(),
		]);
		clearTimeout(forceExitTimer);
		logInfo("APIServer", "Shutdown complete");
		process.exit(0);
	} catch (error) {
		clearTimeout(forceExitTimer);
		logError("APIServer", error);
		process.exit(1);
	}
}

process.once("SIGTERM", () => {
	void shutdown("SIGTERM");
});
process.once("SIGINT", () => {
	void shutdown("SIGINT");
});
