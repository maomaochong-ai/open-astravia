import {
	ConversationComposerView,
	SendButton,
} from "@vetta/theme-ui/chat";
import { type KeyboardEvent, useState } from "react";
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
	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		event.preventDefault();
		void actions.send();
	}

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
								editor: (
									<textarea
										value={model.draft}
										onChange={(event) => actions.setDraft(event.target.value)}
										onKeyDown={handleKeyDown}
										onFocus={() => setFocused(true)}
										onBlur={() => setFocused(false)}
										placeholder={model.labels.placeholder}
										aria-label={model.labels.placeholder}
										disabled={!model.editorEnabled}
										rows={2}
										className="max-h-40 min-h-14 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
									/>
								),
								toolbar: (
									<div className="flex min-h-10 items-center justify-between gap-3 px-3 pb-2">
										<span className="min-w-0 truncate text-[11px] text-muted-foreground">
											{model.labels.hint}
										</span>
										<SendButton
											canSend={model.canSend}
											isStreaming={isActive}
											pending={model.status === "cancelling" ? { label: model.labels.stop } : undefined}
											labels={{
												sendMessage: model.labels.send,
												stopGenerating: model.labels.stop,
											}}
											onSend={() => void actions.send()}
											onAbort={actions.abort}
										/>
									</div>
								),
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
