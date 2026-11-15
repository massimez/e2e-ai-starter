"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import OtpInput from "@workspace/ui/components/inputs/otp";
import { Label } from "@workspace/ui/components/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import type defaultTranslations from "./translations.json";

export interface ResetPasswordOtpProps {
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
	const [showPassword, setShowPassword] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<"otp" | "password" | null>(null);

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
							numInputs={6}
							onChange={(nextOtp) => {
								setOtp(nextOtp);
								if (formError) {
									setFormError(null);
									setErrorField(null);
								}
							}}
							renderInput={(props) => (
								<Input
									{...props}
									aria-describedby={errorField === "otp" ? errorId : undefined}
									aria-invalid={errorField === "otp" ? true : undefined}
									className="h-12 text-center"
								/>
							)}
							value={otp}
						/>
					</div>
				</div>

				<div className="space-y-2">
					<Label className="text-sm font-medium" htmlFor={newPasswordId}>
						{translations.new_password_label}
					</Label>
					<div className="relative">
						<Input
							aria-describedby={errorField === "password" ? errorId : undefined}
							aria-invalid={errorField === "password" ? true : undefined}
							autoComplete="new-password"
							className="h-12 pe-12"
							id={newPasswordId}
							minLength={8}
							onChange={(e) => {
								setNewPassword(e.target.value);
								if (formError) {
									setFormError(null);
									setErrorField(null);
								}
							}}
							placeholder={translations.new_password_label}
							ref={newPasswordRef}
							required
							type={showPassword ? "text" : "password"}
							value={newPassword}
						/>
						<button
							aria-label={showPassword ? "Hide password" : "Show password"}
							aria-pressed={showPassword}
							className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-e-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
							onClick={() => setShowPassword(!showPassword)}
							type="button"
						>
							{showPassword ? (
								<EyeOff aria-hidden="true" className="h-5 w-5" />
							) : (
								<Eye aria-hidden="true" className="h-5 w-5" />
							)}
						</button>
					</div>
				</div>

				{formError ? (
					<p className="text-destructive text-sm" id={errorId} role="alert">
						{formError}
					</p>
				) : null}

				<Button
					className="h-12 w-full text-base font-medium"
					disabled={loading || otp.length !== 6 || newPassword.length === 0}
					type="submit"
				>
					{loading ? (
						<Loader2 className="animate-spin" size={20} />
					) : (
						translations.submit
					)}
				</Button>
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
