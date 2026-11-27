import type { WorkspaceBriefResponse } from "@workspace/ai-core/contracts";
import { ApiError, type client, type InferResponseType } from "./api-client";

export interface BriefRequest {
	id: string;
	modelId?: string;
}

export type AiChargeStatus = InferResponseType<
	(typeof client.api.ai.operations)[":operationId"]["$get"],
	200
>["data"];

export type BriefRequestOutcome =
	| { data: WorkspaceBriefResponse; status: "success" }
	| { message: string; status: "rejected" }
	| { requestId: string; status: AiChargeStatus["status"] | "unknown" };

function isDefinitePreChargeRejection(error: unknown): error is ApiError {
	return (
		error instanceof ApiError &&
		error.status >= 400 &&
		error.status < 500 &&
		![408, 409, 429, 499].includes(error.status)
	);
}

export async function attemptWorkspaceBrief(
	request: BriefRequest,
	execute: (request: BriefRequest) => Promise<WorkspaceBriefResponse>,
	lookup: (id: string) => Promise<AiChargeStatus>,
	retry: boolean
): Promise<BriefRequestOutcome> {
	let rejectedMessage: string | null = null;

	try {
		return { data: await execute(request), status: "success" };
	} catch (error) {
		if (isDefinitePreChargeRejection(error)) {
			if (!retry) {
				return { message: error.message, status: "rejected" };
			}
			rejectedMessage = error.message;
		} else if (error instanceof ApiError && error.status === 429) {
			rejectedMessage = error.message;
		}
	}

	try {
		const result = await lookup(request.id);
		if (rejectedMessage && result.status === "not_recorded") {
			return { message: rejectedMessage, status: "rejected" };
		}
		return { requestId: result.requestId ?? request.id, status: result.status };
	} catch (error) {
		console.warn("Unable to check AI charge status", {
			error,
			requestId: request.id,
		});
		return { requestId: request.id, status: "unknown" };
	}
}
