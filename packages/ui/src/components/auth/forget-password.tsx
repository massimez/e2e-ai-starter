"use client";

import { Button } from "@workspace/ui/components/button";
import {
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Loader2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import type defaultTranslations from "./translations.json";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const ForgetPassword = ({
	sentResetCode,
	openSignIn,
	translations,
}: {
	sentResetCode: (email: string) => Promise<void>;
	openSignIn: () => void;
	translations: typeof defaultTranslations.en.forgetPassword;
}) => {
	const emailId = useId();
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);

	const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const trimmedEmail = email.trim();
		if (!EMAIL_PATTERN.test(trimmedEmail)) {
			setFormError("Please enter a valid email address.");
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
