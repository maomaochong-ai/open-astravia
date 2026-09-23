import type { ConversationParticipantViewModel, ConversationUserMessageViewModel } from "@shared/conversation";
import {
	MessageLayout,
	UserMessage as UserMessagePrimitive,
	UserMessageContextMenuView,
} from "@vetta-org/theme-ui/chat";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
	useUserMessageContextMenu,
	useUserMessageCopyAction,
	useUserMessageDeleteAction,
	useUserMessageEditAction,
	useUserMessageHistoryActions,
} from "../../hooks/useUserMessageActions";
import { CopyButton } from "./MessageActions";
import { projectUserMessage } from "./userMessageProjection";
import { UserMessage } from "./UserMessage";
import { AnnotationMessageMenu } from "../annotations/AnnotationMenus";

export interface SessionUserMessageProps {
	message: ConversationUserMessageViewModel;
	participants?: readonly ConversationParticipantViewModel[];
	isLastUserMessage?: boolean;
	isStreaming?: boolean;
	onAbortEdit?: () => void;
}

/** The session extension owns edit/fork/delete; the content recipe never imports it. */
export function SessionUserMessage({
	message,
	participants,
	isLastUserMessage = false,
	isStreaming = false,
	onAbortEdit,
}: SessionUserMessageProps) {
	const { t } = useTranslation("chat");
	const projection = useMemo(() => projectUserMessage(message), [message]);
	const [actionsVisible, setActionsVisible] = useState(false);
	const edit = useUserMessageEditAction({ message, isLastUserMessage, enabled: true });
	const history = useUserMessageHistoryActions({
		message,
		isStreaming,
		onAbortEdit,
		forkEnabled: true,
	});
	const remove = useUserMessageDeleteAction({
		message,
		isStreaming,
		onAbortEdit,
		enabled: true,
	});
	const copyMessage = useUserMessageCopyAction(projection.copyText, projection.copyImageSources);
	const canCopy = Boolean(projection.copyText || projection.copyImageSources.length > 0);
	const contextMenu = useUserMessageContextMenu({
		canCopy,
		canDelete: remove.available,
		canEdit: edit.available,
		onCopy: copyMessage,
		onDelete: remove.onDelete,
		onEdit: edit.onEdit,
	});
	const labels = {
		expand: t("messageList.userMessage.expand"),
		edit: t("messageList.editButton"),
		fork: t("messageList.forkButton"),
		branchPrev: t("messageList.branch.prev"),
		branchNext: t("messageList.branch.next"),
		branchPosition: message.branch
			? t("messageList.branch.position", {
					current: message.branch.index + 1,
					total: message.branch.siblings.length,
				})
			: "",
		pendingEdit: t("messageList.edit.pendingHint"),
	};

	const hasPrimaryActions = Boolean(projection.copyText) || edit.available || history.forkAvailable;
	const hasMeta = history.canSwitch;
	const hasActions = hasPrimaryActions || hasMeta;
	return (
		<>
			<UserMessage
				message={message}
				participants={participants}
				pending={edit.pending}
				onContextMenu={contextMenu.onContextMenu}
				onActionsVisibleChange={setActionsVisible}
			>
				{hasActions ? (
					<MessageLayout.Footer asChild>
						<div
							className={`flex-col items-end gap-0.5 transition-opacity duration-150 focus-within:pointer-events-auto focus-within:opacity-100 ${actionsVisible || edit.pending || history.canSwitch ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
						>
							{hasPrimaryActions ? (
								<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
									{edit.available ? (
										<UserMessagePrimitive.Action
											onClick={edit.onEdit}
											title={edit.pending ? labels.pendingEdit : labels.edit}
											aria-label={labels.edit}
											className={edit.pending ? "text-primary" : undefined}
										>
											<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
										</UserMessagePrimitive.Action>
									) : null}
									{history.forkAvailable ? (
										<UserMessagePrimitive.Action onClick={history.onFork} title={labels.fork} aria-label={labels.fork}>
											<span className="icon-[solar--branching-paths-up-linear] h-3.5 w-3.5" />
										</UserMessagePrimitive.Action>
									) : null}
									{canCopy ? <CopyButton getText={() => projection.copyText} onCopy={copyMessage} /> : null}
									<AnnotationMessageMenu message={message} />
								</div>
							) : null}
							{hasMeta ? (
								<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
									<span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
										<UserMessagePrimitive.Action
											onClick={history.onPrevious}
											disabled={history.branchIndex <= 0}
											title={labels.branchPrev}
											aria-label={labels.branchPrev}
										>
											<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" />
										</UserMessagePrimitive.Action>
										<span className="min-w-[2.5rem] text-center tabular-nums" title={labels.branchPosition}>
											{history.branchIndex + 1}/{history.branchTotal}
										</span>
										<UserMessagePrimitive.Action
											onClick={history.onNext}
											disabled={history.branchIndex >= history.branchTotal - 1}
											title={labels.branchNext}
											aria-label={labels.branchNext}
										>
											<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5" />
										</UserMessagePrimitive.Action>
									</span>
								</div>
							) : null}
						</div>
					</MessageLayout.Footer>
				) : null}
			</UserMessage>
			{contextMenu.model ? createPortal(<UserMessageContextMenuView {...contextMenu.model} />, document.body) : null}
		</>
	);
}
