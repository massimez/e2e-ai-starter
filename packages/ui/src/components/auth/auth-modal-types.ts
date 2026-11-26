import defaultTranslations from "./translations.json";
import type { TurnstileTranslations } from "./turnstile-widget";

export type ViewType =
	| "signIn"
	| "signUp"
	| "verificationOtp"
	| "twoFactorOtp"
	| "forgetPassword"
	| "resetPasswordOtp";

export const VIEW_CAPTCHA_ACTION: Record<ViewType, string> = {
	forgetPassword: "forget-password",
	resetPasswordOtp: "reset-password",
	signIn: "sign-in",
	signUp: "sign-up",
	twoFactorOtp: "two-factor",
	verificationOtp: "otp",
};

export interface AuthErrorLike {
	code?: string;
	message?: string;
	statusText?: string;
}

export interface AuthResponseLike {
	data?: unknown;
	error?: AuthErrorLike | null;
}

export interface AuthRequestOptions {
	headers?: Record<string, string>;
	onError?: (ctx: { error: AuthErrorLike }) => Promise<void> | void;
	onSuccess?: (ctx: { data?: unknown }) => Promise<void> | void;
}

export interface AuthModalClient {
	emailOtp: {
		resetPassword: (input: {
			email: string;
			otp: string;
			password: string;
		}) => Promise<AuthResponseLike>;
		sendVerificationOtp: (
			input: {
				email: string;
				type: "email-verification" | "forget-password" | "sign-in";
			},
			options?: AuthRequestOptions
		) => Promise<AuthResponseLike>;
		verifyEmail: (input: {
			email: string;
			otp: string;
		}) => Promise<AuthResponseLike>;
	};
	forgetPassword: {
		emailOtp: (
			input: { email: string },
			options?: AuthRequestOptions
		) => Promise<AuthResponseLike>;
	};
	signIn: {
		email: (
			input: { email: string; password: string },
			options?: AuthRequestOptions
		) => Promise<AuthResponseLike>;
		social: (
			input: { provider: string; callbackURL?: string },
			options?: AuthRequestOptions
		) => Promise<AuthResponseLike>;
	};
	signUp: {
		email: (
			input: {
				email: string;
				firstName?: string;
				lastName?: string;
				locale?: string;
				name: string;
				password: string;
			},
			options?: AuthRequestOptions
		) => Promise<AuthResponseLike>;
	};
	twoFactor?: {
		verifyBackupCode?: (input: {
			code: string;
			trustDevice?: boolean;
		}) => Promise<AuthResponseLike>;
		verifyTotp: (input: {
			code: string;
			trustDevice?: boolean;
		}) => Promise<AuthResponseLike>;
	};
}

export interface AuthModalProviderProps {
	authClient: AuthModalClient;
	cspNonce?: string;
	defaultView?: ViewType;
	googleAuthEnabled?: boolean;
	locale?: string;
	onOpenChange: (open: boolean) => void;
	onPasswordResetSuccess?: () => void;
	onSignInSuccess?: () => Promise<void> | void;
	onSignUpSuccess?: () => Promise<void> | void;
	open: boolean;
	redirectTo?: string;
	socialRedirectTo?: string;
	toast: {
		success: (message: string) => void;
		error: (message: string) => void;
		info: (message: string) => void;
	};
	translations?: typeof defaultTranslations.en;
	turnstileSiteKey?: string;
}

export function getLocaleTranslations(
	locale: string | undefined,
	override: typeof defaultTranslations.en | undefined
): typeof defaultTranslations.en {
	if (override) {
		return override;
	}
	if (locale && locale in defaultTranslations) {
		return defaultTranslations[locale as keyof typeof defaultTranslations];
	}
	return defaultTranslations.en;
}

export function formatAuthError(
	error: AuthErrorLike | null | undefined,
	fallback: string,
	captchaTranslations?: TurnstileTranslations
): string {
	if (
		captchaTranslations &&
		(error?.code === "VERIFICATION_FAILED" ||
			error?.code === "MISSING_RESPONSE")
	) {
		return captchaTranslations.failed;
	}
	return error?.message || error?.statusText || fallback;
}
