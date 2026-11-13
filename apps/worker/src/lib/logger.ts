import { createLogger } from "@workspace/api/logger";

export const workerLogger = createLogger({ service: "worker" });

export const { logDebug, logInfo, logWarning, logError } = workerLogger;
