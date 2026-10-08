import { CompactionBoundaryView, DelegationNoticeView } from "@vetta-org/theme-ui/chat/MessageBoundaryViews";
import { memo } from "react";
import { useTranslation } from "react-i18next";

export const CompactionBoundary = memo(function CompactionBoundary() {
	const { t } = useTranslation("chat");
	return <CompactionBoundaryView label={t("messageList.compactionBoundary")} />;
});

/** A task handed to another agent, as a centered notice in the timeline. */
export const DelegationNotice = memo(function DelegationNotice({ label }: { readonly label: string }) {
	return <DelegationNoticeView label={label} />;
});
