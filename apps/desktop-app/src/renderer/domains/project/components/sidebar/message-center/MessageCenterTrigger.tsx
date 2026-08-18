import { MessageCenterTriggerView } from "@vetta/theme-ui/sidebar";
import { useTranslation } from "react-i18next";

export function MessageCenterTrigger({
	open,
	totalUnread,
	onOpen,
}: {
	open: boolean;
	totalUnread: number;
	onOpen: () => void;
}): JSX.Element {
	const { t } = useTranslation("message");
	return (
		<MessageCenterTriggerView open={open} totalUnread={totalUnread} title={t("triggerTitle")} onOpen={onOpen} />
	);
}
