"use client";

import type { OrganizationRoleName } from "@workspace/api/permissions";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";

interface InviteMemberDialogProps {
	isSubmitting: boolean;
	onInvite: (input: {
		email: string;
		role: OrganizationRoleName;
	}) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}

export function InviteMemberDialog({
	isSubmitting,
	onInvite,
	onOpenChange,
	open,
}: InviteMemberDialogProps) {
	const emailId = useId();
	const roleId = useId();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<OrganizationRoleName>("member");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmed = email.trim();
		if (!trimmed) {
			return;
		}
		try {
			await onInvite({ email: trimmed, role });
			onOpenChange(false);
			setEmail("");
			setRole("member");
		} catch {
			// Toast handled in mutation
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-lg font-bold">
						Invite New Member
					</DialogTitle>
					<DialogDescription className="text-xs leading-relaxed">
						Send an invitation email with a secure multi-tenant workspace
						onboarding link.
					</DialogDescription>
				</DialogHeader>

				<form className="space-y-4 py-2" onSubmit={handleSubmit}>
					<div className="space-y-1.5">
						<Label className="text-xs font-medium" htmlFor={emailId}>
							Member Email Address
						</Label>
						<Input
							autoFocus
							id={emailId}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="colleague@company.com"
							required
							type="email"
							value={email}
						/>
					</div>

					<div className="space-y-1.5">
						<Label className="text-xs font-medium" htmlFor={roleId}>
							Access Role
						</Label>
						<Select
							onValueChange={(value) => setRole(value as OrganizationRoleName)}
							value={role}
						>
							<SelectTrigger id={roleId}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="admin">
									Admin (Manage team, settings & resources)
								</SelectItem>
								<SelectItem value="member">
									Member (Standard create & edit permissions)
								</SelectItem>
								<SelectItem value="viewer">
									Viewer (Read-only access)
								</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<DialogFooter className="pt-2">
						<Button
							onClick={() => onOpenChange(false)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={isSubmitting}
							size="sm"
							type="submit"
							variant="primary"
						>
							{isSubmitting ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Sending Invite...
								</>
							) : (
								"Send Invitation"
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
