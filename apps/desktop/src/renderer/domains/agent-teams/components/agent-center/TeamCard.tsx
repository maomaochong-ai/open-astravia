import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { Button } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { AgentAvatarStack } from "./AgentAvatarStack";

export interface TeamCardProps {
	readonly team: TeamDefinition;
	readonly members: readonly AgentProfile[];
	readonly leaderId?: string;
	readonly selected: boolean;
	readonly onSelect: () => void;
	readonly onOpenChat: () => void;
}

export function TeamCard({ team, members, leaderId, selected, onSelect, onOpenChat }: TeamCardProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const summary = members
		.map((member) => member.name)
		.filter(Boolean)
		.join(" · ");

	return (
		<div
			className={[
				"group relative flex flex-col justify-between rounded-xl border p-4 transition-colors duration-200",
				selected
					? "border-primary/40 bg-card/70 ring-1 ring-inset ring-primary/30"
					: "border-border/50 bg-card/40 hover:border-primary/40 hover:bg-card/60",
			].join(" ")}
		>
			<button type="button" onClick={onSelect} className="flex flex-col text-left outline-none">
				<span className="flex items-center justify-between gap-2">
					<AgentAvatarStack agents={members} leaderId={leaderId} />
					<span className="shrink-0 text-[11px] text-muted-foreground/70">
						{t("center.expertCount", { count: members.length })}
					</span>
				</span>
				<span className="mt-3.5 truncate text-[13px] font-medium tracking-tight text-foreground">{team.name}</span>
				<span className="mt-1 line-clamp-1 text-[12px] text-muted-foreground/80">
					{team.description || summary}
				</span>
			</button>

			<div className="mt-4 flex items-center justify-between pt-2">
				<span className="text-[11px] text-muted-foreground/60">
					{selected ? t("center.teamSelected") : t("center.teamSelectHint")}
				</span>
				<Button
					variant="ghost"
					size="icon-xs"
					className="h-6 w-6 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
					title={t("center.openTeamChat")}
					onClick={onOpenChat}
				>
					<span className="icon-[solar--arrow-right-up-linear] h-3.5 w-3.5" aria-hidden="true" />
					<span className="sr-only">{t("center.openTeamChat")}</span>
				</Button>
			</div>
		</div>
	);
}
