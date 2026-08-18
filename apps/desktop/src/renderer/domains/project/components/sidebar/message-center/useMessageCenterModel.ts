import { notificationUnreadAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type { MessageCenterTab } from "./types";

export function useMessageCenterModel(): {
	activeTab: MessageCenterTab;
	chatUnread: number;
	close: () => void;
	notifUnread: number;
	open: boolean;
	pendingCount: number;
	setActiveTab: (tab: MessageCenterTab) => void;
	setOpen: (open: boolean) => void;
	totalUnread: number;
} {
	const [open, setOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<MessageCenterTab>("all");
	const notifUnread = useAtomValue(notificationUnreadAtom);
	const totalUnread = notifUnread;

	return {
		activeTab,
		chatUnread: 0,
		close: () => setOpen(false),
		notifUnread,
		open,
		pendingCount: 0,
		setActiveTab,
		setOpen,
		totalUnread,
	};
}
