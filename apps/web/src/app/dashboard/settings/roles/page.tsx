import { PERMISSION_MATRIX } from "@workspace/api/permissions";
import { Badge } from "@workspace/ui/components/badge";
import {
	SettingsPage,
	SettingsSection,
	SettingsSectionContent,
	SettingsSectionHeader,
} from "@workspace/ui/components/settings-shell";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@workspace/ui/components/table";
import { Check, Minus } from "lucide-react";
import { ROLE_DISPLAY_LIST } from "@/components/role-badge";

function PermissionCell({ allowed }: { allowed: boolean }) {
	return (
		<TableCell className="text-center">
			{allowed ? (
				<span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
					<Check className="h-3.5 w-3.5" />
				</span>
			) : (
				<Minus className="text-muted-foreground/30 mx-auto h-3.5 w-3.5" />
			)}
		</TableCell>
	);
}

export default function RolesSettingsPage() {
	return (
		<SettingsPage
			description="Overview of built-in Role-Based Access Control (RBAC) permissions enforced across all workspace routes."
			headingLevel="h2"
			title="Roles & Access Matrix"
		>
			{/* Role Persona Cards */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{ROLE_DISPLAY_LIST.map((r) => {
					const Icon = r.icon;
					return (
						<div
							className={`group border-border/60 bg-card/60 hover:bg-card relative overflow-hidden rounded-2xl border p-5 shadow-xs backdrop-blur-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${r.borderClass}`}
							key={r.name}
						>
							<div className="flex items-center justify-between">
								<Badge className={`gap-1.5 ${r.badgeClass}`} variant="outline">
									<Icon className="h-3.5 w-3.5" />
									{r.name}
								</Badge>
								<span className="text-muted-foreground font-mono text-[10px]">
									{r.powerTag}
								</span>
							</div>
							<p className="text-muted-foreground mt-3 text-xs leading-relaxed">
								{r.description}
							</p>
						</div>
					);
				})}
			</div>

			{/* Detailed Permission Matrix Table derived from @workspace/api/permissions */}
			<SettingsSection>
				<SettingsSectionHeader
					description="Granular permission mapping verified by Hono API middleware and shared contract definitions."
					title="Role Permission Breakdown"
				/>
				<SettingsSectionContent className="p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-2/5 px-6">Capability & Scope</TableHead>
								<TableHead className="text-center">Viewer</TableHead>
								<TableHead className="text-center">Member</TableHead>
								<TableHead className="text-center">Admin</TableHead>
								<TableHead className="text-center">Owner</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{PERMISSION_MATRIX.map((row) => (
								<TableRow className="hover:bg-muted/30" key={row.resource}>
									<TableCell className="px-6 py-4">
										<div className="text-foreground text-sm font-semibold">
											{row.resource}
										</div>
										<div className="text-muted-foreground text-xs leading-relaxed">
											{row.description}
										</div>
									</TableCell>
									<PermissionCell allowed={row.viewer} />
									<PermissionCell allowed={row.member} />
									<PermissionCell allowed={row.admin} />
									<PermissionCell allowed={row.owner} />
								</TableRow>
							))}
						</TableBody>
					</Table>
				</SettingsSectionContent>
			</SettingsSection>
		</SettingsPage>
	);
}
