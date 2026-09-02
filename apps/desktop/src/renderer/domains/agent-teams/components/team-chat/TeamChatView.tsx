import { ConversationEditorView } from "@shared/components/conversation-editor/ConversationEditorView";
import {
	ConversationComposerToolbarView,
	ConversationComposerView,
	InputBarPlaceholder,
	SendButton,
} from "@vetta/theme-ui/chat";
import { Button } from "@vetta/ui";
import { useCallback, useState } from "react";
import { TeamComposer } from "./TeamComposer";
import { TeamMessageFeed } from "./TeamMessageFeed";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";

export interface TeamChatViewProps {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
}

export function TeamChatView({ model, actions }: TeamChatViewProps): JSX.Element {
	const isActive = ["sending", "streaming", "cancelling"].includes(model.status);
	const [focused, setFocused] = useState(false);
	const handleEnter = useCallback(() => {
		if (!model.canSend) return false;
		void actions.send();
		return true;
	}, [actions, model.canSend]);

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 bg-background">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<TeamMessageFeed
					status={model.status}
					items={model.timelineItems}
					members={model.members}
					markdown={model.markdown}
					{...(model.error ? { error: model.error } : {})}
					labels={model.labels}
				/>
				<div className="relative px-2 pb-3 pt-1 sm:px-4 sm:pb-4">
					<div className="relative mx-auto w-full max-w-2xl">
						{model.error ? (
							<div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
								{model.error}
							</div>
						) : null}
						<ConversationComposerView
							focused={focused}
							{...(model.editorEnabled ? {} : { className: "opacity-55" })}
							regions={{
								routing: (
									<TeamComposer
										members={model.members}
										leaderRouteLabel={model.labels.leaderRoute}
										onSelectLeader={actions.selectLeader}
										onToggleMember={actions.toggleMember}
									/>
								),
								attachments:
									model.attachments.length > 0 ? (
										<div className="flex flex-wrap gap-1.5 px-3 pt-3">
											{model.attachments.map((attachment) => (
												<span
													key={attachment.path}
													className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
												>
													<span
														className={
															attachment.kind === "image"
																? "icon-[solar--gallery-linear] h-3.5 w-3.5"
																: "icon-[solar--paperclip-linear] h-3.5 w-3.5"
														}
														aria-hidden="true"
													/>
													<span className="truncate">{attachment.name}</span>
													<Button
														variant="ghost"
														size="icon-xs"
														onClick={() => actions.removeAttachment(attachment.path)}
													>
														<span className="icon-[solar--close-circle-linear] h-3 w-3" aria-hidden="true" />
														<span className="sr-only">{model.labels.removeAttachment(attachment.name)}</span>
													</Button>
												</span>
											))}
										</div>
									) : undefined,
								editor: (
									<div className="px-4 pb-1 pt-3">
										<div className="relative">
											<ConversationEditorView
												namespace="team-chat"
												value={model.draft}
												onValueChange={actions.setDraft}
												history={model.history}
												ariaLabel={model.labels.placeholder}
												editable={model.editorEnabled}
												onEnter={handleEnter}
												onFocusChange={setFocused}
											/>
											<InputBarPlaceholder
												texts={[model.labels.placeholder]}
												visible={model.draft.length === 0}
												rotating={false}
											/>
										</div>
									</div>
								),
								toolbar: (
									<ConversationComposerToolbarView
										left={
											<>
												<Button
													variant="ghost"
													size="icon-xs"
													onClick={() => void actions.selectImages()}
												>
													<span
														className="icon-[solar--gallery-linear] h-4 w-4"
														aria-hidden="true"
													/>
													<span className="sr-only">{model.labels.attachImage}</span>
												</Button>
												<Button
													variant="ghost"
													size="icon-xs"
													onClick={() => void actions.selectFiles()}
												>
													<span
														className="icon-[solar--paperclip-linear] h-4 w-4"
														aria-hidden="true"
													/>
													<span className="sr-only">{model.labels.attachFile}</span>
												</Button>
												<span className="min-w-0 truncate px-1 text-[11px] text-muted-foreground">
													{model.labels.hint}
												</span>
											</>
										}
										right={
											<SendButton
												canSend={model.canSend}
												isStreaming={isActive}
												pending={
													model.status === "cancelling" ? { label: model.labels.stop } : undefined
												}
												labels={{
													sendMessage: model.labels.send,
													stopGenerating: model.labels.stop,
												}}
												onSend={() => void actions.send()}
												onAbort={actions.abort}
											/>
										}
									/>
								),
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
