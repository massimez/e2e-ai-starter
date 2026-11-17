"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { resolveSameOriginUrl } from "../../lib/utils";
import { Dialog, DialogContent } from "../dialog";
import { ForgetPassword } from "./forget-password";
import { OtpVerification, type OtpVerificationProps } from "./otp-verification";
import {
	ResetPasswordOtp,
	type ResetPasswordOtpProps,
} from "./reset-password-otp";
import { SignIn } from "./sign-in";
import { SignUp } from "./sign-up";
import defaultTranslations from "./translations.json";
import {
	CaptchaUnavailableError,
	type TurnstileHandle,
	type TurnstileTranslations,
	TurnstileWidget,
} from "./turnstile-widget";

type ViewType =
	| "signIn"
	| "signUp"
	| "verificationOtp"
	| "forgetPassword"
	| "resetPasswordOtp";

const VIEW_CAPTCHA_ACTION: Record<ViewType, string> = {
	forgetPassword: "forget-password",
	resetPasswordOtp: "reset-password",
	signIn: "sign-in",
	signUp: "sign-up",
	verificationOtp: "otp",
};

interface AuthErrorLike {
	code?: string;
	message?: string;
	statusText?: string;
}

interface AuthResponseLike {
	error?: AuthErrorLike | null;
}

