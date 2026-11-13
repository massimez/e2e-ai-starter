"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { GoogleIcon } from "@workspace/ui/components/icons/brands/google-icon";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import type defaultTranslations from "./translations.json";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const SignIn = ({
	onLoginClick,
	onSocialLoginClick,
	onSignUpClick,
	onForgetPasswordClick,
	translations,
}: {
	onLoginClick: (email: string, password: string) => Promise<void>;
	onSocialLoginClick?: (name: string) => Promise<void>;
	onSignUpClick: () => Promise<void>;
	onForgetPasswordClick: () => Promise<void>;
	translations: typeof defaultTranslations.en.signIn;
}) => {
	const emailId = useId();
	const passwordId = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const trimmedEmail = email.trim();
		if (!EMAIL_PATTERN.test(trimmedEmail)) {
			setFormError("Please enter a valid email address.");
			return;
		}
		if (!password) {
			setFormError("Please enter your password.");
			return;
		}

		setFormError(null);
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

			{onSocialLoginClick ? (
				<>
					{/* OAuth Providers */}
					<div className="flex gap-3">
						<Button
							className="h-12 flex-1 gap-2"
							disabled={loading}
							onClick={() => handleSocial("google")}
							type="button"
							variant="outline"
						>
							<GoogleIcon />
							{translations.google_continue}
						</Button>
					</div>

					{/* Divider */}
					<div className="relative">
						<div className="absolute inset-0 flex items-center">
							<span className="w-full border-t" />
						</div>
						<div className="relative flex justify-center text-xs uppercase">
							<span className="bg-background text-muted-foreground px-2">
								{translations.email_or}
							</span>
						</div>
					</div>
				</>
			) : null}

			{/* Email/Password Form */}
			<form className="space-y-4" noValidate onSubmit={handleSubmit}>
				<div className="space-y-2">
					<Label className="text-sm font-medium" htmlFor={emailId}>
						{translations.email_label}
					</Label>
					<Input
						autoComplete="email"
						className="h-12"
						id={emailId}
						onChange={(e) => {
							setEmail(e.target.value);
							if (formError) {
								setFormError(null);
							}
						}}
						placeholder={translations.email_label}
						required
						type="email"
						value={email}
					/>
				</div>

				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label className="text-sm font-medium" htmlFor={passwordId}>
							{translations.password_label}
						</Label>
						<button
							className="text-sm font-medium underline hover:no-underline"
							onClick={() => {
								void onForgetPasswordClick();
							}}
							type="button"
						>
							{translations.forgot_password}
						</button>
					</div>

					<div className="relative">
						<Input
							autoComplete="current-password"
							className="h-12 pe-10"
							id={passwordId}
							onChange={(e) => {
								setPassword(e.target.value);
								if (formError) {
									setFormError(null);
								}
							}}
							placeholder={translations.password_label}
							required
							type={showPassword ? "text" : "password"}
							value={password}
						/>
						<button
							aria-label={showPassword ? "Hide password" : "Show password"}
							aria-pressed={showPassword}
							className="text-muted-foreground hover:text-foreground absolute inset-e-3 top-1/2 -translate-y-1/2"
							onClick={() => setShowPassword(!showPassword)}
							type="button"
						>
							{showPassword ? (
								<EyeOff className="h-5 w-5" />
							) : (
								<Eye className="h-5 w-5" />
							)}
						</button>
					</div>
				</div>

				{formError ? (
					<p className="text-destructive text-sm" role="alert">
						{formError}
					</p>
				) : null}

				<Button
					className="h-12 w-full text-base font-medium"
					disabled={loading}
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
