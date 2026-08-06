import { retryProgressAtom } from "@shared/store/atoms";
import { MessageListFooterView } from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { PluginTurnCardHost } from "../../../plugins/components/PluginTurnCardHost";
import { StreamingIndicator } from "./AssistantMessage";
import { WorkflowFooterItems } from "./WorkflowFooterItems";

export const MessageListFooter = memo(function MessageListFooter({
	isCompacting,
	showWaiting,
	showWorkflows = false,
}: {
	isCompacting: boolean;
	showWaiting: boolean;
	/** Only the live chat list shows workflow items (not read-only viewers). */
	showWorkflows?: boolean;
}) {
	const { t } = useTranslation("chat");
	const retryProgress = useAtomValue(retryProgressAtom);
	return (
		<MessageListFooterView
			compactionLabel={t("messageList.compactionIndicator")}
			retryLabel={
				retryProgress
					? t("messageList.retryIndicator", {
							attempt: retryProgress.attempt,
							maxAttempts: retryProgress.maxAttempts,
						})
					: null
			}
			isCompacting={isCompacting}
			showWaiting={showWaiting}
			streamingIndicator={<StreamingIndicator />}
			workflowItems={showWorkflows ? <WorkflowFooterItems /> : undefined}
			pluginHost={<PluginTurnCardHost />}
		/>
	);
});
