import type { ConversationUserMessageViewModel } from "@shared/conversation";
import { toTokenPath } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import { filePreviewAtom } from "@shared/store/atoms";
import {
	Message,
	MessageLayout,
	MessageVisual,
	SettingsAssistBadgeView,
	UserMessage as UserMessagePrimitive,
	UserMessageContextMenuView,
} from "@vetta/theme-ui/chat";
import { useSetAtom } from "jotai";
import { memo, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
	useUserMessageContextMenu,
	useUserMessageCopyAction,
	useUserMessageDeleteAction,
	useUserMessageEditAction,
	useUserMessageHistoryActions,
} from "../../hooks/useUserMessageActions";
import { useSkillTokenMeta } from "../../hooks/useSkillTokenMeta";
import { AppshotCard } from "../AppshotCard";
import { TextBlockView } from "../blocks/TextBlock";
import { CopyButton } from "./MessageActions";
import {
	isSettingsAssistTabId,
	projectUserMessage,
	userMessagePreviewSource,
} from "./userMessageProjection";

interface UserMessageProps {
	actions?: { readonly edit: boolean; readonly fork: boolean; readonly delete: boolean };
	hasAssistantAfter?: boolean;
	isLastUserMessage?: boolean;
	isStreaming?: boolean;
	message: ConversationUserMessageViewModel;
	onAbortEdit?: () => void;
}

