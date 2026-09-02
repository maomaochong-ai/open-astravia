import { retryProgressAtom } from "@shared/store/atoms";
import { MessageListFooter as MessageListFooterPrimitive } from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { PluginTurnCardHost } from "../../../plugins/components/PluginTurnCardHost";
import { classifyChatError } from "../../services/classifyChatError";
import { StreamingIndicator } from "./AssistantMessage";
import { WorkflowFooterItems } from "./WorkflowFooterItems";

export const MessageListFooter = memo(function MessageListFooter({
	isCompacting,
	pendingLabel,
	waiting,
	sessionId,
}: {
	isCompacting: boolean;
	pendingLabel?: string;
	/** Runtime state; true while the live reply has not produced visible content. */
	waiting: boolean;
	/** Workflows only exist for an established live session. */
	sessionId?: string;
}) {
	const { t } = useTranslation("chat");
	const retryProgress = useAtomValue(retryProgressAtom);
	const retryKind = retryProgress ? classifyChatError(retryProgress.errorMessage) : undefined;
	const retryLabel = retryProgress
		? t("messageList.retryIndicator", {
				attempt: retryProgress.attempt,
				maxAttempts: retryProgress.maxAttempts,
			})
		: null;
	const retryDetail = retryKind
		? t("messageList.retryReason", {
				reason: t(`messageList.errorBlock.kinds.${retryKind}.title`),
			})
		: null;
	return (
		<MessageListFooterPrimitive.Root>
			<MessageListFooterPrimitive.Presence>
				{pendingLabel ? (
					<MessageListFooterPrimitive.Pending key="pending" label={pendingLabel} />
				) : null}
				{isCompacting ? (
					<MessageListFooterPrimitive.Compacting
						key="compacting"
						label={t("messageList.compactionIndicator")}
					/>
				) : null}
				{!isCompacting && retryLabel ? (
					<MessageListFooterPrimitive.Retry
						key="retrying"
						label={retryLabel}
						detail={retryDetail}
					/>
				) : null}
			</MessageListFooterPrimitive.Presence>
			{waiting && !pendingLabel && !isCompacting && !retryLabel ? (
				<MessageListFooterPrimitive.Waiting>
					<StreamingIndicator />
				</MessageListFooterPrimitive.Waiting>
			) : null}
			{sessionId ? <WorkflowFooterItems /> : null}
			<PluginTurnCardHost />
		</MessageListFooterPrimitive.Root>
	);
});
