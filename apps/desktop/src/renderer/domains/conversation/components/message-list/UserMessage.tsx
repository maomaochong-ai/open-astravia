import type { ConversationParticipantViewModel, ConversationUserMessageViewModel } from "@shared/conversation";
import { toTokenPath } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import { filePreviewAtom } from "@shared/store/atoms";
import {
	Message,
	MessageLayout,
	MessageVisual,
	SettingsAssistBadgeView,
	UserMessage as UserMessagePrimitive,
} from "@vetta-org/theme-ui/chat";
import { useSetAtom } from "jotai";
import { memo, useMemo } from "react";
import type { MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSkillTokenMeta } from "../../hooks/useSkillTokenMeta";
import { AppshotCard } from "../AppshotCard";
import { TextBlockView } from "../blocks/TextBlock";
import { isSettingsAssistTabId, projectUserMessage, userMessagePreviewSource } from "./userMessageProjection";

export interface UserMessageProps {
	message: ConversationUserMessageViewModel;
	participants?: readonly ConversationParticipantViewModel[];
	pending?: boolean;
	children?: ReactNode;
	onContextMenu?: MouseEventHandler<HTMLDivElement>;
	onActionsVisibleChange?: (visible: boolean) => void;
}

/** Content recipe only. Commands and their UI are composed by the owning extension. */
export const UserMessage = memo(function UserMessage({
	message,
	participants = [],
	pending = false,
	children,
	onContextMenu,
	onActionsVisibleChange,
}: UserMessageProps) {
	const { t } = useTranslation("chat");
	const projection = useMemo(() => projectUserMessage(message), [message]);
	const resolveSkillMeta = useSkillTokenMeta();
	const membersById = useMemo(
		() => new Map(participants.map((participant) => [participant.id, participant])),
		[participants],
	);
	const inlineTokens = useMemo(
		() => ({
			annotations: projection.inlineTokenAnnotations,
			getImageLabel: (path: string) => {
				const index = projection.imageIndexByPath.get(toTokenPath(path));
				return index ? t("inputBar.capsule.imageBadge", { index }) : pathBasename(path);
			},
			getSkill: (name: string) => resolveSkillMeta("skill", name),
			getScene: (name: string) => resolveSkillMeta("scene", name),
			getMember: (participantId: string) => {
				const participant = membersById.get(participantId);
				return participant
					? {
							label: participant.name,
							...(participant.avatar ? { avatar: participant.avatar } : {}),
							...(participant.handle ? { meta: `@${participant.handle}` } : {}),
						}
					: undefined;
			},
		}),
		[membersById, projection.imageIndexByPath, projection.inlineTokenAnnotations, resolveSkillMeta, t],
	);
	const setFilePreview = useSetAtom(filePreviewAtom);
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
	const empty = !projection.displayText && !hasSettingsAssistBadge && !hasFileBadges && !hasImages && !hasAppshot;

	return (
		<>
			<Message.Root>
				<MessageLayout.Outgoing asChild>
					<UserMessagePrimitive.Frame
						entryState="static"
						onContextMenu={onContextMenu}
						onActionsVisibleChange={onActionsVisibleChange}
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
											<img
												src={userMessagePreviewSource(item)}
												alt={item.name}
												className="h-full w-full object-cover"
											/>
											<span className="pointer-events-none absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/10" />
											<span className="pointer-events-none absolute bottom-1 right-1 rounded bg-foreground/45 px-1 text-[9px] font-medium leading-[1.4] text-background/90">
												{t("inputBar.capsule.imageBadge", {
													index:
														(item.path
															? projection.imageIndexByPath.get(toTokenPath(item.path))
															: undefined) ?? index + 1,
												})}
											</span>
										</button>
									))}
								</div>
							) : null}
							{projection.appshot ? <AppshotCard data={projection.appshot} /> : null}
							{projection.displayText ? (
								<MessageVisual.OutgoingBubble
									className={`cursor-text ${pending ? "ring-1 ring-primary/40" : ""}`}
									style={{ wordBreak: "break-word" }}
								>
									<UserMessagePrimitive.Text
										contentKey={projection.displayText}
										entryState="static"
										expandLabel={t("messageList.userMessage.expand")}
									>
										<TextBlockView
											text={projection.displayText}
											inlineTokens={inlineTokens}
											className="max-w-full overflow-x-auto [overflow-wrap:anywhere] [&_code]:break-all"
										/>
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
								<div className="mt-1 flex flex-wrap justify-end gap-1">
									{projection.fileBadges.map((file) => {
										const name = pathBasename(file);
										return (
											<button
												key={file}
												type="button"
												className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
												title={file}
												onClick={() => setFilePreview({ name, path: file })}
											>
												<span className="icon-[solar--file-linear] h-3 w-3" />
												{name}
											</button>
										);
									})}
								</div>
							) : null}
							{children}
						</MessageLayout.OutgoingContent>
					</UserMessagePrimitive.Frame>
				</MessageLayout.Outgoing>
			</Message.Root>
		</>
	);
});
