"use client";

import { type RefObject, useState } from "react";
import { resolveSameOriginUrl } from "../../lib/utils";
import {
	type AuthModalClient,
	formatAuthError,
	type ViewType,
} from "./auth-modal-types";
import type { OtpVerificationProps } from "./otp-verification";
import type { ResetPasswordOtpProps } from "./reset-password-otp";
import type defaultTranslations from "./translations.json";
import type {
	TurnstileHandle,
	TurnstileTranslations,
} from "./turnstile-widget";

interface UseAuthModalActionsParams {
	authClient: AuthModalClient;
	captchaTranslations: TurnstileTranslations;
	isOpenRef: RefObject<boolean>;
	locale?: string;
	onPasswordResetSuccess?: () => void;
	onSignInSuccess?: () => Promise<void> | void;
	onSignUpSuccess?: () => Promise<void> | void;
	redirectTo?: string;
	setView: (view: ViewType) => void;
	socialRedirectTo?: string;
	toast: {
		success: (message: string) => void;
		error: (message: string) => void;
		info: (message: string) => void;
	};
	translations: typeof defaultTranslations.en;
	turnstileRef: RefObject<TurnstileHandle | null>;
	turnstileSiteKey?: string;
	view: ViewType;
}

export function useAuthModalActions({
	authClient,
	captchaTranslations,
	isOpenRef,
	locale,
	onPasswordResetSuccess,
	onSignInSuccess,
	onSignUpSuccess,
	redirectTo,
	setView,
	socialRedirectTo,
	toast,
	translations,
	turnstileRef,
	turnstileSiteKey,
	view,
}: UseAuthModalActionsParams) {
	const [verificationOrigin, setVerificationOrigin] = useState<
		"signIn" | "signUp"
	>("signUp");
	const [otpProps, setOtpProps] = useState<OtpVerificationProps | null>(null);
	const [resetPasswordProps, setResetPasswordProps] =
		useState<ResetPasswordOtpProps | null>(null);

	const resetCaptcha = () => {
		if (turnstileSiteKey && turnstileRef.current) {
			turnstileRef.current.reset();
		}
	};

	const tryAcquireCaptchaOptions = async (
		forceRefresh = false
	): Promise<{ headers?: Record<string, string> } | null> => {
		if (!turnstileSiteKey) {
			return {};
		}
		const widget = turnstileRef.current;
		if (!widget) {
			if (isOpenRef.current) {
				toast.error(captchaTranslations.unavailable);
			}
			return null;
		}
		try {
			if (forceRefresh) {
				widget.reset();
			}
			const token = await widget.getToken();
			return { headers: { "x-captcha-response": token } };
		} catch (error) {
			if (isOpenRef.current) {
				toast.error(
					error instanceof Error
						? error.message
						: captchaTranslations.unavailable
				);
			}
			return null;
		}
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
				const captchaOptions = await tryAcquireCaptchaOptions();
				if (!captchaOptions) {
					setView("signIn");
					return;
				}

				const signInRes = await authClient.signIn.email(
					{ email, password },
					captchaOptions.headers ? captchaOptions : undefined
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
				const captchaOptions = await tryAcquireCaptchaOptions();
				if (!captchaOptions) {
					return null;
				}

				const { error } = await authClient.emailOtp.sendVerificationOtp(
					{ email, type: "email-verification" },
					captchaOptions.headers ? captchaOptions : undefined
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
		const captchaOptions = await tryAcquireCaptchaOptions();
		if (!captchaOptions) {
			return;
		}

		await authClient.signIn.email(
			{ email, password },
			{
				...captchaOptions,
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
						const resendOptions = await tryAcquireCaptchaOptions(true);
						if (!resendOptions) {
							return;
						}

						const { error: otpError } =
							await authClient.emailOtp.sendVerificationOtp(
								{ email, type: "email-verification" },
								resendOptions.headers ? resendOptions : undefined
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
		const captchaOptions = await tryAcquireCaptchaOptions();
		if (!captchaOptions) {
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
				...captchaOptions,
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
		const captchaOptions = await tryAcquireCaptchaOptions();
		if (!captchaOptions) {
			return;
		}

		const { error } = await authClient.forgetPassword.emailOtp(
			{ email },
			captchaOptions.headers ? captchaOptions : undefined
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
				const resendOptions = await tryAcquireCaptchaOptions();
				if (!resendOptions) {
					return;
				}

				const { error: resendError } = await authClient.forgetPassword.emailOtp(
					{ email },
					resendOptions.headers ? resendOptions : undefined
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

	const clearPendingFlows = () => {
		setOtpProps(null);
		setResetPasswordProps(null);
	};

	return {
		clearPendingFlows,
		handleSendResetCode,
		handleSignIn,
		handleSignUp,
		handleSocialLogin,
		otpProps,
		resetPasswordProps,
		verificationOrigin,
	};
}
