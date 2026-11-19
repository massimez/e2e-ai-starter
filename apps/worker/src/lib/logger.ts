import { createLogger } from "@workspace/shared/logger";

export const workerLogger = createLogger({ service: "worker" });

export const { logDebug, logInfo, logWarning, logError } = workerLogger;
