import { NotificationMessageListView } from "./NotificationMessageListView";
import { useNotificationMessageListModel } from "./useNotificationMessageListModel";

export function NotificationMessageList(): JSX.Element {
	const model = useNotificationMessageListModel();
	return <NotificationMessageListView {...model} />;
}
