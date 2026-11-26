"use client";

import { useId, useState } from "react";
import { Button } from "../button";
import { Checkbox } from "../checkbox";
import { DialogDescription, DialogHeader, DialogTitle } from "../dialog";
import { Input } from "../input";
import { Label } from "../label";
import {
	OtpVerification,
	type OtpVerificationSubmitResult,
} from "./otp-verification";
import type defaultTranslations from "./translations.json";

export interface TwoFactorChallengeProps {
	onVerifyBackupCode?: (
		code: string,
		trustDevice: boolean
	) => Promise<OtpVerificationSubmitResult | undefined>;
	onVerifyTotp: (
		code: string,
		trustDevice: boolean
	) => Promise<OtpVerificationSubmitResult | undefined>;
	otpTranslations: typeof defaultTranslations.en.otpVerification;
	translations: typeof defaultTranslations.en.twoFactor;
}

export function TwoFactorChallenge({
	onVerifyBackupCode,
	onVerifyTotp,
	otpTranslations,
	translations,
}: TwoFactorChallengeProps) {
	const [mode, setMode] = useState<"totp" | "backup">("totp");
	const [trustDevice, setTrustDevice] = useState(false);
	const [backupCode, setBackupCode] = useState("");
	const [backupError, setBackupError] = useState<string | null>(null);
	const [isVerifyingBackup, setIsVerifyingBackup] = useState(false);
	const trustId = useId();
	const backupInputId = useId();
	const backupErrorId = useId();

	const handleBackupSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!(onVerifyBackupCode && backupCode.trim())) {
			return;
		}
		setBackupError(null);
		setIsVerifyingBackup(true);
		try {
			const result = await onVerifyBackupCode(backupCode.trim(), trustDevice);
			if (result?.error) {
				setBackupError(result.error);
			}
		} catch (error) {
			setBackupError(
				error instanceof Error
					? error.message
					: "Backup code verification failed"
			);
		} finally {
			setIsVerifyingBackup(false);
		}
	};

	if (mode === "backup" && onVerifyBackupCode) {
		return (
			<div className="flex flex-col gap-6">
				<DialogHeader className="space-y-2">
					<DialogTitle className="text-2xl font-semibold">
						{translations.backup_title}
					</DialogTitle>
					<DialogDescription className="text-muted-foreground text-sm">
						{translations.backup_description}
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-4" onSubmit={handleBackupSubmit}>
					<div className="space-y-2">
						<Label htmlFor={backupInputId}>{translations.backup_label}</Label>
						<Input
							aria-describedby={backupError ? backupErrorId : undefined}
							aria-invalid={backupError ? true : undefined}
							autoComplete="one-time-code"
							autoFocus
							id={backupInputId}
							onChange={(event) => {
								setBackupCode(event.target.value);
								if (backupError) {
									setBackupError(null);
								}
							}}
							placeholder={translations.backup_placeholder}
							value={backupCode}
						/>
					</div>

					{backupError ? (
						<p
							className="text-destructive text-sm"
							id={backupErrorId}
							role="alert"
						>
							{backupError}
						</p>
					) : null}

					<div className="flex items-center gap-2">
						<Checkbox
							checked={trustDevice}
							id={trustId}
							onCheckedChange={(checked) => setTrustDevice(checked === true)}
						/>
						<Label className="text-sm font-normal" htmlFor={trustId}>
							{translations.trust_device}
						</Label>
					</div>

					<Button
						className="h-11 w-full text-base font-medium"
						disabled={!backupCode.trim() || isVerifyingBackup}
						type="submit"
					>
						{isVerifyingBackup
							? otpTranslations.verifying
							: translations.verify_backup}
					</Button>

					<Button
						className="w-full"
						onClick={() => {
							setBackupError(null);
							setMode("totp");
						}}
						type="button"
						variant="link"
					>
						{translations.use_totp}
					</Button>
				</form>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<OtpVerification
				description={translations.description}
				length={6}
				onSubmit={(code) => onVerifyTotp(code, trustDevice)}
				title={translations.title}
				translations={otpTranslations}
			/>

			<div className="flex items-center justify-center gap-2">
				<Checkbox
					checked={trustDevice}
					id={trustId}
					onCheckedChange={(checked) => setTrustDevice(checked === true)}
				/>
				<Label className="text-sm font-normal" htmlFor={trustId}>
					{translations.trust_device}
				</Label>
			</div>

			{onVerifyBackupCode ? (
				<Button
					className="w-full"
					onClick={() => setMode("backup")}
					type="button"
					variant="link"
				>
					{translations.use_backup}
				</Button>
			) : null}
		</div>
	);
}
