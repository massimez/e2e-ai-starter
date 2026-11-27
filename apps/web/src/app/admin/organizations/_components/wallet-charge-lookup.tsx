"use client";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	useFindAdminWalletCharges,
	useReverseAdminWalletCharge,
} from "@/lib/admin-hooks";
import { formatDateTime } from "@/lib/format";

export function WalletChargeLookup({
	organizationId,
}: {
	organizationId: string;
}) {
	const inputId = useId();
	const [reversingEntryId, setReversingEntryId] = useState<string | null>(null);
	const lookup = useFindAdminWalletCharges(organizationId);
	const reverse = useReverseAdminWalletCharge(organizationId);

	const handleReverse = async (
		event: React.FormEvent<HTMLFormElement>,
		entryId: string
	) => {
		event.preventDefault();
		const reason = String(
			new FormData(event.currentTarget).get("reason") ?? ""
		).trim();
		if (reason.length === 0) {
			toast.error("Please enter a reason to reverse this charge.");
			return;
		}
		try {
			const result = await reverse.mutateAsync({ entryId, reason });
			setReversingEntryId(null);
			toast.success(
				result.applied
					? `Restored ${result.credits} credits.`
					: "This charge was already reversed."
			);
			if (lookup.variables) {
				lookup.mutate(lookup.variables);
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to reverse charge"
			);
		}
	};

	return (
		<div className="border-border space-y-3 rounded-lg border p-4">
			<form
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					const requestId = new FormData(event.currentTarget).get("requestId");
					if (typeof requestId === "string" && requestId.trim()) {
						setReversingEntryId(null);
						lookup.mutate(requestId.trim());
					}
				}}
			>
				<h3 className="font-medium">Find a wallet charge</h3>
				<div className="flex flex-wrap items-end gap-2">
					<div className="flex-1 space-y-1">
						<Label htmlFor={inputId}>Request ID</Label>
						<Input id={inputId} maxLength={64} name="requestId" required />
					</div>
					<Button disabled={lookup.isPending} type="submit" variant="outline">
						{lookup.isPending ? "Searching…" : "Find charge"}
					</Button>
				</div>
			</form>
			{lookup.error ? (
				<p className="text-destructive text-xs" role="alert">
					{lookup.error.message}
				</p>
			) : null}
			<div aria-live="polite">
				{lookup.data?.length === 0 ? (
					<p className="text-muted-foreground text-xs">
						No charge found for this request ID.
					</p>
				) : null}
				{lookup.data?.length ? (
					<ul className="divide-border divide-y text-xs">
						{lookup.data.map((charge) => (
							<li className="space-y-1.5 py-2" key={charge.entryId}>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p>
										{Math.abs(charge.delta)} credits{" "}
										{charge.reversalEntryId ? "restored" : "charged"} ·{" "}
										{formatDateTime(charge.createdAt)}
									</p>
									{!charge.reversalEntryId &&
									reversingEntryId !== charge.entryId ? (
										<Button
											onClick={() => setReversingEntryId(charge.entryId)}
											size="sm"
											type="button"
											variant="outline"
										>
											Reverse charge
										</Button>
									) : null}
								</div>
								<p className="text-muted-foreground">
									Actor: {charge.actorEmail ?? charge.actorId ?? "Deleted user"}
								</p>
								<p>
									Charge ID <code className="break-all">{charge.entryId}</code>
								</p>
								{!charge.reversalEntryId &&
								reversingEntryId === charge.entryId ? (
									<form
										className="flex flex-wrap items-end gap-2 pt-1"
										onSubmit={(event) =>
											void handleReverse(event, charge.entryId)
										}
									>
										<div className="flex-1 space-y-1">
											<Label
												className="text-xs"
												htmlFor={`${inputId}-reverse-reason`}
											>
												Reversal reason
											</Label>
											<Input
												id={`${inputId}-reverse-reason`}
												maxLength={240}
												name="reason"
												placeholder="Confirmed failed summary"
												required
											/>
										</div>
										<Button
											disabled={reverse.isPending}
											size="sm"
											type="submit"
										>
											{reverse.isPending ? "Reversing…" : "Confirm reversal"}
										</Button>
										<Button
											disabled={reverse.isPending}
											onClick={() => setReversingEntryId(null)}
											size="sm"
											type="button"
											variant="ghost"
										>
											Cancel
										</Button>
									</form>
								) : null}
							</li>
						))}
					</ul>
				) : null}
			</div>
		</div>
	);
}
