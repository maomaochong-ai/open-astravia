import { NotificationMessageListView as ThemeNotificationMessageListView } from "@vetta/theme-ui/sidebar";
import type { NotificationMessageListModel } from "./useNotificationMessageListModel";

export function NotificationMessageListView(model: NotificationMessageListModel): JSX.Element {
	return (
		<ThemeNotificationMessageListView
			emptyText={model.emptyText}
			emptyIcon={model.emptyIcon}
			hasUnread={model.hasUnread}
			hasRead={model.hasRead}
			markAllReadLabel={model.markAllReadLabel}
			clearReadLabel={model.clearReadLabel}
			deleteLabel={model.deleteLabel}
			items={model.items}
			onMarkAllRead={model.onMarkAllRead}
			onClearRead={model.onClearRead}
			onMarkRead={model.onMarkRead}
			onDelete={model.onDelete}
		/>
	);
}
