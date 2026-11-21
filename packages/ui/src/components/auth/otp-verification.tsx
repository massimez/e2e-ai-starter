"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import OTPInput from "@workspace/ui/components/inputs/otp";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type defaultTranslations from "./translations.json";

export interface OtpVerificationSubmitResult {
	error?: string;
}

export interface OtpVerificationProps {
	autoSubmit?: boolean;
	captchaSlot?: ReactNode;
	description?: string;
	isLoading?: boolean;
	isResending?: boolean;
	length?: number;
	maxResendAttempts?: number;
	onComplete?: (
		otp: string
	) =>
		| Promise<OtpVerificationSubmitResult | undefined>
		| OtpVerificationSubmitResult
		| undefined;
	onResend?: () => Promise<{
		code?: string | undefined;
		message?: string | undefined;
		status: number;
		statusText: string;
	} | null>;
	onResendLimitReached?: () => void;
	onSubmit: (
		otp: string
	) =>
		| Promise<OtpVerificationSubmitResult | undefined>
		| OtpVerificationSubmitResult
		| undefined;
	resendTimeoutDuration?: number;
	title?: string;
	translations: typeof defaultTranslations.en.otpVerification;
}

export const OtpVerification = ({
	captchaSlot,
	title,
	description,
	length = 6,
	onComplete,
	onSubmit,
	onResend,
	isLoading = false,
	isResending = false,
	resendTimeoutDuration = 60, // Default 60 seconds
	maxResendAttempts = 3, // Default max 3 attempts
	onResendLimitReached,
	translations,
	autoSubmit = true,
}: OtpVerificationProps) => {
	const errorId = useId();
	const otpContainerRef = useRef<HTMLDivElement>(null);
	const [otp, setOtp] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [timeLeft, setTimeLeft] = useState(0);
	const [resendAttempts, setResendAttempts] = useState(0);
	const [isTimeoutActive, setIsTimeoutActive] = useState(false);
	const [internalLoading, setInternalLoading] = useState(false);

	const activeLoading = isLoading || internalLoading;

	const focusFirstOtpInput = useCallback(() => {
		const firstInput = otpContainerRef.current?.querySelector("input");
		firstInput?.focus();
	}, []);

	// Timer effect
	useEffect(() => {
		if (timeLeft <= 0) {
			setIsTimeoutActive(false);
			return;
		}

		const timer = setTimeout(() => {
			setTimeLeft((prev) => prev - 1);
		}, 1000);

		return () => clearTimeout(timer);
	}, [timeLeft]);

	// Format time as MM:SS
	const formatTime = useCallback((seconds: number): string => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
	}, []);

	const submitOtpCode = useCallback(
		async (value: string, invokeComplete: boolean) => {
			setErrorMessage(null);
			setInternalLoading(true);
			try {
				const completeResult = invokeComplete
					? await onComplete?.(value)
					: undefined;
				if (
					completeResult &&
					"error" in completeResult &&
					completeResult.error
				) {
					setErrorMessage(completeResult.error);
					setOtp("");
					requestAnimationFrame(() => focusFirstOtpInput());
					return;
				}
				if (!invokeComplete || onComplete !== onSubmit) {
					const submitResult = await onSubmit(value);
					if (submitResult && "error" in submitResult && submitResult.error) {
						setErrorMessage(submitResult.error);
						setOtp("");
						requestAnimationFrame(() => focusFirstOtpInput());
					}
				}
			} catch (error) {
				setErrorMessage(
					error instanceof Error
						? error.message
						: "Verification failed. Please try again."
				);
				setOtp("");
				requestAnimationFrame(() => focusFirstOtpInput());
			} finally {
				setInternalLoading(false);
			}
		},
		[focusFirstOtpInput, onComplete, onSubmit]
	);

	const handleOtpChange = async (value: string) => {
		setOtp(value);
		if (value.length > 0 && errorMessage) {
			setErrorMessage(null);
		}
		if (value.length === length && !activeLoading) {
			if (autoSubmit) {
				await submitOtpCode(value, true);
			} else {
				onComplete?.(value);
			}
		}
	};

	const handleSubmit = async (e?: React.FormEvent) => {
		e?.preventDefault();
		if (otp.length === length && !activeLoading) {
			await submitOtpCode(otp, false);
		}
	};

	const handleResend = async () => {
		if (!onResend || isResending || isTimeoutActive) {
			return;
		}
		// Check if max attempts reached
		if (resendAttempts >= maxResendAttempts) {
			onResendLimitReached?.();
			return;
		}

		const result = await onResend();
		if (!result) {
			return;
		}

		// Start timeout and increment attempts only after confirmed resend
		setTimeLeft(resendTimeoutDuration);
		setIsTimeoutActive(true);
		setResendAttempts((prev) => prev + 1);

		// Clear current OTP and error
		setErrorMessage(null);
		setOtp("");
		requestAnimationFrame(() => focusFirstOtpInput());
	};

	// Determine if resend button should be disabled
	const isResendDisabled =
		isResending || isTimeoutActive || resendAttempts >= maxResendAttempts;

	// Generate resend button text
	const getResendButtonText = (): string => {
		if (isResending) {
			return translations.sending;
		}
		if (resendAttempts >= maxResendAttempts) {
			return translations.max_attempts;
		}
		if (isTimeoutActive) {
			return translations.resend_wait.replace("{time}", formatTime(timeLeft));
		}
		return translations.resend;
	};

	// Generate helper text for resend attempts
	const getResendHelperText = (): string | null => {
		if (maxResendAttempts && resendAttempts > 0) {
			const remaining = maxResendAttempts - resendAttempts;
			if (remaining > 0) {
				const template =
					remaining === 1
						? (translations.attempts_remaining_one ??
							translations.attempts_remaining)
						: (translations.attempts_remaining_other ??
							translations.attempts_remaining);
				return template.replace("{count}", remaining.toString());
			}
			return translations.no_attempts;
		}
		return null;
	};

	const resolvedTitle = title ?? translations.title;
	const resolvedDescription = description ?? "";

	return (
		<div className="flex flex-col gap-6">
			<DialogHeader className="space-y-2">
				<DialogTitle className="text-2xl font-semibold">
					{resolvedTitle}
				</DialogTitle>
				<DialogDescription
					className={
						resolvedDescription ? "text-muted-foreground text-sm" : "sr-only"
					}
				>
					{resolvedDescription || resolvedTitle}
				</DialogDescription>
			</DialogHeader>
			<form className="space-y-6" onSubmit={handleSubmit}>
				<div className="flex justify-center" ref={otpContainerRef}>
					<OTPInput
						aria-describedby={errorMessage ? errorId : undefined}
						aria-invalid={errorMessage ? true : undefined}
						className="gap-1"
						inputClassName="h-14 w-10 text-xl font-semibold md:w-12 md:text-3xl"
						numInputs={length}
						onChange={handleOtpChange}
						renderMiddleSeparator
						shouldAutoFocus
						value={otp}
					/>
				</div>

				{errorMessage ? (
					<p
						className="text-destructive text-center text-sm"
						id={errorId}
						role="alert"
					>
						{errorMessage}
					</p>
				) : null}

				{captchaSlot}

				<Button
					className="h-12 w-full text-base font-medium"
					disabled={otp.length !== length || activeLoading}
					type="submit"
				>
					{activeLoading ? translations.verifying : translations.submit}
				</Button>

				{onResend ? (
					<div className="space-y-2">
						<Button
							className="w-full"
							disabled={isResendDisabled}
							onClick={handleResend}
							type="button"
							variant="link"
						>
							{getResendButtonText()}
						</Button>

						{/* Helper text for resend attempts */}
						{getResendHelperText() ? (
							<p className="text-muted-foreground text-center text-xs">
								{getResendHelperText()}
							</p>
						) : null}

						{/* Additional timeout info */}
						{isTimeoutActive ? (
							<p className="text-muted-foreground text-center text-xs">
								{translations.wait_new_code}
							</p>
						) : null}
					</div>
				) : null}
			</form>
		</div>
	);
};
