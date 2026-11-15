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
import { type FormEvent, useId, useRef, useState } from "react";
import type defaultTranslations from "./translations.json";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const SignUp = ({
	onClickCreateAccount,
	onClickSignIn,
	onSocialLoginClick,
	translations,
}: {
	onClickCreateAccount: (signUpData: {
		firstName: string;
		lastName: string;
		email: string;
		password: string;
		name: string;
	}) => Promise<void>;
	onClickSignIn: () => void;
	onSocialLoginClick?: (name: string) => Promise<void>;
	translations: typeof defaultTranslations.en.signUp;
}) => {
	const firstNameId = useId();
	const lastNameId = useId();
	const emailId = useId();
	const passwordId = useId();
	const errorId = useId();
	const firstNameRef = useRef<HTMLInputElement>(null);
	const lastNameRef = useRef<HTMLInputElement>(null);
	const emailRef = useRef<HTMLInputElement>(null);
	const passwordRef = useRef<HTMLInputElement>(null);

	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [showPassword, setShowPassword] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<
		"firstName" | "lastName" | "email" | "password" | null
	>(null);

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const trimmedFirst = firstName.trim();
		const trimmedLast = lastName.trim();
		const trimmedEmail = email.trim();

		if (!trimmedFirst) {
			setFormError("First and last name are required.");
			setErrorField("firstName");
			firstNameRef.current?.focus();
			return;
		}
		if (!trimmedLast) {
			setFormError("First and last name are required.");
			setErrorField("lastName");
			lastNameRef.current?.focus();
			return;
		}
		if (!EMAIL_PATTERN.test(trimmedEmail)) {
			setFormError("Please enter a valid email address.");
			setErrorField("email");
			emailRef.current?.focus();
			return;
		}
		if (password.length < 8) {
			setFormError("Password must be at least 8 characters.");
			setErrorField("password");
			passwordRef.current?.focus();
			return;
		}

		setFormError(null);
		setErrorField(null);
		setLoading(true);
		try {
			await onClickCreateAccount({
				email: trimmedEmail,
				password,
				firstName: trimmedFirst,
				lastName: trimmedLast,
				name: `${trimmedFirst} ${trimmedLast}`,
			});
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
			<DialogHeader className="space-y-2 text-center">
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

			{/* Sign Up Form */}
			<form className="space-y-4" noValidate onSubmit={handleSubmit}>
				<div className="grid grid-cols-2 gap-4">
					<div className="space-y-2">
						<Label className="text-sm font-medium" htmlFor={firstNameId}>
							{translations.first_name_label}
						</Label>
						<Input
							aria-describedby={
								errorField === "firstName" ? errorId : undefined
							}
							aria-invalid={errorField === "firstName" ? true : undefined}
							autoComplete="given-name"
							className="h-12"
							id={firstNameId}
							onChange={(e) => {
								setFirstName(e.target.value);
								if (formError) {
									setFormError(null);
									setErrorField(null);
								}
							}}
							placeholder={translations.first_name_label}
							ref={firstNameRef}
							required
							value={firstName}
						/>
					</div>
					<div className="space-y-2">
						<Label className="text-sm font-medium" htmlFor={lastNameId}>
							{translations.last_name_label}
						</Label>
						<Input
							aria-describedby={errorField === "lastName" ? errorId : undefined}
							aria-invalid={errorField === "lastName" ? true : undefined}
							autoComplete="family-name"
							className="h-12"
							id={lastNameId}
							onChange={(e) => {
								setLastName(e.target.value);
								if (formError) {
									setFormError(null);
									setErrorField(null);
								}
							}}
							placeholder={translations.last_name_label}
							ref={lastNameRef}
							required
							value={lastName}
						/>
					</div>
				</div>

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
							if (formError) {
								setFormError(null);
								setErrorField(null);
							}
						}}
						placeholder={translations.email_label}
						ref={emailRef}
						required
						type="email"
						value={email}
					/>
				</div>

				<div className="space-y-2">
					<Label className="text-sm font-medium" htmlFor={passwordId}>
						{translations.password_label}
					</Label>
					<div className="relative">
						<Input
							aria-describedby={errorField === "password" ? errorId : undefined}
							aria-invalid={errorField === "password" ? true : undefined}
							autoComplete="new-password"
							className="h-12 pe-12"
							id={passwordId}
							minLength={8}
							onChange={(e) => {
								setPassword(e.target.value);
								if (formError) {
									setFormError(null);
									setErrorField(null);
								}
							}}
							placeholder={translations.password_label}
							ref={passwordRef}
							required
							type={showPassword ? "text" : "password"}
							value={password}
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

				<div>
					<p className="text-muted-foreground mt-6 mb-3 text-center text-xs">
						{translations.terms}
					</p>
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
				</div>
			</form>

			<DialogFooter className="flex justify-center sm:justify-center">
				<div className="text-center text-sm">
					{translations.has_account}{" "}
					<button
						className="font-medium underline hover:no-underline"
						onClick={() => onClickSignIn()}
						type="button"
					>
						{translations.sign_in}
					</button>
				</div>
			</DialogFooter>
		</div>
	);
};
