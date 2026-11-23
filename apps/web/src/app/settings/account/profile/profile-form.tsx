"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { authClient, useSession } from "@/lib/auth-client";

const fields = [
	{ key: "firstName", label: "First name", autoComplete: "given-name" },
	{ key: "lastName", label: "Last name", autoComplete: "family-name" },
] as const;

type ProfileEdits = Partial<Record<(typeof fields)[number]["key"], string>>;
type ProfileUser = typeof authClient.$Infer.Session.user;

function ProfileEditor({ user }: { user: ProfileUser }) {
	const [edits, setEdits] = useState<ProfileEdits>({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const original = {
		firstName: user.firstName ?? "",
		lastName: user.lastName ?? "",
	};
	const firstName = (edits.firstName ?? original.firstName).trim();
	const lastName = (edits.lastName ?? original.lastName).trim();
	const name = [firstName, lastName].filter(Boolean).join(" ");
	const changed =
		firstName !== original.firstName || lastName !== original.lastName;
	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!(firstName && changed) || saving) {
			return;
		}
		setSaving(true);
		setError("");
		try {
			const { error: updateError } = await authClient.updateUser({
				firstName,
				lastName,
				name,
			});
			if (updateError) {
				throw new Error(updateError.message || "Could not save your profile.");
			}
			toast.success("Profile saved");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not save your profile. Try again."
			);
		} finally {
			setSaving(false);
		}
	}
	return (
		<form className="space-y-6" onSubmit={save}>
			<div className="flex items-center gap-4">
				<Avatar className="size-14">
					<AvatarImage alt="" src={user.image || undefined} />
					<AvatarFallback>{user.name.charAt(0).toUpperCase()}</AvatarFallback>
				</Avatar>
				<div className="min-w-0">
					<p className="text-sm font-medium">Sign-in email</p>
					<p className="text-muted-foreground text-sm break-all">
						{user.email}
					</p>
				</div>
			</div>
			<fieldset className="grid gap-5 sm:grid-cols-2" disabled={saving}>
				{fields.map(({ key, label, autoComplete }) => (
					<div className="space-y-2" key={key}>
						<Label htmlFor={key}>{label}</Label>
						<Input
							autoComplete={autoComplete}
							id={key}
							name={key}
							onChange={(event) => {
								setEdits({ ...edits, [key]: event.target.value });
								setError("");
							}}
							required={key === "firstName"}
							value={edits[key] ?? original[key]}
						/>
					</div>
				))}
			</fieldset>
			{error.length > 0 && (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			)}
			<Button disabled={!(changed && firstName) || saving} type="submit">
				{saving ? "Saving…" : "Save changes"}
			</Button>
		</form>
	);
}

export function ProfileForm() {
	const { data, isPending, refetch } = useSession();
	let content: ReactNode;
	if (data?.user) {
		content = <ProfileEditor key={data.user.id} user={data.user} />;
	} else if (isPending) {
		content = (
			<p className="text-muted-foreground text-sm" role="status">
				Loading profile…
			</p>
		);
	} else {
		content = (
			<div className="space-y-2">
				<p role="alert">Could not load your profile.</p>
				<Button onClick={() => void refetch()} variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	return (
		<SettingsSection>
			<SettingsSectionHeader title="Profile details" />
			<SettingsSectionContent>{content}</SettingsSectionContent>
		</SettingsSection>
	);
}
