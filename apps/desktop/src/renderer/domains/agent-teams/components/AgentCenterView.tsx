import type { AgentProfile } from "@vetta/agent-team";
import { Button } from "@vetta/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AgentCenterModel } from "../hooks/useAgentCenterModel";
import { AgentCard } from "./AgentCard";
import { AgentCenterHero } from "./agent-center/AgentCenterHero";
import { TeamAssemblyBar } from "./agent-center/TeamAssemblyBar";
import { TeamCard } from "./agent-center/TeamCard";

const COLLAPSED_TEAM_COUNT = 4;

export interface AgentCenterViewProps {
	readonly model: AgentCenterModel;
	readonly onOpenTeamChat: (teamId: string) => void;
	readonly onOpenTeamSettings: (teamId: string) => void;
	readonly onSubmitAssembly: () => void;
	readonly onDeleteTeam: () => void;
	/** 打开某个智能体的档案抽屉。 */
	readonly onOpenAgent: (agentId: string) => void;
	readonly onCreateAgent: () => void;
}

export function AgentCenterView({
	model,
	onOpenTeamChat,
	onOpenTeamSettings,
	onSubmitAssembly,
	onDeleteTeam,
	onOpenAgent,
	onCreateAgent,
}: AgentCenterViewProps): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const { actions } = model;

	const assemblyMembers = useMemo(
		() => resolveAgents(model.assembly?.memberIds ?? [], model.agentsById),
		[model.agentsById, model.assembly?.memberIds],
	);
	const visibleTeams = model.teamsExpanded ? model.teams : model.teams.slice(0, COLLAPSED_TEAM_COUNT);
	const hiddenTeamCount = model.teams.length - COLLAPSED_TEAM_COUNT;

	return (
		<div className="@container relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<AgentCenterHero
					assembling={Boolean(model.assembly)}
					assembledCount={model.assembly?.memberIds.length ?? 0}
					assemblySubmittable={model.assemblySubmittable}
					teamSelected={Boolean(model.selectedTeam)}
					onCreateTeam={actions.startCreateTeam}
					onRecruit={() => model.selectedTeam && actions.startEditTeam(model.selectedTeam)}
					onSubmitAssembly={onSubmitAssembly}
					onCancelAssembly={actions.cancelAssembly}
					onClearSelection={() => actions.selectTeam(undefined)}
					onOpenTeamSettings={() => model.selectedTeam && onOpenTeamSettings(model.selectedTeam.id)}
				onDeleteTeam={onDeleteTeam}
			/>

			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-8 @md:px-8 [scrollbar-gutter:stable]">
					{model.error && (
						<div aria-live="polite" className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
							{model.error}
						</div>
					)}

					{model.assembly && (
						<TeamAssemblyBar
							draft={model.assembly}
							members={assemblyMembers}
							leaderId={model.assemblyLeaderId}
							onRename={actions.renameAssembly}
							onPromoteLeader={actions.promoteAssemblyLeader}
							onRemoveMember={actions.recruitAgent}
						/>
					)}

					<section className="mb-9 flex flex-col gap-3.5">
						<div className="flex items-center justify-between gap-3">
							<div className="flex min-w-0 items-baseline gap-3">
								<h2 className="text-[15px] font-semibold tracking-tight text-foreground">
									{t("center.teamsSection")}
								</h2>
								<span className="truncate text-[12px] text-muted-foreground">{t("center.teamsHint")}</span>
							</div>
							{model.teams.length > COLLAPSED_TEAM_COUNT && (
								<Button
									variant="ghost"
									size="sm"
									className="h-7 shrink-0 gap-1 text-[12px] text-muted-foreground"
									onClick={() => actions.setTeamsExpanded(!model.teamsExpanded)}
								>
									<span>
										{model.teamsExpanded
											? t("center.collapseTeams")
											: t("center.expandTeams", { count: hiddenTeamCount })}
									</span>
									<span
										className={`icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 transition-transform duration-200 ${
											model.teamsExpanded ? "rotate-180" : ""
										}`}
										aria-hidden="true"
									/>
								</Button>
							)}
						</div>

						{model.teams.length === 0 ? (
							<p className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center text-[12px] text-muted-foreground">
								{t("center.teamsEmpty")}
							</p>
						) : (
							<div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
								{visibleTeams.map((team) => {
									const members = resolveAgents(
										team.members.map((member) => member.binding.agentProfileId),
										model.agentsById,
									);
									const leader = team.members.find((member) => member.id === team.leaderMemberId);
									return (
										<TeamCard
											key={team.id}
											team={team}
											members={members}
											leaderId={leader?.binding.agentProfileId}
											selected={model.selectedTeam?.id === team.id}
											onSelect={() => actions.selectTeam(model.selectedTeam?.id === team.id ? undefined : team.id)}
											onOpenChat={() => onOpenTeamChat(team.id)}
										/>
									);
								})}
							</div>
						)}
					</section>

					<section className="flex flex-col gap-3.5">
						<div className="flex items-center justify-between gap-3">
							<div className="flex min-w-0 items-baseline gap-3">
								<h2 className="text-[15px] font-semibold tracking-tight text-foreground">
									{t("center.agentsSection")}
								</h2>
								<span className="truncate text-[12px] text-muted-foreground">
									{t("center.agentsHint", { count: model.agents.length })}
								</span>
							</div>
							<Button
								variant="outline"
								size="sm"
								className="h-7 shrink-0 gap-1.5 text-[12px]"
								onClick={onCreateAgent}
							>
								<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" aria-hidden="true" />
								{t("center.createAgent")}
							</Button>
						</div>

						{model.agents.length === 0 ? (
							<p className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center text-[12px] text-muted-foreground">
								{t("library.empty")}
							</p>
						) : (
							<div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
								{model.agents.map((agent) => (
									<AgentCard
										key={agent.id}
										agent={agent}
										blueprint={model.blueprints.find((candidate) => candidate.id === agent.blueprintId)}
										selected={Boolean(model.assembly?.memberIds.includes(agent.id))}
										marker={
											model.assembly
												? model.assembly.memberIds.includes(agent.id)
													? "recruited"
													: "recruit"
												: undefined
										}
										onActivate={() =>
											model.assembly ? actions.recruitAgent(agent) : onOpenAgent(agent.id)
										}
									/>
								))}
							</div>
						)}
					</section>
			</div>

		</div>
	);
}

function resolveAgents(ids: readonly string[], agentsById: ReadonlyMap<string, AgentProfile>): readonly AgentProfile[] {
	return ids.map((id) => agentsById.get(id)).filter((agent): agent is AgentProfile => Boolean(agent));
}
