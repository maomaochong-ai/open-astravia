import { SendButton } from "@domains/chat/components/SendButton";
import type { TeamDefinition } from "@vetta/agent-team";
import { useTranslation } from "react-i18next";

export interface TeamComposerProps {
	readonly team?: TeamDefinition;
	readonly text: string;
	readonly selectedMemberIds: readonly string[];
	readonly sending: boolean;
	readonly disabled: boolean;
	readonly error?: string;
	readonly onTextChange: (text: string) => void;
	readonly onSelectedMemberIdsChange: (memberIds: readonly string[]) => void;
	readonly onSend: () => void;
}

export function TeamComposer(props: TeamComposerProps): JSX.Element {
	const { t } = useTranslation("agent-teams");

	function mention(memberId: string, handle: string): void {
		props.onSelectedMemberIdsChange(
			props.selectedMemberIds.includes(memberId)
				? props.selectedMemberIds.filter((id) => id !== memberId)
				: [...props.selectedMemberIds, memberId],
		);
		if (!props.text.includes(`@${handle}`)) {
			props.onTextChange(
				`${props.text}${props.text && !props.text.endsWith(" ") ? " " : ""}@${handle} `,
			);
		}
	}

	return (
		<div className="relative shrink-0 px-2 pb-3 pt-1 sm:px-4 sm:pb-4">
			<div className="relative mx-auto w-full max-w-2xl">
				<div className="input-card overflow-hidden rounded-[20px] border border-border bg-input-bar-bg shadow-[0_8px_28px_-14px_rgb(0_0_0/0.10)] transition-shadow focus-within:border-primary/30 focus-within:ring-2 focus-within:ring-primary/20 dark:shadow-none">
					{props.team && (
						<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 px-3 py-2 no-scrollbar">
							<button
								type="button"
								className={mentionClass(props.selectedMemberIds.length === 0)}
								onClick={() => props.onSelectedMemberIdsChange([])}
							>
								<span
									className="icon-[solar--crown-star-linear] h-3.5 w-3.5"
									aria-hidden="true"
								/>
								{t("chat.leaderRoute")}
							</button>
							{props.team.members.map((member) => (
								<button
									key={member.id}
									type="button"
									className={mentionClass(props.selectedMemberIds.includes(member.id))}
									onClick={() => mention(member.id, member.handle)}
								>
									@{member.handle}
								</button>
							))}
						</div>
					)}
					<label className="block px-4 pb-1 pt-3">
						<span className="sr-only">{t("chat.placeholder")}</span>
						<textarea
							name="agent-team-message"
							autoComplete="off"
							value={props.text}
							disabled={props.disabled || props.sending}
							rows={2}
							placeholder={t("chat.placeholder")}
							onChange={(event) => props.onTextChange(event.target.value)}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.nativeEvent.isComposing
								) {
									event.preventDefault();
									props.onSend();
								}
							}}
							className="max-h-40 min-h-12 w-full resize-none bg-transparent text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed"
						/>
					</label>
					<div className="flex items-center justify-between gap-3 px-3 pb-3">
						<p className="min-w-0 truncate text-[11px] text-muted-foreground/55">
							{t("chat.hint")}
						</p>
						<SendButton
							canSend={!props.disabled && !props.sending && props.text.trim().length > 0}
							isStreaming={false}
							pending={props.sending ? { label: t("chat.sending") } : undefined}
							onSend={props.onSend}
							onAbort={() => undefined}
						/>
					</div>
				</div>
				<div
					aria-live="polite"
					className="min-h-5 px-3 pt-1 text-xs text-destructive"
				>
					{props.error ?? ""}
				</div>
			</div>
		</div>
	);
}

function mentionClass(selected: boolean): string {
	return [
		"inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30",
		selected
			? "bg-primary/15 text-primary"
			: "bg-muted/55 text-muted-foreground hover:bg-muted hover:text-foreground",
	].join(" ");
}