interface AuthRequestOptions {
	headers?: Record<string, string>;
	onError?: (ctx: { error: AuthErrorLike }) => Promise<void> | void;
	onSuccess?: () => Promise<void> | void;
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

function getLocaleTranslations(
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

function formatAuthError(
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

export function AuthModalProvider({
	open,
	onOpenChange,
	defaultView = "signIn",
	googleAuthEnabled = true,
	authClient,
	cspNonce,
	locale,
	onSignInSuccess,
	onSignUpSuccess,
	onPasswordResetSuccess,
	toast,
	translations: translationsProp,
	redirectTo,
	socialRedirectTo,
	turnstileSiteKey,
}: AuthModalProviderProps) {
	const translations = getLocaleTranslations(locale, translationsProp);
	const captchaTranslations =
		translations.captcha ?? defaultTranslations.en.captcha;

	const [view, setView] = useState<ViewType>(defaultView);
	const [verificationOrigin, setVerificationOrigin] = useState<
		"signIn" | "signUp"
	>("signUp");
	const [otpProps, setOtpProps] = useState<OtpVerificationProps | null>(null);
	const [resetPasswordProps, setResetPasswordProps] =
		useState<ResetPasswordOtpProps | null>(null);
	const turnstileRef = useRef<TurnstileHandle>(null);
	const isOpenRef = useRef(open);
	isOpenRef.current = open;

	// Sync internal view with defaultView when modal opens
	useEffect(() => {
		if (open) {
			setView(defaultView);
		}
	}, [open, defaultView]);

	const resetCaptcha = () => {
		if (turnstileSiteKey && turnstileRef.current) {
			turnstileRef.current.reset();
		}
	};

	const acquireCaptchaHeaders = async (
		forceRefresh = false
	): Promise<Record<string, string> | undefined> => {
		if (!turnstileSiteKey) {
			return undefined;
		}
		const widget = turnstileRef.current;
		if (!widget) {
			throw new CaptchaUnavailableError(captchaTranslations.unavailable);
		}
		if (forceRefresh) {
			widget.reset();
		}
		const token = await widget.getToken();
		return { "x-captcha-response": token };
	};

	const showCaptchaAcquisitionError = (error: unknown) => {
		if (!isOpenRef.current) {
			return;
		}
		toast.error(
			error instanceof Error ? error.message : captchaTranslations.unavailable
		);
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setOtpProps(null);
			setResetPasswordProps(null);
		}
		onOpenChange(nextOpen);
	};

	const handleVerification = ({
		email,
		origin,
		password,
		onVerificationSuccess,
	}: {
		email: string;
		origin: "signIn" | "signUp";
		password: string;
		onVerificationSuccess?: () => Promise<void> | void;
	}) => {
		setVerificationOrigin(origin);
		setOtpProps({
			title: translations.otpVerification.title,
			description: translations.otpVerification.description.replace(
				"{email}",
				email
			),
			length: 6,
			translations: translations.otpVerification,
			onSubmit: async (otp: string) => {
				const { error } = await authClient.emailOtp.verifyEmail({
					email,
					otp,
				});

				if (error) {
					const message = formatAuthError(
						error,
						"Verification failed",
						captchaTranslations
					);
					toast.error(message);
					return { error: message };
				}

				toast.success(translations.notifications.email_verified);
				let headers: Record<string, string> | undefined;
				try {
					headers = await acquireCaptchaHeaders();
				} catch (captchaError) {
					showCaptchaAcquisitionError(captchaError);
					setView("signIn");
					return;
				}

				const signInRes = await authClient.signIn.email(
					{
						email,
						password,
					},
					headers ? { headers } : undefined
				);
				if (signInRes.error) {
					resetCaptcha();
					const message = formatAuthError(
						signInRes.error,
						"Email verified, but automatic sign-in failed. Please sign in manually.",
						captchaTranslations
					);
					toast.error(message);
					setView("signIn");
					return;
				}

				if (onVerificationSuccess) {
					await onVerificationSuccess();
				}
			},
			onResend: async () => {
				let headers: Record<string, string> | undefined;
				try {
					headers = await acquireCaptchaHeaders();
				} catch (captchaError) {
					showCaptchaAcquisitionError(captchaError);
					return null;
				}

				const { error } = await authClient.emailOtp.sendVerificationOtp(
					{
						email,
						type: "email-verification",
					},
					headers ? { headers } : undefined
				);

				resetCaptcha();

				if (error) {
					toast.error(
						formatAuthError(error, "Failed to resend OTP", captchaTranslations)
					);
					return null;
				}

				toast.success(translations.notifications.verification_resent);
				return { status: 200, statusText: "OK" };
			},
		});
		setView("verificationOtp");
	};

	const handleSignIn = async (email: string, password: string) => {
		let headers: Record<string, string> | undefined;
		try {
			headers = await acquireCaptchaHeaders();
		} catch (captchaError) {
			showCaptchaAcquisitionError(captchaError);
			return;
		}

		await authClient.signIn.email(
			{
				email,
				password,
			},
			{
				...(headers ? { headers } : {}),
				onSuccess: () => {
					toast.success(translations.notifications.signed_in);
					if (onSignInSuccess) {
						Promise.resolve(onSignInSuccess()).catch((error: unknown) => {
							console.error(error);
						});
					}
				},
				onError: async (ctx) => {
					if (ctx.error.code === "EMAIL_NOT_VERIFIED") {
						let resendHeaders: Record<string, string> | undefined;
						try {
							resendHeaders = await acquireCaptchaHeaders(true);
						} catch (captchaError) {
							showCaptchaAcquisitionError(captchaError);
							return;
						}

						const { error: otpError } =
							await authClient.emailOtp.sendVerificationOtp(
								{
									email,
									type: "email-verification",
								},
								resendHeaders ? { headers: resendHeaders } : undefined
							);
						if (otpError) {
							resetCaptcha();
							toast.error(
								formatAuthError(
									otpError,
									"Failed to send verification code",
									captchaTranslations
								)
							);
							return;
						}
						handleVerification({
							email,
							origin: "signIn",
							password,
							onVerificationSuccess: onSignInSuccess,
						});
					} else {
						resetCaptcha();
						toast.error(
							formatAuthError(
								ctx.error,
								"Failed to sign in",
								captchaTranslations
							)
						);
					}
				},
			}
		);
	};

	const handleSocialLogin = async (provider: string) => {
		const rawTarget =
			socialRedirectTo ??
			(view === "signIn" && redirectTo === "/onboarding"
				? "/dashboard"
				: redirectTo);
		await authClient.signIn.social(
			{
				provider,
				callbackURL: resolveSameOriginUrl(rawTarget, window.location.href),
			},
			{
				onError: (ctx) => {
					toast.error(
						formatAuthError(
							ctx.error,
							"Social authentication failed",
							captchaTranslations
						)
					);
				},
			}
		);
	};

	const handleSignUp = async (data: {
		email: string;
		password: string;
		firstName: string;
		lastName: string;
	}) => {
		let headers: Record<string, string> | undefined;
		try {
			headers = await acquireCaptchaHeaders();
		} catch (captchaError) {
			showCaptchaAcquisitionError(captchaError);
			return;
		}

		const trimmedFirst = data.firstName.trim();
		const trimmedLast = data.lastName.trim();
		await authClient.signUp.email(
			{
				email: data.email,
				password: data.password,
				firstName: trimmedFirst,
				lastName: trimmedLast,
				name: `${trimmedFirst} ${trimmedLast}`,
				...(locale ? { locale } : {}),
			},
			{
				...(headers ? { headers } : {}),
				onSuccess: () => {
					handleVerification({
						email: data.email,
						origin: "signUp",
						password: data.password,
						onVerificationSuccess: onSignUpSuccess,
					});
				},
				onError: (ctx) => {
					resetCaptcha();
					toast.error(
						formatAuthError(
							ctx.error,
							"Failed to create account",
							captchaTranslations
						)
					);
				},
			}
		);
	};

	const handleSendResetCode = async (email: string) => {
		let headers: Record<string, string> | undefined;
		try {
			headers = await acquireCaptchaHeaders();
		} catch (captchaError) {
			showCaptchaAcquisitionError(captchaError);
			return;
		}

		const { error } = await authClient.forgetPassword.emailOtp(
			{
				email,
			},
			headers ? { headers } : undefined
		);

		if (error) {
			resetCaptcha();
			toast.error(
				formatAuthError(error, "Failed to send reset code", captchaTranslations)
			);
			return;
		}

		toast.success(translations.notifications.reset_otp_sent);

		setResetPasswordProps({
			email,
			translations: translations.resetPasswordOtp,
			handleResetPassword: async (
				resetEmail: string,
				otp: string,
				newPassword: string
			) => {
				const { error: resetError } = await authClient.emailOtp.resetPassword({
					email: resetEmail,
					otp,
					password: newPassword,
				});

				if (resetError) {
					toast.error(
						formatAuthError(
							resetError,
							"Failed to reset password",
							captchaTranslations
						)
					);
					return;
				}

				toast.success(translations.notifications.password_reset_success);
				setResetPasswordProps(null);
				setView("signIn");
				onPasswordResetSuccess?.();
			},
			onResendOtp: async () => {
				let resendHeaders: Record<string, string> | undefined;
				try {
					resendHeaders = await acquireCaptchaHeaders();
				} catch (captchaError) {
					showCaptchaAcquisitionError(captchaError);
					return;
				}

				const { error: resendError } = await authClient.forgetPassword.emailOtp(
					{
						email,
					},
					resendHeaders ? { headers: resendHeaders } : undefined
				);
				resetCaptcha();
				if (resendError) {
					toast.error(
						formatAuthError(
							resendError,
							"Failed to resend OTP",
							captchaTranslations
						)
					);
				} else {
					toast.success(translations.notifications.otp_resent);
				}
			},
		});
		setView("resetPasswordOtp");
	};

	const handleBack = () => {
		if (view === "signIn") {
			handleOpenChange(false);
		} else if (view === "signUp" || view === "forgetPassword") {
			setView("signIn");
		} else if (view === "resetPasswordOtp") {
			setView("forgetPassword");
		} else if (view === "verificationOtp") {
			setView(verificationOrigin);
		}
	};

	const captchaSlot =
		open && turnstileSiteKey ? (
			<TurnstileWidget
				action={VIEW_CAPTCHA_ACTION[view]}
				key={view}
				language={locale}
				nonce={cspNonce}
				ref={turnstileRef}
				siteKey={turnstileSiteKey}
				translations={captchaTranslations}
			/>
		) : null;

	const renderActiveView = () => {
		const socialHandler = googleAuthEnabled ? handleSocialLogin : undefined;
		switch (view) {
			case "signUp":
				return (
					<SignUp
						captchaSlot={captchaSlot}
						onClickCreateAccount={handleSignUp}
						onClickSignIn={() => setView("signIn")}
						onSocialLoginClick={socialHandler}
						translations={translations.signUp}
					/>
				);
			case "forgetPassword":
				return (
					<ForgetPassword
						captchaSlot={captchaSlot}
						openSignIn={() => setView("signIn")}
						sentResetCode={handleSendResetCode}
						translations={translations.forgetPassword}
					/>
				);
			case "resetPasswordOtp":
				if (resetPasswordProps) {
					return (
						<ResetPasswordOtp
							{...resetPasswordProps}
							captchaSlot={captchaSlot}
						/>
					);
				}
				return (
					<ForgetPassword
						captchaSlot={captchaSlot}
						openSignIn={() => setView("signIn")}
						sentResetCode={handleSendResetCode}
						translations={translations.forgetPassword}
					/>
				);
			case "verificationOtp":
				if (otpProps) {
					return <OtpVerification {...otpProps} captchaSlot={captchaSlot} />;
				}
				return (
					<SignIn
						captchaSlot={captchaSlot}
						onForgetPasswordClick={async () => setView("forgetPassword")}
						onLoginClick={handleSignIn}
						onSignUpClick={async () => setView("signUp")}
						onSocialLoginClick={socialHandler}
						translations={translations.signIn}
					/>
				);
			default:
				return (
					<SignIn
						captchaSlot={captchaSlot}
						onForgetPasswordClick={async () => setView("forgetPassword")}
						onLoginClick={handleSignIn}
						onSignUpClick={async () => setView("signUp")}
						onSocialLoginClick={socialHandler}
						translations={translations.signIn}
					/>
				);
		}
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:w-full sm:max-w-[500px] sm:rounded-lg sm:p-8">
				{/* Back Button - Only on mobile */}
				<button
					aria-label="Go back"
					className="hover:bg-accent focus-visible:ring-ring absolute inset-s-3 top-3 z-10 inline-flex size-11 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden sm:hidden"
					onClick={handleBack}
					type="button"
				>
					<ArrowLeft aria-hidden="true" className="h-5 w-5 rtl:rotate-180" />
				</button>

				{/* Content Container with scroll on mobile */}
				<div className="flex flex-1 items-center justify-center overflow-y-auto p-6 sm:block sm:overflow-visible sm:p-0">
					<div className="w-full max-w-md sm:max-w-none">
						{renderActiveView()}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
