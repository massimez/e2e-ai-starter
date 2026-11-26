"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "../dialog";
import {
	type AuthModalProviderProps,
	getLocaleTranslations,
	VIEW_CAPTCHA_ACTION,
	type ViewType,
} from "./auth-modal-types";
import { ForgetPassword } from "./forget-password";
import { OtpVerification } from "./otp-verification";
import { ResetPasswordOtp } from "./reset-password-otp";
import { SignIn } from "./sign-in";
import { SignUp } from "./sign-up";
import defaultTranslations from "./translations.json";
import { type TurnstileHandle, TurnstileWidget } from "./turnstile-widget";
import { TwoFactorChallenge } from "./two-factor-challenge";
import { useAuthModalActions } from "./use-auth-modal-actions";

export type {
	AuthModalClient,
	AuthModalProviderProps,
} from "./auth-modal-types";

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
	const turnstileRef = useRef<TurnstileHandle>(null);
	const isOpenRef = useRef(open);
	isOpenRef.current = open;

	// Sync internal view with defaultView when modal opens
	useEffect(() => {
		if (open) {
			setView(defaultView);
		}
	}, [open, defaultView]);

	const {
		clearPendingFlows,
		handleSendResetCode,
		handleSignIn,
		handleSignUp,
		handleSocialLogin,
		otpProps,
		resetPasswordProps,
		twoFactorProps,
		verificationOrigin,
	} = useAuthModalActions({
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
	});

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			clearPendingFlows();
		}
		onOpenChange(nextOpen);
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
		} else if (view === "twoFactorOtp") {
			setView("signIn");
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
				break;
			case "twoFactorOtp":
				if (twoFactorProps) {
					return <TwoFactorChallenge {...twoFactorProps} />;
				}
				break;
			default:
				break;
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
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none p-0 sm:h-auto sm:w-full sm:max-w-125 sm:rounded-lg sm:p-8">
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
