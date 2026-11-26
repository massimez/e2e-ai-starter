"use client";

import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { AdminPagination } from "@/lib/admin-hooks";

/**
 * Shared table frame handling loading skeletons, error + retry, empty states,
 * horizontal scroll container, and pagination across all `/admin/*` directory views.
 */
export function AdminTableFrame({
	children,
	emptyMessage,
	error,
	errorFallback,
	isEmpty,
	isError,
	isPending,
	itemLabel,
	onPageChange,
	onRetry,
	pagination,
}: {
	children: ReactNode;
	emptyMessage: string;
	error: unknown;
	errorFallback: string;
	isEmpty: boolean;
	isError: boolean;
	isPending: boolean;
	itemLabel: string;
	onPageChange?: (nextPage: number) => void;
	onRetry: () => void;
	pagination?: AdminPagination;
}) {
	if (isError) {
		const errorMessage = error instanceof Error ? error.message : errorFallback;
		return (
			<div className="space-y-2 p-6">
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
				<Button onClick={onRetry} size="sm" type="button" variant="outline">
					Try again
				</Button>
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="space-y-2 p-4">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
		);
	}

	if (isEmpty) {
		return (
			<p className="text-muted-foreground p-6 text-center text-sm">
				{emptyMessage}
			</p>
		);
	}

	return (
		<>
			<div className="overflow-x-auto">{children}</div>

			{pagination && onPageChange ? (
				<div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs">
					<p className="text-muted-foreground">
						Showing page {pagination.page} of {pagination.totalPages} (
						{pagination.total} total {itemLabel})
					</p>
					<div className="flex items-center gap-2">
						<Button
							disabled={pagination.page <= 1}
							onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
							size="sm"
							type="button"
							variant="outline"
						>
							<ChevronLeft className="mr-1 size-3.5" />
							Previous
						</Button>
						<Button
							disabled={!pagination.hasMore}
							onClick={() => onPageChange(pagination.page + 1)}
							size="sm"
							type="button"
							variant="outline"
						>
							Next
							<ChevronRight className="ml-1 size-3.5" />
						</Button>
					</div>
				</div>
			) : null}
		</>
	);
}

/**
 * Runs an async backoffice action and displays consistent success/error toasts.
 */
export async function runAdminAction<T>(
	action: () => Promise<T>,
	options: {
		errorFallback: string;
		successMessage: string | ((result: T) => string);
	}
): Promise<T | undefined> {
	try {
		const result = await action();
		const message =
			typeof options.successMessage === "function"
				? options.successMessage(result)
				: options.successMessage;
		toast.success(message);
		return result;
	} catch (error) {
		toast.error(error instanceof Error ? error.message : options.errorFallback);
		return undefined;
	}
}
