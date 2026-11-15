"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
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

type ViewType =
	| "signIn"
	| "signUp"
	| "verificationOtp"
	| "forgetPassword"
	| "resetPasswordOtp";

interface AuthErrorLike {
	code?: string;
	message?: string;
	statusText?: string;
}

interface AuthResponseLike {
	error?: AuthErrorLike | null;
}

interface AuthRequestOptions {
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
		sendVerificationOtp: (input: {
			email: string;
			type: "email-verification" | "forget-password" | "sign-in";
		}) => Promise<AuthResponseLike>;
		verifyEmail: (input: {
			email: string;
			otp: string;
		}) => Promise<AuthResponseLike>;
	};
	forgetPassword: {
		emailOtp: (input: { email: string }) => Promise<AuthResponseLike>;
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
	fallback: string
): string {
	return error?.message || error?.statusText || fallback;
}

export function AuthModalProvider({
	open,
	onOpenChange,
	defaultView = "signIn",
	googleAuthEnabled = true,
	authClient,
	locale,
	onSignInSuccess,
	onSignUpSuccess,
	onPasswordResetSuccess,
	toast,
	translations: translationsProp,
	redirectTo,
	socialRedirectTo,
}: AuthModalProviderProps) {
	const translations = getLocaleTranslations(locale, translationsProp);

	const [view, setView] = useState<ViewType>(defaultView);
	const [verificationOrigin, setVerificationOrigin] = useState<
		"signIn" | "signUp"
	>("signUp");
	const [otpProps, setOtpProps] = useState<OtpVerificationProps | null>(null);
	const [resetPasswordProps, setResetPasswordProps] =
		useState<ResetPasswordOtpProps | null>(null);

	// Sync internal view with defaultView when modal opens
	useEffect(() => {
		if (open) {
			setView(defaultView);
		}
	}, [open, defaultView]);

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
					const message = formatAuthError(error, "Verification failed");
					toast.error(message);
					return { error: message };
				}

				toast.success(translations.notifications.email_verified);
				const signInRes = await authClient.signIn.email({
					email,
					password,
				});
				if (signInRes.error) {
					const message = formatAuthError(
						signInRes.error,
						"Email verified, but automatic sign-in failed. Please sign in manually."
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
				const { error } = await authClient.emailOtp.sendVerificationOtp({
					email,
					type: "email-verification",
				});

				if (error) {
					toast.error(formatAuthError(error, "Failed to resend OTP"));
					return null;
				}

				toast.success(translations.notifications.verification_resent);
				return { status: 200, statusText: "OK" };
			},
		});
		setView("verificationOtp");
	};

	const handleSignIn = async (email: string, password: string) => {
		await authClient.signIn.email(
			{
				email,
				password,
			},
			{
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
						const { error: otpError } =
							await authClient.emailOtp.sendVerificationOtp({
								email,
								type: "email-verification",
							});
						if (otpError) {
							toast.error(
								formatAuthError(otpError, "Failed to send verification code")
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
						toast.error(formatAuthError(ctx.error, "Failed to sign in"));
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
						formatAuthError(ctx.error, "Social authentication failed")
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
				onSuccess: () => {
					handleVerification({
						email: data.email,
						origin: "signUp",
						password: data.password,
						onVerificationSuccess: onSignUpSuccess,
					});
				},
				onError: (ctx) => {
					toast.error(formatAuthError(ctx.error, "Failed to create account"));
				},
			}
		);
	};

	const handleSendResetCode = async (email: string) => {
		const { error } = await authClient.forgetPassword.emailOtp({
			email,
		});

		if (error) {
			toast.error(formatAuthError(error, "Failed to send reset code"));
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
					toast.error(formatAuthError(resetError, "Failed to reset password"));
					return;
				}

				toast.success(translations.notifications.password_reset_success);
				setResetPasswordProps(null);
				setView("signIn");
				onPasswordResetSuccess?.();
			},
			onResendOtp: async () => {
				const { error: resendError } = await authClient.forgetPassword.emailOtp(
					{
						email,
					}
				);
				if (resendError) {
					toast.error(formatAuthError(resendError, "Failed to resend OTP"));
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

	const renderActiveView = () => {
		const socialHandler = googleAuthEnabled ? handleSocialLogin : undefined;
		switch (view) {
			case "signUp":
				return (
					<SignUp
						onClickCreateAccount={handleSignUp}
						onClickSignIn={() => setView("signIn")}
						onSocialLoginClick={socialHandler}
						translations={translations.signUp}
					/>
				);
			case "forgetPassword":
				return (
					<ForgetPassword
						openSignIn={() => setView("signIn")}
						sentResetCode={handleSendResetCode}
						translations={translations.forgetPassword}
					/>
				);
			case "resetPasswordOtp":
				if (resetPasswordProps) {
					return <ResetPasswordOtp {...resetPasswordProps} />;
				}
				return (
					<ForgetPassword
						openSignIn={() => setView("signIn")}
						sentResetCode={handleSendResetCode}
						translations={translations.forgetPassword}
					/>
				);
			case "verificationOtp":
				if (otpProps) {
					return <OtpVerification {...otpProps} />;
				}
				return (
					<SignIn
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
