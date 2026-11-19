"use client";

import { Button } from "@workspace/ui/components/button";
import { GoogleIcon } from "@workspace/ui/components/icons/brands/google-icon";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { type ComponentProps, useState } from "react";

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function AuthFormError({
	error,
	id,
}: {
	error: string | null;
	id: string;
}) {
	if (!error) {
		return null;
	}
	return (
		<p className="text-destructive text-sm" id={id} role="alert">
			{error}
		</p>
	);
}

export function AuthSubmitButton({
	disabled,
	label,
	loading,
}: {
	disabled?: boolean;
	label: string;
	loading: boolean;
}) {
	return (
		<Button
			className="h-12 w-full text-base font-medium"
			disabled={loading || disabled}
			type="submit"
		>
			{loading ? (
				<Loader2 className="animate-spin" size={20} />
			) : (
				<span>{label}</span>
			)}
		</Button>
	);
}

export function SocialAuthDivider({
	dividerLabel,
	googleLabel,
	loading,
	onSocialClick,
}: {
	dividerLabel: string;
	googleLabel: string;
	loading: boolean;
	onSocialClick?: (provider: string) => void;
}) {
	if (!onSocialClick) {
		return null;
	}
	return (
		<>
			<div className="flex gap-3">
				<Button
					className="h-12 flex-1 gap-2"
					disabled={loading}
					onClick={() => onSocialClick("google")}
					type="button"
					variant="outline"
				>
					<GoogleIcon />
					{googleLabel}
				</Button>
			</div>

			<div className="relative">
				<div className="absolute inset-0 flex items-center">
					<span className="w-full border-t" />
				</div>
				<div className="relative flex justify-center text-xs uppercase">
					<span className="bg-background text-muted-foreground px-2">
						{dividerLabel}
					</span>
				</div>
			</div>
		</>
	);
}

interface PasswordFieldProps
	extends Omit<ComponentProps<typeof Input>, "id" | "type"> {
	id: string;
	label: string;
	labelAccessory?: React.ReactNode;
}

export function PasswordField({
	id,
	label,
	labelAccessory,
	placeholder,
	...inputProps
}: PasswordFieldProps) {
	const [showPassword, setShowPassword] = useState(false);

	return (
		<div className="space-y-2">
			{labelAccessory ? (
				<div className="flex items-center justify-between">
					<Label className="text-sm font-medium" htmlFor={id}>
						{label}
					</Label>
					{labelAccessory}
				</div>
			) : (
				<Label className="text-sm font-medium" htmlFor={id}>
					{label}
				</Label>
			)}

			<div className="relative">
				<Input
					{...inputProps}
					className="h-12 pe-12"
					id={id}
					placeholder={placeholder ?? label}
					type={showPassword ? "text" : "password"}
				/>
				<button
					aria-label={showPassword ? "Hide password" : "Show password"}
					aria-pressed={showPassword}
					className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-e-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
					onClick={() => setShowPassword((prev) => !prev)}
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
	);
}
