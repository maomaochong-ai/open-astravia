import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { MessageCenterEmptyState } from "./MessageCenterEmptyState";
import { NotificationMessageList } from "./NotificationMessageList";
import type { MessageCenterTab } from "./types";

export function MessageCenterContent({
	activeTab,
	notifUnread,
}: {
	activeTab: MessageCenterTab;
	notifUnread: number;
}): JSX.Element {
	const { t } = useTranslation("message");

	return (
		<div className="min-h-[160px] flex-1 overflow-y-auto border-t border-border/50">
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={activeTab}
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -6 }}
					transition={{ duration: 0.15 }}
				>
					{activeTab === "all" && (
						<>
							{notifUnread > 0 && <NotificationMessageList />}
							{notifUnread === 0 && (
								<MessageCenterEmptyState text={t("empty.all")} icon="icon-[solar--inbox-linear]" />
							)}
						</>
					)}
					{activeTab === "notifications" && <NotificationMessageList />}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
