import type { ConversationUserMessageViewModel } from "@shared/conversation";
import {
	Message,
	MessageLayout,
	MessageVisual,
	UserMessage as UserMessagePrimitive,
	UserMessageContextMenuView,
} from "@vetta/theme-ui/chat";
import { memo } from "react";
import { createPortal } from "react-dom";
import { useUserMessageModel } from "../../hooks/useUserMessageModel";

interface UserMessageProps {
	hasAssistantAfter?: boolean;
	isLastUserMessage?: boolean;
	isStreaming?: boolean;
	message: ConversationUserMessageViewModel;
	onAbortEdit?: () => void;
}

export const UserMessage = memo(function UserMessage(props: UserMessageProps) {
	const model = useUserMessageModel(props);
	const {
		actionsVisible,
		appshot,
		badges,
		branchIndex,
		branchTotal,
		canSwitchBranch,
		contextMenu,
		copyButton,
		copyText,
		displayText,
		entryState,
		fileBadges,
		hasAppshot,
		hasFileBadges,
		hasImages,
		hasSettingsAssistBadge,
		hasSkillBadge,
		images,
		isPendingEdit,
		labels,
		onActionsVisibleChange,
		onBranchNext,
		onBranchPrev,
		onContextMenu,
		onEdit,
		onFork,
		relativeTime,
		editActionAvailable,
		forkActionAvailable,
		textBody,
	} = model;
	const empty =
		!displayText &&
		!hasSkillBadge &&
		!hasSettingsAssistBadge &&
		!hasFileBadges &&
		!hasImages &&
		!hasAppshot;
	const hasPrimaryActions = Boolean(copyText) || editActionAvailable || forkActionAvailable;
	const hasMeta = canSwitchBranch || Boolean(relativeTime);
	const hasActions = hasPrimaryActions || hasMeta;

	return (
		<>
			<Message.Root>
				<MessageLayout.Outgoing asChild>
					<UserMessagePrimitive.Frame
						entryState={entryState}
						onContextMenu={onContextMenu}
						onActionsVisibleChange={onActionsVisibleChange}
					>
				<MessageLayout.OutgoingContent>
					{hasAppshot ? <div className="mb-1.5 flex justify-end">{appshot}</div> : null}
					{hasImages ? <div className="mb-1.5 flex justify-end">{images}</div> : null}
					{hasSkillBadge || hasSettingsAssistBadge ? (
						<div className="mb-1 flex flex-wrap justify-end gap-1">{badges}</div>
					) : null}
					{displayText ? (
						<MessageVisual.OutgoingBubble
							className={`cursor-text ${isPendingEdit ? "ring-1 ring-primary/40" : ""}`}
							style={{ wordBreak: "break-word" }}
						>
							<UserMessagePrimitive.Text
								contentKey={displayText}
								entryState={entryState}
								expandLabel={labels.expand}
							>
								{textBody}
							</UserMessagePrimitive.Text>
						</MessageVisual.OutgoingBubble>
					) : null}
					{empty ? (
						<MessageVisual.OutgoingBubble
							className="cursor-text"
							style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
						>
							{"\u2026"}
						</MessageVisual.OutgoingBubble>
					) : null}
					{hasFileBadges ? (
						<div className="mt-1 flex flex-wrap justify-end gap-1">{fileBadges}</div>
					) : null}
					{hasActions ? (
						<MessageLayout.Footer asChild>
							<div
								className={`flex-col items-end gap-0.5 transition-opacity duration-150 ${
									actionsVisible || isPendingEdit || canSwitchBranch
										? "pointer-events-auto opacity-100"
										: "pointer-events-none opacity-0"
								}`}
							>
								{hasPrimaryActions ? (
									<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
										{editActionAvailable ? (
											<UserMessagePrimitive.Action
												onClick={onEdit}
												title={isPendingEdit ? labels.pendingEdit : labels.edit}
												aria-label={labels.edit}
												className={isPendingEdit ? "text-primary" : undefined}
											>
												<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
											</UserMessagePrimitive.Action>
										) : null}
										{forkActionAvailable ? (
											<UserMessagePrimitive.Action
												onClick={onFork}
												title={labels.fork}
												aria-label={labels.fork}
											>
												<span className="icon-[solar--branching-paths-up-linear] h-3.5 w-3.5" />
											</UserMessagePrimitive.Action>
										) : null}
										{copyText || hasImages || hasAppshot ? copyButton : null}
									</div>
								) : null}
								{hasMeta ? (
									<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
										{canSwitchBranch ? (
											<span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
												<UserMessagePrimitive.Action
													onClick={onBranchPrev}
													disabled={branchIndex <= 0}
													title={labels.branchPrev}
													aria-label={labels.branchPrev}
												>
													<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" />
												</UserMessagePrimitive.Action>
												<span
													className="min-w-[2.5rem] text-center tabular-nums"
													title={labels.branchPosition}
												>
													{branchIndex + 1}/{branchTotal}
												</span>
												<UserMessagePrimitive.Action
													onClick={onBranchNext}
													disabled={branchIndex >= branchTotal - 1}
													title={labels.branchNext}
													aria-label={labels.branchNext}
												>
													<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5" />
												</UserMessagePrimitive.Action>
											</span>
										) : null}
										{relativeTime}
									</div>
								) : null}
							</div>
						</MessageLayout.Footer>
					) : null}
				</MessageLayout.OutgoingContent>
					</UserMessagePrimitive.Frame>
				</MessageLayout.Outgoing>
			</Message.Root>
			{contextMenu
				? createPortal(<UserMessageContextMenuView {...contextMenu} />, document.body)
				: null}
		</>
	);
});
