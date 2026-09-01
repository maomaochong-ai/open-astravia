import { isBuiltinAgentPreset, type AgentProfile } from "@vetta/agent-team";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@vetta/ui";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentProfileEditInput } from "../hooks/useAgentLibraryModel";
import { useAgentTeamSidebarSelection } from "../hooks/useAgentTeamSidebarSelection";
import {
	agentDisplayDescription,
	agentDisplayName,
	teamDisplayName,
} from "../lib/preset-presentation";
import type { AgentTeamConfigurationResources } from "../services/load-agent-team-resources";
import { loadAgentTeamConfigurationResources } from "../services/load-agent-team-resources";
import { AgentProfileEditor } from "./AgentProfileEditor";
import { notifyAgentTeamConfigurationChanged } from "../../project/components/sidebar/projects/panel/AgentTeamSidebarList";

export function TeamSettingsPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	useAgentTeamSidebarSelection();
	const { teamId } = useParams({ from: "/agent-teams/$teamId/settings" });
	const navigate = useNavigate();
	const [resources, setResources] = useState<AgentTeamConfigurationResources>();
	const [selectedMemberId, setSelectedMemberId] = useState<string>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		void loadAgentTeamConfigurationResources()
			.then((next) => {
				if (cancelled) return;
				const team = next.document.teams.find((candidate) => candidate.id === teamId);
				if (!team) throw new Error(`Agent team not found: ${teamId}`);
				setResources(next);
				setSelectedMemberId(team.leaderMemberId);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(errorMessage(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [teamId]);

	const team = resources?.document.teams.find((candidate) => candidate.id === teamId);
	const members = useMemo(
		() =>
			team?.members.map((member) => ({
				member,
				profile: resources?.document.agents.find((agent) => agent.id === member.binding.agentProfileId),
			})) ?? [],
		[resources, team],
	);
	const selected = members.find(({ member }) => member.id === selectedMemberId);
	const blueprint = resources?.blueprints.find((candidate) => candidate.id === selected?.profile?.blueprintId);

	async function saveAgent(agent: AgentProfile, input: AgentProfileEditInput) {
		const updated = await window.vetta.agentTeams.updateAgent(agent.id, {
			expectedRevision: agent.revision,
			name: input.name,
			description: input.description,
			mentionHandle: input.mentionHandle,
			abilities: input.abilities,
		});
		setResources((current) =>
			current
				? {
						...current,
						document: {
							...current.document,
							agents: current.document.agents.map((candidate) =>
								candidate.id === updated.id ? updated : candidate,
							),
						},
					}
				: current,
		);
		notifyAgentTeamConfigurationChanged();
		return {
			updated,
			impact: await window.vetta.agentTeams.previewAgentUpdate(agent.id),
		};
	}

	if (error && !resources) {
		return <div className="m-8 text-sm text-destructive">{t("error.load", { error })}</div>;
	}

	if (!resources || !team) {
		return <div className="p-8 text-sm text-muted-foreground">{t("loading")}</div>;
	}

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<header className="flex shrink-0 items-start justify-between border-b border-border/60 px-8 py-6">
				<div>
					<div className="text-xs font-medium text-muted-foreground">{t("settings.eyebrow")}</div>
					<h1 className="mt-1 text-2xl font-bold">{teamDisplayName(team, t)}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{t("settings.subtitle")}</p>
				</div>
				<Button
					variant="ghost"
					onClick={() =>
						void navigate({
							to: "/agent-teams/$teamId",
							params: { teamId },
						})
					}
				>
					{t("settings.backToChat")}
				</Button>
			</header>

			<div className="flex min-h-0 flex-1">
				<aside className="w-72 shrink-0 overflow-y-auto border-r border-border/60 p-3">
					<div className="px-3 pb-2 text-xs font-medium text-muted-foreground">{t("settings.roster")}</div>
					<div className="space-y-1">
						{members.map(({ member, profile }) => (
							<button
								key={member.id}
								type="button"
								onClick={() => setSelectedMemberId(member.id)}
								className={`w-full rounded-lg px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 ${
									selectedMemberId === member.id
										? "bg-primary/10 text-foreground"
										: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
								}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-sm font-medium">
										{profile ? agentDisplayName(profile, t) : member.handle}
									</span>
									{member.id === team.leaderMemberId && (
										<span className="text-[10px] font-medium text-primary">{t("settings.leader")}</span>
									)}
								</div>
								<div className="mt-1 flex items-center gap-2 text-[11px]">
									<span>@{member.handle}</span>
									<span>·</span>
									<span>
										{member.binding.kind === "reference"
											? t("settings.reference")
											: t("settings.copy")}
									</span>
								</div>
							</button>
						))}
					</div>
				</aside>

				<main className="min-w-0 flex-1 overflow-y-auto p-8">
					{selected?.profile ? (
						<>
							<div className="mx-auto mb-5 max-w-3xl rounded-lg border border-border/70 px-3 py-2 text-xs text-muted-foreground">
								{selected.member.binding.kind === "reference"
									? t("settings.referenceHint")
									: t("settings.copyHint")}
							</div>
							<AgentProfileEditor
								agent={selected.profile}
								displayName={agentDisplayName(selected.profile, t)}
								displayDescription={agentDisplayDescription(selected.profile, t)}
								identityReadOnly={isBuiltinAgentPreset(selected.profile)}
								lockedMentionHandle={selected.member.handle}
								blueprint={blueprint}
								capabilities={resources.capabilities}
								onPreview={(agentId) => window.vetta.agentTeams.previewAgentUpdate(agentId)}
								onSave={saveAgent}
							/>
						</>
					) : (
						<div className="text-sm text-destructive">{t("settings.profileMissing")}</div>
					)}
				</main>
			</div>
		</div>
	);
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
