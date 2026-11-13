"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { Clock, Mail } from "lucide-react";
import type { OrganizationInvitation } from "@/lib/organization-hooks";

interface InvitationsTableProps {
	canManageMembers: boolean;
	invitations: OrganizationInvitation[];
	onRevoke: (invitation: OrganizationInvitation) => void;
}

export function InvitationsTable({
	canManageMembers,
	invitations,
	onRevoke,
}: InvitationsTableProps) {
	return (
		<div className="border-border/60 overflow-hidden rounded-2xl border">
			<Table>
				<TableHeader>
					<TableRow className="bg-muted/20">
						<TableHead className="px-6">Recipient Email</TableHead>
						<TableHead>Assigned Role</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="hidden md:table-cell">Expiration</TableHead>
						<TableHead className="text-right">Action</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{invitations.length === 0 ? (
						<TableRow>
							<TableCell
								className="text-muted-foreground h-28 text-center"
								colSpan={5}
							>
								<div className="flex flex-col items-center justify-center gap-2">
									<Mail className="text-muted-foreground/40 h-6 w-6" />
									<span>No pending invitations for this workspace.</span>
								</div>
							</TableCell>
						</TableRow>
					) : (
						invitations.map((invite) => (
							<TableRow className="hover:bg-muted/30" key={invite.id}>
								<TableCell className="text-foreground px-6 py-4 text-sm font-medium">
									{invite.email}
								</TableCell>
								<TableCell>
									<Badge
										className="text-xs font-medium capitalize"
										variant="outline"
									>
										{invite.role}
									</Badge>
								</TableCell>
								<TableCell>
									<Badge
										className="gap-1 border-blue-500/20 bg-blue-500/10 text-xs font-medium text-blue-600 dark:text-blue-400"
										variant="outline"
									>
										<Clock className="h-3 w-3" />
										Pending Accept
									</Badge>
								</TableCell>
								<TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">
									{new Date(invite.expiresAt).toLocaleDateString()}
								</TableCell>
								<TableCell className="text-right">
									{canManageMembers ? (
										<Button
											className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive h-8 text-xs"
											onClick={() => onRevoke(invite)}
											size="sm"
											variant="ghost"
										>
											Revoke Invite
										</Button>
									) : null}
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
