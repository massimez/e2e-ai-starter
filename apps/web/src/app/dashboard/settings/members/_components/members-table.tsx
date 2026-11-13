"use client";

import type { OrganizationRoleName } from "@workspace/api/permissions";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { LogOut, Trash2, Users } from "lucide-react";
import { RoleBadge } from "@/components/role-badge";
import type { OrganizationMember } from "@/lib/organization-hooks";

interface MembersTableProps {
	canManageMembers: boolean;
	currentUserId?: string;
	isOwner: boolean;
	members: OrganizationMember[];
	onLeave: () => void;
	onRemove: (member: OrganizationMember) => void;
	onRoleChange: (memberId: string, role: OrganizationRoleName) => void;
}

function MemberRoleCell({
	canEdit,
	memberId,
	onRoleChange,
	role,
}: {
	canEdit: boolean;
	memberId: string;
	onRoleChange: (id: string, role: OrganizationRoleName) => void;
	role: string;
}) {
	if (role === "owner" || !canEdit) {
		return <RoleBadge className="px-2.5 py-0.5" role={role} />;
	}

	return (
		<div className="w-32">
			<Select
				onValueChange={(val) =>
					onRoleChange(memberId, val as OrganizationRoleName)
				}
				value={role}
			>
				<SelectTrigger className="h-8 text-xs font-medium">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="admin">Admin</SelectItem>
					<SelectItem value="member">Member</SelectItem>
					<SelectItem value="viewer">Viewer</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function MemberActionsCell({
	canRemove,
	isMe,
	isOwner,
	member,
	onLeave,
	onRemove,
}: {
	canRemove: boolean;
	isMe: boolean;
	isOwner: boolean;
	member: OrganizationMember;
	onLeave: () => void;
	onRemove: (member: OrganizationMember) => void;
}) {
	if (canRemove) {
		return (
			<Button
				className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive h-8 w-8 transition-colors"
				onClick={() => onRemove(member)}
				size="icon"
				variant="ghost"
			>
				<Trash2 className="h-4 w-4" />
				<span className="sr-only">Remove member</span>
			</Button>
		);
	}

	if (isMe && !isOwner) {
		return (
			<Button
				className="text-destructive hover:bg-destructive/10 gap-1.5 text-xs"
				onClick={onLeave}
				size="sm"
				variant="ghost"
			>
				<LogOut className="h-3.5 w-3.5" />
				Leave Workspace
			</Button>
		);
	}

	return null;
}

export function MembersTable({
	canManageMembers,
	currentUserId,
	isOwner,
	members,
	onLeave,
	onRemove,
	onRoleChange,
}: MembersTableProps) {
	return (
		<div className="border-border/60 overflow-hidden rounded-2xl border">
			<Table>
				<TableHeader>
					<TableRow className="bg-muted/20">
						<TableHead className="px-6">Member Identity</TableHead>
						<TableHead>Assigned Role</TableHead>
						<TableHead className="hidden md:table-cell">Joined Date</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{members.length === 0 ? (
						<TableRow>
							<TableCell
								className="text-muted-foreground h-28 text-center"
								colSpan={4}
							>
								<div className="flex flex-col items-center justify-center gap-2">
									<Users className="text-muted-foreground/40 h-6 w-6" />
									<span>No team members found matching your search.</span>
								</div>
							</TableCell>
						</TableRow>
					) : (
						members.map((member) => {
							const isMe = member.userId === currentUserId;
							const isMemberOwner = member.role === "owner";
							const canManageOther =
								canManageMembers && !isMemberOwner && !isMe;

							return (
								<TableRow className="hover:bg-muted/30" key={member.id}>
									<TableCell className="px-6 py-4">
										<div className="flex items-center gap-3.5">
											<Avatar className="border-border/70 h-10 w-10 rounded-xl border shadow-2xs">
												{member.user.image ? (
													<AvatarImage
														alt={member.user.name}
														src={member.user.image}
													/>
												) : null}
												<AvatarFallback className="from-primary/20 via-primary/10 to-primary/5 text-primary rounded-xl bg-linear-to-br text-xs font-bold">
													{member.user.name.charAt(0).toUpperCase() || "U"}
												</AvatarFallback>
											</Avatar>
											<div className="min-w-0">
												<div className="flex items-center gap-2">
													<span className="text-foreground text-sm font-semibold">
														{member.user.name}
													</span>
													{isMe ? (
														<Badge
															className="border-primary/20 bg-primary/10 text-primary px-1.5 py-0 text-[10px]"
															variant="outline"
														>
															You
														</Badge>
													) : null}
												</div>
												<div className="text-muted-foreground truncate text-xs">
													{member.user.email}
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<MemberRoleCell
											canEdit={canManageOther}
											memberId={member.id}
											onRoleChange={onRoleChange}
											role={member.role}
										/>
									</TableCell>
									<TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">
										{new Date(member.createdAt).toLocaleDateString()}
									</TableCell>
									<TableCell className="text-right">
										<MemberActionsCell
											canRemove={canManageOther}
											isMe={isMe}
											isOwner={isOwner}
											member={member}
											onLeave={onLeave}
											onRemove={onRemove}
										/>
									</TableCell>
								</TableRow>
							);
						})
					)}
				</TableBody>
			</Table>
		</div>
	);
}
