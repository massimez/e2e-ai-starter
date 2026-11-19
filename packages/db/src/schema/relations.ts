import { relations } from "drizzle-orm";
import { auditLog } from "./audit";
import {
	notification,
	notificationPreference,
	pushSubscription,
} from "./notification";
import {
	invitation,
	member,
	organization,
	organizationRole,
} from "./organization";
import { account, session } from "./session";
import { organizationStorageLimits, storageFolders, uploads } from "./storage";
import { user } from "./user";

export const userRelations = relations(user, ({ many, one }) => ({
	accounts: many(account),
	auditLogs: many(auditLog),
	defaultOrganization: one(organization, {
		fields: [user.defaultOrganizationId],
		references: [organization.id],
	}),
	memberships: many(member),
	notificationPreferences: many(notificationPreference),
	notifications: many(notification),
	pushSubscriptions: many(pushSubscription),
	sentInvitations: many(invitation),
	sessions: many(session),
	uploads: many(uploads),
}));

export const sessionRelations = relations(session, ({ one }) => ({
	activeOrganization: one(organization, {
		fields: [session.activeOrganizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const organizationRelations = relations(
	organization,
	({ many, one }) => ({
		invitations: many(invitation),
		members: many(member),
		notifications: many(notification),
		roles: many(organizationRole),
		storageFolders: many(storageFolders),
		storageLimit: one(organizationStorageLimits, {
			fields: [organization.id],
			references: [organizationStorageLimits.organizationId],
		}),
		uploads: many(uploads),
	})
);

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [member.userId],
		references: [user.id],
	}),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
	inviter: one(user, {
		fields: [invitation.inviterId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
}));

export const organizationRoleRelations = relations(
	organizationRole,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationRole.organizationId],
			references: [organization.id],
		}),
	})
);

export const organizationStorageLimitsRelations = relations(
	organizationStorageLimits,
	({ one }) => ({
		organization: one(organization, {
			fields: [organizationStorageLimits.organizationId],
			references: [organization.id],
		}),
	})
);

export const storageFoldersRelations = relations(
	storageFolders,
	({ many, one }) => ({
		children: many(storageFolders, { relationName: "folder_hierarchy" }),
		organization: one(organization, {
			fields: [storageFolders.organizationId],
			references: [organization.id],
		}),
		parent: one(storageFolders, {
			fields: [storageFolders.parentId],
			references: [storageFolders.id],
			relationName: "folder_hierarchy",
		}),
		uploads: many(uploads),
	})
);

export const uploadsRelations = relations(uploads, ({ one }) => ({
	folder: one(storageFolders, {
		fields: [uploads.folderId],
		references: [storageFolders.id],
	}),
	organization: one(organization, {
		fields: [uploads.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [uploads.userId],
		references: [user.id],
	}),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
	organization: one(organization, {
		fields: [notification.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [notification.userId],
		references: [user.id],
	}),
}));

export const notificationPreferenceRelations = relations(
	notificationPreference,
	({ one }) => ({
		user: one(user, {
			fields: [notificationPreference.userId],
			references: [user.id],
		}),
	})
);

export const pushSubscriptionRelations = relations(
	pushSubscription,
	({ one }) => ({
		user: one(user, {
			fields: [pushSubscription.userId],
			references: [user.id],
		}),
	})
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
	user: one(user, {
		fields: [auditLog.userId],
		references: [user.id],
	}),
}));
