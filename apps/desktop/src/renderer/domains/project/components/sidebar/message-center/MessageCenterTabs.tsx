import {
	MessageCenterTabs as ThemeMessageCenterTabs,
	type MessageCenterTabId,
} from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";
import { MESSAGE_CENTER_SPRING, MESSAGE_CENTER_TABS, type MessageCenterTab } from "./types";

export function MessageCenterTabs({
	activeTab,
	chatUnread,
	notifUnread,
	pendingCount,
	onSelect,
}: {
	activeTab: MessageCenterTab;
	chatUnread: number;
	notifUnread: number;
	pendingCount: number;
	onSelect: (tab: MessageCenterTab) => void;
}): JSX.Element {
	const { t } = useTranslation("message");
	return (
		<ThemeMessageCenterTabs
			tabs={MESSAGE_CENTER_TABS.map((tab) => ({
				value: tab.value as MessageCenterTabId,
				icon: tab.icon,
				label: t(`tabs.${tab.value}`),
			}))}
			activeTab={activeTab as MessageCenterTabId}
			chatUnread={chatUnread}
			notifUnread={notifUnread}
			pendingCount={pendingCount}
			onSelect={(tab) => onSelect(tab as MessageCenterTab)}
			spring={MESSAGE_CENTER_SPRING}
		/>
	);
}
