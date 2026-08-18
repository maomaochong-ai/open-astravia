import {
	clearReadNotifications,
	deleteNotification,
	markAllNotificationsRead,
	markNotificationRead,
	type NotificationVO,
} from "@shared/lib/api";
import { authTokenAtom, notificationsAtom, notificationUnreadAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "./formatRelativeTime";

export interface NotificationMessageListItemView {
	readonly id: number;
	readonly title: string;
	readonly body: string | null;
	readonly read: boolean;
	readonly relativeTime: string;
}

export interface NotificationMessageListModel {
	readonly emptyText: string;
	readonly emptyIcon: string;
	readonly hasUnread: boolean;
	readonly hasRead: boolean;
	readonly markAllReadLabel: string;
	readonly clearReadLabel: string;
	readonly deleteLabel: string;
	readonly items: readonly NotificationMessageListItemView[];
	readonly onMarkAllRead: () => void;
	readonly onClearRead: () => void;
	readonly onMarkRead: (id: number) => void;
	readonly onDelete: (id: number) => void;
}

export function useNotificationMessageListModel(): NotificationMessageListModel {
	const { t } = useTranslation("message");
	const token = useAtomValue(authTokenAtom);
	const notifications = useAtomValue(notificationsAtom);
	const setNotifications = useSetAtom(notificationsAtom);
	const setUnread = useSetAtom(notificationUnreadAtom);

	const hasUnread = notifications.some((notification) => !notification.read);
	const hasRead = notifications.some((notification) => notification.read);

	const markRead = (notification: NotificationVO): void => {
		if (notification.read || !token) return;
		setNotifications((prev) => prev.map((item) => (item.id === notification.id ? { ...item, read: true } : item)));
		setUnread((prev) => Math.max(0, prev - 1));
		void markNotificationRead(token, notification.id).catch(console.error);
	};

	const handleReadAll = (): void => {
		if (!token) return;
		setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
		setUnread(0);
		void markAllNotificationsRead(token).catch(console.error);
	};

	const handleDelete = (notification: NotificationVO): void => {
		if (!token) return;
		setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
		if (!notification.read) setUnread((prev) => Math.max(0, prev - 1));
		void deleteNotification(token, notification.id).catch(console.error);
	};

	const handleClearRead = (): void => {
		if (!token) return;
		setNotifications((prev) => prev.filter((item) => !item.read));
		void clearReadNotifications(token).catch(console.error);
	};

	return {
		emptyText: t("empty.notifications"),
		emptyIcon: "icon-[solar--bell-linear]",
		hasUnread,
		hasRead,
		markAllReadLabel: t("notification.markAllRead"),
		clearReadLabel: t("notification.clearRead"),
		deleteLabel: t("notification.delete"),
		items: notifications.map((notification) => ({
			id: notification.id,
			title: notification.title,
			body: notification.body,
			read: notification.read,
			relativeTime: formatRelativeTime(notification.created_at, t),
		})),
		onMarkAllRead: handleReadAll,
		onClearRead: handleClearRead,
		onMarkRead: (id) => {
			const notification = notifications.find((item) => item.id === id);
			if (notification) markRead(notification);
		},
		onDelete: (id) => {
			const notification = notifications.find((item) => item.id === id);
			if (notification) handleDelete(notification);
		},
	};
}
