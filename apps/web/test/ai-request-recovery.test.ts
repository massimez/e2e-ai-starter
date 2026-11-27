import { expect, mock, test } from "bun:test";
import type { WorkspaceBriefResponse } from "@workspace/ai-core/contracts";
import {
	type AiChargeStatus,
	attemptWorkspaceBrief,
} from "../src/lib/ai-request-recovery";
import { ApiError } from "../src/lib/api-client";

const request = { id: "request-1", modelId: "google/gemini-3.5-flash-lite" };

const sampleBrief: WorkspaceBriefResponse = {
	generatedAt: "2026-11-27T12:00:00.000Z",
	highlights: ["All systems nominal"],
	metrics: {
		committedUploadCount: 2,
		memberCount: 3,
		organizationId: "org_acme",
		organizationName: "Acme",
		organizationSlug: "acme",
		recentFileNames: [],
		roleBreakdown: { member: 2, owner: 1 },
		storageCurrentUsageBytes: 1024,
		storageLimitBytes: 10_000,
		userRole: "member",
	},
	recommendedActions: [],
	risks: [],
	summary: "Healthy workspace.",
};

test("reports a committed charge after losing the response", async () => {
	const execute = mock(() => Promise.reject(new TypeError("Connection lost")));
	const lookup = async () => ({
		requestId: request.id,
		status: "charged" as const,
	});

	expect(await attemptWorkspaceBrief(request, execute, lookup, false)).toEqual({
		requestId: request.id,
		status: "charged",
	});
	expect(execute).toHaveBeenCalledTimes(1);
});

test("retries with the original request and skips the lookup on success", async () => {
	const execute = mock(() => Promise.resolve(sampleBrief));
	const lookup = mock(() => Promise.reject(new Error("Lookup unavailable")));
	expect(await attemptWorkspaceBrief(request, execute, lookup, true)).toEqual({
		data: sampleBrief,
		status: "success",
	});
	expect(execute).toHaveBeenCalledWith(request);
	expect(lookup).not.toHaveBeenCalled();
});

test("checks the ledger after a same-key retry returns a duplicate response", async () => {
	const execute = mock(() =>
		Promise.reject(new ApiError("Already charged", 409))
	);
	const lookup = mock(
		async (): Promise<AiChargeStatus> => ({
			requestId: request.id,
			status: "charged",
		})
	);
	expect(await attemptWorkspaceBrief(request, execute, lookup, true)).toEqual({
		requestId: request.id,
		status: "charged",
	});
	expect(execute).toHaveBeenCalledWith(request);
	expect(lookup).toHaveBeenCalledTimes(1);
});

test("surfaces definite rejections on both initial calls and unrecorded retries", async () => {
	const lookup = mock(
		async (): Promise<AiChargeStatus> => ({
			requestId: request.id,
			status: "reversed",
		})
	);
	const failed = () => Promise.reject(new ApiError("Upstream failure", 502));
	const unfunded = () =>
		Promise.reject(new ApiError("Insufficient credits", 402));

	expect(await attemptWorkspaceBrief(request, failed, lookup, false)).toEqual({
		requestId: request.id,
		status: "reversed",
	});
	expect(await attemptWorkspaceBrief(request, unfunded, lookup, false)).toEqual(
		{
			message: "Insufficient credits",
			status: "rejected",
		}
	);
	expect(lookup).toHaveBeenCalledTimes(1);

	// On retry, a previously reversed charge still reports reversed.
	expect(await attemptWorkspaceBrief(request, unfunded, lookup, true)).toEqual({
		requestId: request.id,
		status: "reversed",
	});
	expect(lookup).toHaveBeenCalledTimes(2);

	// On retry, if no charge was recorded, surface the 402 rejection instead of looping.
	lookup.mockResolvedValueOnce({ requestId: null, status: "not_recorded" });
	expect(await attemptWorkspaceBrief(request, unfunded, lookup, true)).toEqual({
		message: "Insufficient credits",
		status: "rejected",
	});
});

test("checks the ledger on 429 and surfaces rejection only when no charge was recorded", async () => {
	const throttled = () => Promise.reject(new ApiError("Rate limited", 429));
	const lookup = mock(
		async (): Promise<AiChargeStatus> => ({
			requestId: request.id,
			status: "charged",
		})
	);

	expect(
		await attemptWorkspaceBrief(request, throttled, lookup, false)
	).toEqual({
		requestId: request.id,
		status: "charged",
	});

	lookup.mockResolvedValueOnce({ requestId: null, status: "not_recorded" });
	expect(
		await attemptWorkspaceBrief(request, throttled, lookup, false)
	).toEqual({
		message: "Rate limited",
		status: "rejected",
	});
});

test("returns unknown when both execution and status lookup fail", async () => {
	const execute = () => Promise.reject(new TypeError("Offline"));
	const lookup = () => Promise.reject(new TypeError("Still offline"));

	expect(await attemptWorkspaceBrief(request, execute, lookup, false)).toEqual({
		requestId: request.id,
		status: "unknown",
	});
});
