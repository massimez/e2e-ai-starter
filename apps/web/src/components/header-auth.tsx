"use client";

import { Button } from "@workspace/ui/components/button";
import { NotificationCenter } from "@workspace/ui/components/notification-center";
import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import {
	type AccountMenuUser,
	UserAccountMenu,
} from "@/components/user-account-menu";
import { publicWebEnv } from "@/env";
import { useSession } from "@/lib/auth-client";
import { useCurrentOrganization } from "@/lib/organization-hooks";
import { useAuthModal } from "@/providers/auth-provider";

function SignedInHeaderControls({ user }: { user: AccountMenuUser }) {
	const router = useRouter();
	const { currentUserRole } = useCurrentOrganization();

	return (
		<div className="flex shrink-0 items-center gap-2">
			<ThemeToggle />
			<NotificationCenter
				apiUrl={publicWebEnv.apiUrl}
				onNavigate={(path) => router.push(path)}
			/>

			<UserAccountMenu role={currentUserRole} user={user} />
		</div>
	);
}

export function HeaderAuth() {
	const { data: session, isPending } = useSession();
	const { openSignIn, openSignUp } = useAuthModal();
	const user = session?.user;

	if (isPending) {
		return (
			<div className="flex shrink-0 items-center gap-2">
				<ThemeToggle />
				<div className="bg-muted h-9 w-24 animate-pulse rounded-md" />
			</div>
		);
	}

	if (user) {
		return <SignedInHeaderControls user={user} />;
	}

	return (
		<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
			<ThemeToggle />
			<Button
				className="gap-1.5"
				onClick={() => openSignIn()}
				size="sm"
				type="button"
				variant="ghost"
			>
				<LogIn aria-hidden="true" className="h-4 w-4" />
				<span>Sign In</span>
			</Button>
			<Button
				className="hidden sm:inline-flex"
				onClick={() => openSignUp()}
				size="sm"
				type="button"
				variant="primary"
			>
				Create Account
			</Button>
		</div>
	);
}
