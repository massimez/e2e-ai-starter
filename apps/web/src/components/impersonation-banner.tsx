"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { ShieldAlert, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";

/**
 * Global sticky banner rendered whenever an active session carries `impersonatedBy`
 * from Better Auth's `admin()` plugin, giving operators an unmistakable visual cue
 * and one-click exit back to `/admin/users`.
 */
export function ImpersonationBanner() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: sessionData, refetch } = useSession();
	const [isStopping, setIsStopping] = useState(false);

	const impersonatedBy = (
		sessionData?.session as { impersonatedBy?: string | null } | undefined
	)?.impersonatedBy;

	if (!(impersonatedBy && sessionData?.user)) {
		return null;
	}

	const handleStopImpersonating = async () => {
		setIsStopping(true);
		try {
			const result = await authClient.admin.stopImpersonating();
			if (result.error) {
				toast.error(result.error.message || "Failed to stop impersonation");
				return;
			}
			queryClient.clear();
			await refetch();
			toast.success("Returned to your platform administrator session");
			router.push("/admin/users");
			router.refresh();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to stop impersonation"
			);
		} finally {
			setIsStopping(false);
		}
	};

	return (
		<div
			className="sticky top-0 z-50 border-b border-amber-500/40 bg-amber-50 px-4 py-2 text-amber-950 backdrop-blur-xs dark:bg-amber-950/95 dark:text-amber-100"
			role="status"
		>
			<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
				<div className="flex items-center gap-2">
					<ShieldAlert
						aria-hidden="true"
						className="size-4 shrink-0 text-amber-700 dark:text-amber-300"
					/>
					<span>
						Impersonating{" "}
						<strong className="font-semibold">
							{sessionData.user.name || sessionData.user.email}
						</strong>{" "}
						<span className="font-mono text-xs opacity-80">
							({sessionData.user.email})
						</span>
						. All actions are recorded in the audit log.
					</span>
				</div>
				<Button
					disabled={isStopping}
					onClick={() => void handleStopImpersonating()}
					size="sm"
					type="button"
					variant="outline"
				>
					<Undo2 aria-hidden="true" className="mr-1.5 size-3.5" />
					{isStopping ? "Restoring..." : "Stop Impersonating"}
				</Button>
			</div>
		</div>
	);
}
