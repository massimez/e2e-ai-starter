"use client";

import { Button } from "@workspace/ui/components/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useAuthModal } from "@/providers/auth-provider";

export function HeroWorkspaceCta() {
	const { data: session, isPending } = useSession();
	const { openSignIn } = useAuthModal();

	if (isPending || session?.user) {
		return (
			<Button asChild autoHeight size="md" variant="primary">
				<Link href="/dashboard">
					<span>Open Workspace</span>
					<ArrowRight aria-hidden="true" />
				</Link>
			</Button>
		);
	}

	return (
		<Button
			autoHeight
			onClick={() =>
				openSignIn({
					redirectTo: "/dashboard",
					socialRedirectTo: "/dashboard",
				})
			}
			size="md"
			type="button"
			variant="primary"
		>
			<span>Open Workspace</span>
			<ArrowRight aria-hidden="true" />
		</Button>
	);
}