export const UserMessage = memo(function UserMessage({
	message,
	isLastUserMessage = false,
	isStreaming = false,
	onAbortEdit,
	actions = { edit: true, fork: true, delete: true },
}: UserMessageProps) {
	const { t } = useTranslation("chat");
	const projection = useMemo(() => projectUserMessage(message), [message]);
	const resolveSkillMeta = useSkillTokenMeta();
	const setFilePreview = useSetAtom(filePreviewAtom);
	const [actionsVisible, setActionsVisible] = useState(false);
	const edit = useUserMessageEditAction({ message, isLastUserMessage, enabled: actions.edit });
	const history = useUserMessageHistoryActions({
		message,
		isStreaming,
		onAbortEdit,
		forkEnabled: actions.fork,
	});
	const remove = useUserMessageDeleteAction({
		message,
		isStreaming,
		onAbortEdit,
		enabled: actions.delete,
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
	const hasSettingsAssistBadge = projection.settingsAssistTabId.length > 0;
	const settingsLabel = hasSettingsAssistBadge
		? t(
				isSettingsAssistTabId(projection.settingsAssistTabId)
					? (`messageList.userMessage.settingsAssist.${projection.settingsAssistTabId}` as const)
					: "messageList.userMessage.settingsAssist.unknown",
			)
		: "";
	const hasImages = projection.imageItems.length > 0;
	const hasFileBadges = projection.fileBadges.length > 0;
	const hasAppshot = Boolean(projection.appshot);
	const empty =
		!projection.displayText && !hasSettingsAssistBadge && !hasFileBadges && !hasImages && !hasAppshot;
	const hasPrimaryActions = Boolean(projection.copyText) || edit.available || history.forkAvailable;
	const hasMeta = history.canSwitch;
	const hasActions = hasPrimaryActions || hasMeta;

	return (
		<>
			<Message.Root>
				<MessageLayout.Outgoing asChild>
					<UserMessagePrimitive.Frame
						entryState="static"
						onContextMenu={contextMenu.onContextMenu}
						onActionsVisibleChange={setActionsVisible}
					>
						<MessageLayout.OutgoingContent>
							{hasSettingsAssistBadge ? <SettingsAssistBadgeView label={settingsLabel} /> : null}
							{hasImages ? (
								<div className="flex max-w-full justify-end gap-2 overflow-x-auto">
									{projection.imageItems.map((item, index) => (
										<button
											key={item.path ?? item.url ?? `${item.name}-${index}`}
											type="button"
											onClick={() => setFilePreview({ items: [...projection.imageItems], index })}
											className="group relative h-20 w-20 overflow-hidden rounded-xl border border-border/60 bg-muted/60 transition-colors hover:border-primary/50"
											title={item.path ?? item.name}
										>
											<img src={userMessagePreviewSource(item)} alt={item.name} className="h-full w-full object-cover" />
											<span className="pointer-events-none absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/10" />
											<span className="pointer-events-none absolute bottom-1 right-1 rounded bg-foreground/45 px-1 text-[9px] font-medium leading-[1.4] text-background/90">
												{t("inputBar.capsule.imageBadge", {
													index: (item.path ? projection.imageIndexByPath.get(toTokenPath(item.path)) : undefined) ?? index + 1,
												})}
											</span>
										</button>
									))}
								</div>
							) : null}
							{projection.appshot ? <AppshotCard data={projection.appshot} /> : null}
							{projection.displayText ? (
								<MessageVisual.OutgoingBubble className={`cursor-text ${edit.pending ? "ring-1 ring-primary/40" : ""}`} style={{ wordBreak: "break-word" }}>
									<UserMessagePrimitive.Text contentKey={projection.displayText} entryState="static" expandLabel={labels.expand}>
										<TextBlockView
											text={projection.displayText}
											inlineTokens={{
												getImageLabel: (path) => {
													const index = projection.imageIndexByPath.get(toTokenPath(path));
													return index ? t("inputBar.capsule.imageBadge", { index }) : pathBasename(path);
												},
												getSkill: (name) => resolveSkillMeta("skill", name),
												getScene: (name) => resolveSkillMeta("scene", name),
											}}
											className="max-w-full overflow-x-auto [overflow-wrap:anywhere] [&_code]:break-all"
										/>
									</UserMessagePrimitive.Text>
								</MessageVisual.OutgoingBubble>
							) : null}
							{empty ? <MessageVisual.OutgoingBubble className="cursor-text" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{"\u2026"}</MessageVisual.OutgoingBubble> : null}
							{hasFileBadges ? (
								<div className="mt-1 flex flex-wrap justify-end gap-1">
									{projection.fileBadges.map((file) => {
										const name = pathBasename(file);
										return <button key={file} type="button" className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20" title={file} onClick={() => setFilePreview({ name, path: file })}><span className="icon-[solar--file-linear] h-3 w-3" />{name}</button>;
									})}
								</div>
							) : null}
							{hasActions ? (
								<MessageLayout.Footer asChild>
									<div className={`flex-col items-end gap-0.5 transition-opacity duration-150 ${actionsVisible || edit.pending || history.canSwitch ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}>
										{hasPrimaryActions ? (
											<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
												{edit.available ? <UserMessagePrimitive.Action onClick={edit.onEdit} title={edit.pending ? labels.pendingEdit : labels.edit} aria-label={labels.edit} className={edit.pending ? "text-primary" : undefined}><span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" /></UserMessagePrimitive.Action> : null}
												{history.forkAvailable ? <UserMessagePrimitive.Action onClick={history.onFork} title={labels.fork} aria-label={labels.fork}><span className="icon-[solar--branching-paths-up-linear] h-3.5 w-3.5" /></UserMessagePrimitive.Action> : null}
												{canCopy ? <CopyButton getText={() => projection.copyText} onCopy={copyMessage} /> : null}
											</div>
										) : null}
										{hasMeta ? (
											<div className="flex h-6 items-center justify-end gap-1 whitespace-nowrap">
												<span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
													<UserMessagePrimitive.Action onClick={history.onPrevious} disabled={history.branchIndex <= 0} title={labels.branchPrev} aria-label={labels.branchPrev}><span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" /></UserMessagePrimitive.Action>
													<span className="min-w-[2.5rem] text-center tabular-nums" title={labels.branchPosition}>{history.branchIndex + 1}/{history.branchTotal}</span>
													<UserMessagePrimitive.Action onClick={history.onNext} disabled={history.branchIndex >= history.branchTotal - 1} title={labels.branchNext} aria-label={labels.branchNext}><span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5" /></UserMessagePrimitive.Action>
												</span>
											</div>
										) : null}
									</div>
								</MessageLayout.Footer>
							) : null}
						</MessageLayout.OutgoingContent>
					</UserMessagePrimitive.Frame>
				</MessageLayout.Outgoing>
			</Message.Root>
			{contextMenu.model ? createPortal(<UserMessageContextMenuView {...contextMenu.model} />, document.body) : null}
		</>
	);
});
