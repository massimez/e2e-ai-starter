"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsSection,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { Check, Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";

const NON_DIGIT_REGEX = /\D+/gu;
const WHITESPACE_REGEX = /\s+/gu;

interface EnrollmentState {
	backupCodes: string[];
	secret: string;
	totpURI: string;
}

function isSafeOtpAuthUri(uri: string): boolean {
	try {
		return new URL(uri).protocol === "otpauth:";
	} catch {
		return false;
	}
}

function extractTotpSecret(totpURI: string): string {
	if (!isSafeOtpAuthUri(totpURI)) {
		return "";
	}
	try {
		const parsed = new URL(totpURI);
		return parsed.searchParams.get("secret") ?? "";
	} catch {
		return "";
	}
}

function TwoFactorVerifyPanel({
	copiedKey,
	enrollment,
	isSubmitting,
	onCancel,
	onCodeChange,
	onCopy,
	onSubmit,
	totpCode,
}: {
	copiedKey: string | null;
	enrollment: EnrollmentState;
	isSubmitting: boolean;
	onCancel: () => void;
	onCodeChange: (value: string) => void;
	onCopy: (value: string, label: string, key: string) => void;
	onSubmit: (event: React.FormEvent) => void;
	totpCode: string;
}) {
	const codeId = useId();
	return (
		<div className="space-y-5 p-5">
			<div className="bg-muted/40 border-border space-y-3 rounded-lg border p-4">
				<div className="flex items-center gap-2 text-sm font-medium">
					<KeyRound className="text-primary size-4" />
					Step 1: Add to your authenticator app
				</div>
				<p className="text-muted-foreground text-xs leading-relaxed">
					Open Google Authenticator, 1Password, Authy, or another TOTP app and
					add a new account using the manual setup key or launcher link below.
				</p>
				{enrollment.secret ? (
					<div className="flex flex-wrap items-center gap-2">
						<code className="bg-background border-border rounded border px-2.5 py-1.5 font-mono text-xs tracking-wider select-all">
							{enrollment.secret}
						</code>
						<Button
							onClick={() => onCopy(enrollment.secret, "Setup key", "secret")}
							size="sm"
							type="button"
							variant="outline"
						>
							{copiedKey === "secret" ? (
								<Check className="mr-1.5 size-3.5" />
							) : (
								<Copy className="mr-1.5 size-3.5" />
							)}
							Copy key
						</Button>
					</div>
				) : null}
				{isSafeOtpAuthUri(enrollment.totpURI) ? (
					<div className="flex flex-wrap items-center gap-2">
						<a
							className="text-primary text-xs font-medium underline underline-offset-4"
							href={enrollment.totpURI}
						>
							Open in authenticator app (otpauth://)
						</a>
						<Button
							onClick={() =>
								onCopy(enrollment.totpURI, "Authenticator URI", "uri")
							}
							size="sm"
							type="button"
							variant="ghost"
						>
							{copiedKey === "uri" ? (
								<Check className="mr-1.5 size-3.5" />
							) : (
								<Copy className="mr-1.5 size-3.5" />
							)}
							Copy URI
						</Button>
					</div>
				) : null}
			</div>

			<form className="space-y-3" onSubmit={onSubmit}>
				<div className="max-w-xs space-y-2">
					<Label htmlFor={codeId}>
						Step 2: Enter 6-digit verification code
					</Label>
					<Input
						autoComplete="one-time-code"
						id={codeId}
						inputMode="numeric"
						maxLength={6}
						onChange={(event) =>
							onCodeChange(event.target.value.replaceAll(NON_DIGIT_REGEX, ""))
						}
						placeholder="123456"
						required
						value={totpCode}
					/>
				</div>
				<div className="flex items-center gap-2">
					<Button
						disabled={isSubmitting || totpCode.length !== 6}
						size="sm"
						type="submit"
					>
						{isSubmitting ? "Verifying..." : "Verify & Enable"}
					</Button>
					<Button
						disabled={isSubmitting}
						onClick={onCancel}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
				</div>
			</form>
		</div>
	);
}

function TwoFactorBackupCodesPanel({
	backupCodes,
	copiedKey,
	onCopy,
	onDone,
}: {
	backupCodes: string[];
	copiedKey: string | null;
	onCopy: (value: string, label: string, key: string) => void;
	onDone: () => void;
}) {
	return (
		<div className="space-y-4 p-5">
			<div className="space-y-1">
				<p className="text-sm font-medium">Save your recovery backup codes</p>
				<p className="text-muted-foreground text-xs">
					Each backup code can be used once if you lose access to your
					authenticator app. Store them in a password manager now—they will not
					be shown again.
				</p>
			</div>
			<div className="bg-muted/40 border-border grid grid-cols-2 gap-2 rounded-lg border p-3 font-mono text-xs sm:grid-cols-3">
				{backupCodes.map((code) => (
					<span
						className="bg-background rounded px-2 py-1 text-center select-all"
						key={code}
					>
						{code}
					</span>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={() =>
						onCopy(backupCodes.join("\n"), "Backup codes", "backup-codes")
					}
					size="sm"
					type="button"
					variant="outline"
				>
					{copiedKey === "backup-codes" ? (
						<Check className="mr-1.5 size-3.5" />
					) : (
						<Copy className="mr-1.5 size-3.5" />
					)}
					Copy all codes
				</Button>
				<Button onClick={onDone} size="sm" type="button">
					I saved my codes
				</Button>
			</div>
		</div>
	);
}

export function TwoFactorSection() {
	const { data: session, refetch: refreshSession } = useSession();
	const isEnabled = Boolean(
		(session?.user as { twoFactorEnabled?: boolean | null } | undefined)
			?.twoFactorEnabled
	);

	const [panel, setPanel] = useState<
		"idle" | "enable" | "verify" | "disable" | "backupCodes"
	>("idle");
	const [password, setPassword] = useState("");
	const [totpCode, setTotpCode] = useState("");
	const [enrollment, setEnrollment] = useState<EnrollmentState | null>(null);
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const passwordId = useId();

	useEffect(
		() => () => {
			if (copyTimerRef.current) {
				clearTimeout(copyTimerRef.current);
			}
		},
		[]
	);

	const copyText = async (value: string, label: string, key: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopiedKey(key);
			toast.success(`${label} copied to clipboard`);
			if (copyTimerRef.current) {
				clearTimeout(copyTimerRef.current);
			}
			copyTimerRef.current = setTimeout(() => {
				setCopiedKey((current) => (current === key ? null : current));
			}, 2000);
		} catch {
			toast.error("Unable to copy to clipboard");
		}
	};

	const resetFlow = () => {
		setPanel("idle");
		setPassword("");
		setTotpCode("");
		setEnrollment(null);
	};

	const handleStartEnrollment = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!password) {
			return;
		}
		setIsSubmitting(true);
		try {
			const result = await authClient.twoFactor.enable({ password });
			if (result.error) {
				toast.error(
					result.error.message || "Could not start two-factor setup."
				);
				return;
			}
			const { data } = result;
			const totpURI =
				data && "totpURI" in data && typeof data.totpURI === "string"
					? data.totpURI
					: "";
			const codes =
				data && "backupCodes" in data && Array.isArray(data.backupCodes)
					? data.backupCodes
					: [];
			setEnrollment({
				backupCodes: codes,
				secret: extractTotpSecret(totpURI),
				totpURI,
			});
			setBackupCodes(codes);
			setPassword("");
			setPanel("verify");
			toast.info(
				"Add the setup key to your authenticator app, then enter the 6-digit code."
			);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not start two-factor setup."
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleVerifyEnrollment = async (event: React.FormEvent) => {
		event.preventDefault();
		const cleanedCode = totpCode.replaceAll(WHITESPACE_REGEX, "");
		if (cleanedCode.length !== 6) {
			toast.error("Enter the 6-digit code from your authenticator app.");
			return;
		}
		setIsSubmitting(true);
		try {
			const result = await authClient.twoFactor.verifyTotp({
				code: cleanedCode,
			});
			if (result.error) {
				toast.error(result.error.message || "Invalid verification code.");
				return;
			}
			await refreshSession();
			setTotpCode("");
			setPanel("backupCodes");
			toast.success("Two-factor authentication enabled.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Verification failed."
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDisable = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!password) {
			return;
		}
		setIsSubmitting(true);
		try {
			const result = await authClient.twoFactor.disable({ password });
			if (result.error) {
				toast.error(
					result.error.message || "Could not disable two-factor authentication."
				);
				return;
			}
			await refreshSession();
			setBackupCodes([]);
			resetFlow();
			toast.success("Two-factor authentication disabled.");
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not disable two-factor authentication."
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleRegenerateBackupCodes = async () => {
		if (!password) {
			return;
		}
		setIsSubmitting(true);
		try {
			const result = await authClient.twoFactor.generateBackupCodes({
				password,
			});
			if (result.error) {
				toast.error(
					result.error.message || "Could not generate new backup codes."
				);
				return;
			}
			setBackupCodes(result.data?.backupCodes ?? []);
			setPassword("");
			setPanel("backupCodes");
			toast.success("New backup codes generated. Save them securely.");
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not generate new backup codes."
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<SettingsSection>
			<SettingsSectionHeader
				action={
					<div className="flex items-center gap-2">
						<Badge variant={isEnabled ? "success" : "secondary"}>
							{isEnabled ? "Enabled" : "Disabled"}
						</Badge>
						{panel === "idle" && !isEnabled ? (
							<Button
								onClick={() => setPanel("enable")}
								size="sm"
								variant="outline"
							>
								<ShieldCheck className="mr-1.5 size-4" />
								Enable 2FA
							</Button>
						) : null}
						{panel === "idle" && isEnabled ? (
							<Button
								onClick={() => setPanel("disable")}
								size="sm"
								variant="outline"
							>
								<ShieldOff className="mr-1.5 size-4" />
								Manage / Disable
							</Button>
						) : null}
					</div>
				}
				description="Protect your account with an authenticator app (TOTP) and single-use backup codes."
				title="Two-Factor Authentication"
			/>

			{panel === "enable" ? (
				<form className="space-y-4 p-5" onSubmit={handleStartEnrollment}>
					<p className="text-muted-foreground text-sm">
						Confirm your current password to generate a TOTP setup key and
						recovery backup codes.
					</p>
					<div className="max-w-sm space-y-2">
						<Label htmlFor={passwordId}>Current password</Label>
						<Input
							autoComplete="current-password"
							id={passwordId}
							onChange={(event) => setPassword(event.target.value)}
							required
							type="password"
							value={password}
						/>
					</div>
					<div className="flex items-center gap-2">
						<Button
							disabled={isSubmitting || !password}
							size="sm"
							type="submit"
						>
							{isSubmitting ? "Preparing setup..." : "Continue"}
						</Button>
						<Button
							disabled={isSubmitting}
							onClick={resetFlow}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
					</div>
				</form>
			) : null}

			{panel === "verify" && enrollment ? (
				<TwoFactorVerifyPanel
					copiedKey={copiedKey}
					enrollment={enrollment}
					isSubmitting={isSubmitting}
					onCancel={resetFlow}
					onCodeChange={setTotpCode}
					onCopy={(value, label, key) => void copyText(value, label, key)}
					onSubmit={handleVerifyEnrollment}
					totpCode={totpCode}
				/>
			) : null}

			{panel === "backupCodes" && backupCodes.length > 0 ? (
				<TwoFactorBackupCodesPanel
					backupCodes={backupCodes}
					copiedKey={copiedKey}
					onCopy={(value, label, key) => void copyText(value, label, key)}
					onDone={resetFlow}
				/>
			) : null}

			{panel === "disable" ? (
				<form className="space-y-4 p-5" onSubmit={handleDisable}>
					<p className="text-muted-foreground text-sm">
						Enter your current password to regenerate backup codes or disable
						two-factor authentication.
					</p>
					<div className="max-w-sm space-y-2">
						<Label htmlFor={passwordId}>Current password</Label>
						<Input
							autoComplete="current-password"
							id={passwordId}
							onChange={(event) => setPassword(event.target.value)}
							required
							type="password"
							value={password}
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							disabled={isSubmitting || !password}
							onClick={() => void handleRegenerateBackupCodes()}
							size="sm"
							type="button"
							variant="outline"
						>
							Regenerate backup codes
						</Button>
						<Button
							disabled={isSubmitting || !password}
							size="sm"
							type="submit"
							variant="destructive"
						>
							{isSubmitting ? "Disabling..." : "Disable 2FA"}
						</Button>
						<Button
							disabled={isSubmitting}
							onClick={resetFlow}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
					</div>
				</form>
			) : null}
		</SettingsSection>
	);
}
