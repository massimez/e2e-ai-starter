"use client";

import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import {
	AuthFormError,
	AuthSubmitButton,
	EMAIL_PATTERN,
	PasswordField,
	SocialAuthDivider,
} from "./auth-form-primitives";
import type defaultTranslations from "./translations.json";

export const SignIn = ({
	captchaSlot,
	onLoginClick,
	onSocialLoginClick,
	onSignUpClick,
	onForgetPasswordClick,
	translations,
}: {
	captchaSlot?: ReactNode;
	onLoginClick: (email: string, password: string) => Promise<void>;
	onSocialLoginClick?: (name: string) => Promise<void>;
	onSignUpClick: () => Promise<void>;
	onForgetPasswordClick: () => Promise<void>;
	translations: typeof defaultTranslations.en.signIn;
}) => {
	const emailId = useId();
	const passwordId = useId();
	const errorId = useId();
	const emailRef = useRef<HTMLInputElement>(null);
	const passwordRef = useRef<HTMLInputElement>(null);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<"email" | "password" | null>(
		null
	);

	const clearError = () => {
		if (formError) {
			setFormError(null);
			setErrorField(null);
		}
	};

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const trimmedEmail = email.trim();
		if (!EMAIL_PATTERN.test(trimmedEmail)) {
			setFormError("Please enter a valid email address.");
			setErrorField("email");
			emailRef.current?.focus();
			return;
		}
		if (!password) {
			setFormError("Please enter your password.");
			setErrorField("password");
			passwordRef.current?.focus();
			return;
		}

		setFormError(null);
		setErrorField(null);
		setLoading(true);
		try {
			await onLoginClick(trimmedEmail, password);
		} finally {
			setLoading(false);
		}
	};

	const handleSocial = async (provider: string) => {
		if (!onSocialLoginClick || loading) {
			return;
		}
		setFormError(null);
		setLoading(true);
		try {
			await onSocialLoginClick(provider);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<DialogHeader className="space-y-2">
				<DialogTitle className="text-center text-2xl font-semibold">
					{translations.title}
				</DialogTitle>
				<DialogDescription className="sr-only">
					{translations.email_or}
				</DialogDescription>
			</DialogHeader>

			<SocialAuthDivider
				dividerLabel={translations.email_or}
				googleLabel={translations.google_continue}
				loading={loading}
				onSocialClick={onSocialLoginClick ? handleSocial : undefined}
			/>

			{/* Email/Password Form */}
			<form className="space-y-4" noValidate onSubmit={handleSubmit}>
				<div className="space-y-2">
					<Label className="text-sm font-medium" htmlFor={emailId}>
						{translations.email_label}
					</Label>
					<Input
						aria-describedby={errorField === "email" ? errorId : undefined}
						aria-invalid={errorField === "email" ? true : undefined}
						autoComplete="email"
						className="h-12"
						id={emailId}
						onChange={(e) => {
							setEmail(e.target.value);
							clearError();
						}}
						placeholder={translations.email_label}
						ref={emailRef}
						required
						type="email"
						value={email}
					/>
				</div>

				<PasswordField
					aria-describedby={errorField === "password" ? errorId : undefined}
					aria-invalid={errorField === "password" ? true : undefined}
					autoComplete="current-password"
					id={passwordId}
					label={translations.password_label}
					labelAccessory={
						<button
							className="text-sm font-medium underline hover:no-underline"
							onClick={() => {
								void onForgetPasswordClick();
							}}
							type="button"
						>
							{translations.forgot_password}
						</button>
					}
					onChange={(e) => {
						setPassword(e.target.value);
						clearError();
					}}
					ref={passwordRef}
					required
					value={password}
				/>

				<AuthFormError error={formError} id={errorId} />

				{captchaSlot}

				<AuthSubmitButton label={translations.submit} loading={loading} />
			</form>

			<DialogFooter className="flex justify-center sm:justify-center">
				<div className="text-center text-sm">
					{translations.no_account}{" "}
					<button
						className="font-medium underline hover:no-underline"
						onClick={() => {
							void onSignUpClick();
						}}
						type="button"
					>
						{translations.register}
					</button>
				</div>
			</DialogFooter>
		</div>
	);
};
