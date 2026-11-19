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
} from "./auth-form-primitives";
import type defaultTranslations from "./translations.json";

export const ForgetPassword = ({
	captchaSlot,
	sentResetCode,
	openSignIn,
	translations,
}: {
	captchaSlot?: ReactNode;
	sentResetCode: (email: string) => Promise<void>;
	openSignIn: () => void;
	translations: typeof defaultTranslations.en.forgetPassword;
}) => {
	const emailId = useId();
	const errorId = useId();
	const emailRef = useRef<HTMLInputElement>(null);
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const trimmedEmail = email.trim();
		if (!EMAIL_PATTERN.test(trimmedEmail)) {
			setFormError("Please enter a valid email address.");
			emailRef.current?.focus();
			return;
		}

		setFormError(null);
		setLoading(true);
		try {
			await sentResetCode(trimmedEmail);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			<DialogHeader className="space-y-2 text-center">
				<DialogTitle className="text-2xl font-semibold">
					{translations.title}
				</DialogTitle>
				<DialogDescription className="sr-only">
					{translations.submit}
				</DialogDescription>
			</DialogHeader>

			<form className="space-y-4" noValidate onSubmit={handleSubmit}>
				<div className="space-y-2">
					<Label className="text-sm font-medium" htmlFor={emailId}>
						{translations.email_label}
					</Label>
					<Input
						aria-describedby={formError ? errorId : undefined}
						aria-invalid={formError ? true : undefined}
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
						ref={emailRef}
						required
						type="email"
						value={email}
					/>
				</div>

				<AuthFormError error={formError} id={errorId} />

				{captchaSlot}

				<AuthSubmitButton label={translations.submit} loading={loading} />
			</form>

			<DialogFooter className="flex justify-center sm:justify-center">
				<div className="text-center text-sm">
					{translations.remember_password}{" "}
					<button
						className="font-medium underline hover:no-underline"
						onClick={() => openSignIn()}
						type="button"
					>
						{translations.sign_in}
					</button>
				</div>
			</DialogFooter>
		</div>
	);
};
