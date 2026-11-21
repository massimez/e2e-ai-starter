"use client";

import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import OtpInput from "@workspace/ui/components/inputs/otp";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import {
	AuthFormError,
	AuthSubmitButton,
	PasswordField,
} from "./auth-form-primitives";
import type defaultTranslations from "./translations.json";

export interface ResetPasswordOtpProps {
	captchaSlot?: ReactNode;
	email: string;
	handleResetPassword: (
		email: string,
		otp: string,
		newPassword: string
	) => Promise<void>;
	onResendOtp: () => Promise<void> | void;
	translations: typeof defaultTranslations.en.resetPasswordOtp;
}

export const ResetPasswordOtp = ({
	captchaSlot,
	email,
	handleResetPassword,
	onResendOtp,
	translations,
}: ResetPasswordOtpProps) => {
	const newPasswordId = useId();
	const errorId = useId();
	const otpContainerRef = useRef<HTMLDivElement>(null);
	const newPasswordRef = useRef<HTMLInputElement>(null);
	const [otp, setOtp] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [resendLoading, setResendLoading] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<"otp" | "password" | null>(null);

	const clearError = () => {
		if (formError) {
			setFormError(null);
			setErrorField(null);
		}
	};

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (otp.length !== 6) {
			setFormError("Please enter the 6-digit verification code.");
			setErrorField("otp");
			otpContainerRef.current?.querySelector("input")?.focus();
			return;
		}
		if (newPassword.length < 8) {
			setFormError("Password must be at least 8 characters.");
			setErrorField("password");
			newPasswordRef.current?.focus();
			return;
		}

		setFormError(null);
		setErrorField(null);
		setLoading(true);
		try {
			await handleResetPassword(email, otp, newPassword);
		} finally {
			setLoading(false);
		}
	};

	const handleResend = async () => {
		setResendLoading(true);
		try {
			await onResendOtp();
		} finally {
			setResendLoading(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<DialogHeader className="space-y-2 text-center">
				<DialogTitle className="text-2xl font-semibold">
					{translations.title}
				</DialogTitle>
				<DialogDescription className="text-muted-foreground text-sm">
					{translations.description.replace("{email}", email)}
				</DialogDescription>
			</DialogHeader>

			<form className="space-y-4" noValidate onSubmit={handleSubmit}>
				<div className="space-y-2">
					<span className="block text-sm leading-none font-medium">
						{translations.otp_label}
					</span>
					<div ref={otpContainerRef}>
						<OtpInput
							aria-describedby={errorField === "otp" ? errorId : undefined}
							aria-invalid={errorField === "otp" ? true : undefined}
							inputClassName="h-12"
							numInputs={6}
							onChange={(nextOtp) => {
								setOtp(nextOtp);
								clearError();
							}}
							value={otp}
						/>
					</div>
				</div>

				<PasswordField
					aria-describedby={errorField === "password" ? errorId : undefined}
					aria-invalid={errorField === "password" ? true : undefined}
					autoComplete="new-password"
					id={newPasswordId}
					label={translations.new_password_label}
					minLength={8}
					onChange={(e) => {
						setNewPassword(e.target.value);
						clearError();
					}}
					ref={newPasswordRef}
					required
					value={newPassword}
				/>

				<AuthFormError error={formError} id={errorId} />

				{captchaSlot}

				<AuthSubmitButton
					disabled={otp.length !== 6 || newPassword.length === 0}
					label={translations.submit}
					loading={loading}
				/>
			</form>

			<DialogFooter className="flex justify-center sm:justify-center">
				<div className="text-center text-sm">
					<button
						className="font-medium underline hover:no-underline disabled:opacity-50"
						disabled={loading || resendLoading}
						onClick={handleResend}
						type="button"
					>
						{translations.resend}
					</button>
				</div>
			</DialogFooter>
		</div>
	);
};
