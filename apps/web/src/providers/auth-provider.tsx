"use client";

import { AuthModalProvider } from "@workspace/ui/components/auth/auth-modal-provider";
import { sanitizeInternalRedirect } from "@workspace/ui/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";
import {
	createContext,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { publicWebEnv } from "@/env";
import { authClient, useSession } from "@/lib/auth-client";

interface AuthOpenOptions {
	onSuccess?: () => Promise<void> | void;
	redirectTo?: string;
	socialRedirectTo?: string;
}

interface AuthContextType {
	openSignIn: (options?: AuthOpenOptions | string) => void;
	openSignUp: (options?: AuthOpenOptions | string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const normalizeAuthOptions = (
	options?: AuthOpenOptions | string
): AuthOpenOptions => {
	if (typeof options === "string") {
		return { redirectTo: sanitizeInternalRedirect(options) };
	}
	return {
		onSuccess: options?.onSuccess,
		redirectTo: sanitizeInternalRedirect(options?.redirectTo),
		socialRedirectTo: sanitizeInternalRedirect(options?.socialRedirectTo),
	};
};

function AuthSearchParamsSync({
	openSignIn,
	openSignUp,
}: {
	openSignIn: (options?: AuthOpenOptions | string) => void;
	openSignUp: (options?: AuthOpenOptions | string) => void;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const { data: session, isPending } = useSession();
	const handledParamsRef = useRef<string | null>(null);

	useEffect(() => {
		if (isPending) {
			return;
		}
		const authParam = searchParams.get("auth")?.toLowerCase();
		if (authParam !== "signin" && authParam !== "signup") {
			handledParamsRef.current = null;
			return;
		}

		const paramsKey = searchParams.toString();
		if (handledParamsRef.current === paramsKey) {
			return;
		}
		handledParamsRef.current = paramsKey;

		const callbackUrl = sanitizeInternalRedirect(
			searchParams.get("callbackUrl") ?? undefined
		);

		if (session?.user) {
			if (callbackUrl) {
				router.replace(callbackUrl);
			}
			return;
		}

		const options: AuthOpenOptions = callbackUrl
			? { redirectTo: callbackUrl, socialRedirectTo: callbackUrl }
			: {};
		if (authParam === "signup") {
			openSignUp(options);
		} else {
			openSignIn(options);
		}
	}, [isPending, openSignIn, openSignUp, router, searchParams, session?.user]);

	return null;
}

export function AuthProvider({
	children,
	nonce,
}: {
	children: React.ReactNode;
	nonce?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [view, setView] = useState<"signIn" | "signUp">("signIn");
	const [redirectTo, setRedirectTo] = useState<string | undefined>(undefined);
	const [socialRedirectTo, setSocialRedirectTo] = useState<string | undefined>(
		undefined
	);
	const [successHandler, setSuccessHandler] = useState<
		(() => Promise<void> | void) | undefined
	>(undefined);
	const router = useRouter();

	const openSignIn = useCallback((options?: AuthOpenOptions | string) => {
		const normalized = normalizeAuthOptions(options);
		setRedirectTo(normalized.redirectTo);
		setSocialRedirectTo(normalized.socialRedirectTo);
		setSuccessHandler(() => normalized.onSuccess);
		setView("signIn");
		setIsOpen(true);
	}, []);

	const openSignUp = useCallback((options?: AuthOpenOptions | string) => {
		const normalized = normalizeAuthOptions(options);
		setRedirectTo(normalized.redirectTo);
		setSocialRedirectTo(normalized.socialRedirectTo);
		setSuccessHandler(() => normalized.onSuccess);
		setView("signUp");
		setIsOpen(true);
	}, []);

	const handleSuccess = useCallback(async () => {
		setIsOpen(false);
		if (successHandler) {
			await successHandler();
			setSuccessHandler(undefined);
		}
		if (redirectTo) {
			router.push(redirectTo);
		} else {
			router.refresh();
		}
	}, [redirectTo, router, successHandler]);

	const value = useMemo(
		() => ({
			openSignIn,
			openSignUp,
		}),
		[openSignIn, openSignUp]
	);

	return (
		<AuthContext.Provider value={value}>
			<Suspense fallback={null}>
				<AuthSearchParamsSync openSignIn={openSignIn} openSignUp={openSignUp} />
			</Suspense>
			{children}
			<AuthModalProvider
				authClient={authClient}
				cspNonce={nonce}
				defaultView={view}
				googleAuthEnabled={publicWebEnv.googleAuthEnabled}
				onOpenChange={setIsOpen}
				onSignInSuccess={handleSuccess}
				onSignUpSuccess={handleSuccess}
				open={isOpen}
				redirectTo={redirectTo}
				socialRedirectTo={socialRedirectTo}
				toast={toast}
				turnstileSiteKey={publicWebEnv.turnstileSiteKey || undefined}
			/>
		</AuthContext.Provider>
	);
}

export function useAuthModal() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuthModal must be used within an AuthProvider");
	}
	return context;
}
