import type { AgentProfile, AgentTeamDocument, TeamDefinition } from "@vetta/agent-team";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface TeamComposerProps {
	readonly document?: AgentTeamDocument;
	readonly team?: TeamDefinition;
	readonly selectedMemberIds: readonly string[];
	readonly text: string;
	readonly onTextChange: (text: string) => void;
	readonly onSelectedMemberIdsChange: (memberIds: readonly string[]) => void;
}

/** Team-specific routing controls rendered inside the shared chat InputBar card. */
export function TeamComposer({
	document,
	team,
	selectedMemberIds,
	text,
	onTextChange,
	onSelectedMemberIdsChange,
}: TeamComposerProps): JSX.Element | null {
	const { t } = useTranslation("agent-teams");
	if (!team) return null;

	function mention(memberId: string, handle: string): void {
		onSelectedMemberIdsChange(
			selectedMemberIds.includes(memberId)
				? selectedMemberIds.filter((id) => id !== memberId)
				: [...selectedMemberIds, memberId],
		);
		if (!text.includes(`@${handle}`)) {
			onTextChange(`${text}${text && !text.endsWith(" ") ? " " : ""}@${handle} `);
		}
	}

	return (
		<div className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/50 px-3 py-2 no-scrollbar">
			<RoutingButton
				selected={selectedMemberIds.length === 0}
				onClick={() => onSelectedMemberIdsChange([])}
			>
				<span className="icon-[solar--crown-star-linear] h-3.5 w-3.5" aria-hidden="true" />
				{t("chat.leaderRoute")}
			</RoutingButton>
			{team.members.map((member) => {
				const profile = document?.agents.find(
					(agent) => agent.id === member.binding.agentProfileId,
				);
				return (
					<RoutingButton
						key={member.id}
						selected={selectedMemberIds.includes(member.id)}
						onClick={() => mention(member.id, member.handle)}
					>
						<ProfileAvatar profile={profile} />
						@{member.handle}
					</RoutingButton>
				);
			})}
		</div>
	);
}

function RoutingButton({
	selected,
	onClick,
	children,
}: {
	readonly selected: boolean;
	readonly onClick: () => void;
	readonly children: ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-pressed={selected}
			className={[
				"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary/30",
				selected
					? "bg-primary/15 text-primary"
					: "bg-muted/55 text-muted-foreground hover:bg-muted hover:text-foreground",
			].join(" ")}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function ProfileAvatar({ profile }: { readonly profile?: AgentProfile }): JSX.Element {
	if (profile?.avatar) {
		return <img src={profile.avatar} alt="" className="h-4 w-4 rounded-full object-cover" />;
	}
	return (
		<span
			className={`${blueprintIcon(profile?.blueprintId ?? "leader")} h-3.5 w-3.5`}
			aria-hidden="true"
		/>
	);
}

function blueprintIcon(blueprintId: string): string {
	if (blueprintId === "researcher") return "icon-[solar--magnifer-linear]";
	if (blueprintId === "builder") return "icon-[solar--code-square-linear]";
	if (blueprintId === "reviewer") return "icon-[solar--shield-check-linear]";
	return "icon-[solar--crown-star-linear]";
}
