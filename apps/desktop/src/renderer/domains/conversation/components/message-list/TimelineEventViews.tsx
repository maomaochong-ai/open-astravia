import { CompactionBoundaryView, Message, MessageLayout, MessageVisual } from "@vetta-org/theme-ui/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";

export const CompactionBoundary = memo(function CompactionBoundary() {
	const { t } = useTranslation("chat");
	return <CompactionBoundaryView label={t("messageList.compactionBoundary")} />;
});

/** A task handed to another agent, as a centered notice in the timeline. */
export const DelegationNotice = memo(function DelegationNotice({ label }: { readonly label: string }) {
	return (
		<Message.Root>
			<MessageLayout.Event>
				<MessageVisual.EventBubble>
					<span className="icon-[solar--forward-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate">{label}</span>
				</MessageVisual.EventBubble>
			</MessageLayout.Event>
		</Message.Root>
	);
});
