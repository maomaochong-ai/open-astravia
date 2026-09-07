import { teamDisplayName } from "@shared/agent-teams/agent-team-presentation";
import { confirmDialogAtom, pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyAgentTeamConfigurationChanged } from "../../project/components/sidebar/projects/panel/AgentTeamSidebarList";
import { useAgentCenterModel } from "../hooks/useAgentCenterModel";
import { AgentCenterView } from "./AgentCenterView";
import { AgentProfileSheet } from "./AgentProfileSheet";
import { TeamSettingsSheet } from "./TeamSettingsSheet";

/**
 * 侧栏「智能体」入口页：团队编队与智能体库的统一管理入口。
 * 两个抽屉都由 `?agent=` / `?team=` 驱动，Esc 与返回键就是关闭。
 */
export function AgentCenterPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const confirm = useSetAtom(confirmDialogAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const navigate = useNavigate();
	const { agent: agentParam, team: teamParam } = useSearch({ strict: false }) as {
		agent?: string;
		team?: string;
	};
	const model = useAgentCenterModel({
		defaultName: t("library.defaultAgentName"),
		defaultDescription: t("library.defaultAgentDescription"),
	});

	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	const openAgent = useCallback(
		(agentId: string) => void navigate({ to: "/agents", search: { agent: agentId }, replace: true }),
		[navigate],
	);
	const closeSheets = useCallback(
		() => void navigate({ to: "/agents", search: {}, replace: true }),
		[navigate],
	);

	// 关闭动画期间保留抽屉内容，Vaul 报告退出动画结束后才卸载。
	const [agentMounted, setAgentMounted] = useState(agentParam !== undefined);
	const [teamMounted, setTeamMounted] = useState(teamParam !== undefined);
	useEffect(() => {
		if (agentParam !== undefined) setAgentMounted(true);
	}, [agentParam]);
	useEffect(() => {
		if (teamParam !== undefined) setTeamMounted(true);
	}, [teamParam]);

	const sheetAgent = agentParam && agentParam !== "new" ? model.findAgent(agentParam) : undefined;
	const sheetTeam = teamParam ? model.findTeam(teamParam) : undefined;

	function requestDeleteTeam(team = sheetTeam ?? model.selectedTeam): void {
		if (!team) return;
		confirm({
			title: t("settings.deleteTeamTitle"),
			message: t("settings.deleteTeamMessage", { name: teamDisplayName(team, t) }),
			confirmLabel: t("settings.deleteTeam"),
			variant: "danger",
			onConfirm: () => {
				void model.actions.deleteTeam(team).then((deleted) => {
					if (!deleted) return;
					model.actions.selectTeam(undefined);
					closeSheets();
					notifyAgentTeamConfigurationChanged();
				});
			},
		});
	}

	async function requestDeleteAgent(): Promise<void> {
		if (!sheetAgent) return;
		const impact = await model.actions.previewAgentDelete(sheetAgent.id);
		if (!impact) return;
		const impactLabels = impact.teams.map((team) => {
			const definition = model.document?.teams.find((candidate) => candidate.id === team.teamId);
			const name = definition ? teamDisplayName(definition, t) : team.teamName;
			if (team.deletesTeam) return t("library.deleteImpactDeleteTeam", { team: name });
			if (team.nextLeaderName) {
				return t("library.deleteImpactTransfer", { team: name, name: team.nextLeaderName });
			}
			return t("library.deleteImpactTeam", { team: name });
		});
		confirm({
			title: impact.teams.length ? t("library.deleteCascadeTitle") : t("library.deleteTitle"),
			message: impact.teams.length
				? t("library.deleteCascadeMessage", { name: sheetAgent.name, teams: impactLabels.join("、") })
				: t("library.deleteMessage", { name: sheetAgent.name }),
			confirmLabel: t("library.delete"),
			variant: "danger",
			onConfirm: () => {
				void model.actions.deleteAgent(sheetAgent, impact).then((deleted) => {
					if (!deleted) return;
					closeSheets();
					notifyAgentTeamConfigurationChanged();
				});
			},
		});
	}

	if (model.loading) {
		return <div className="p-8 text-[13px] text-muted-foreground">{t("loading")}</div>;
	}

	if (model.error && !model.document) {
		return <div className="p-8 text-[13px] text-destructive">{t("error.load", { error: model.error })}</div>;
	}

	return (
		<>
			<AgentCenterView
				model={model}
				onOpenTeamChat={(teamId) => void navigate({ to: "/agent-teams/$teamId", params: { teamId } })}
				onOpenTeamSettings={(teamId) => void navigate({ to: "/agents", search: { team: teamId }, replace: true })}
				onSubmitAssembly={() => {
					void model.actions.submitAssembly().then((saved) => {
						if (saved) notifyAgentTeamConfigurationChanged();
					});
				}}
				onDeleteTeam={() => requestDeleteTeam()}
				onOpenAgent={openAgent}
				onCreateAgent={() => void navigate({ to: "/agents", search: { agent: "new" }, replace: true })}
			/>

			{(agentMounted || agentParam !== undefined) && (
				<AgentProfileSheet
					open={agentParam !== undefined}
					mode={agentParam === "new" ? "create" : "edit"}
					agent={sheetAgent}
					blueprints={model.blueprints}
					capabilities={model.capabilities}
					onClose={closeSheets}
					onExited={() => {
						if (agentParam === undefined) setAgentMounted(false);
					}}
					onSaved={notifyAgentTeamConfigurationChanged}
					onPreview={model.actions.previewAgent}
					onSave={model.actions.saveAgent}
					onCreate={model.actions.createAgentFromDraft}
					onDelete={() => void requestDeleteAgent()}
				/>
			)}

			{(teamMounted || teamParam !== undefined) && sheetTeam && (
				<TeamSettingsSheet
					open={teamParam !== undefined}
					team={sheetTeam}
					agents={model.agents}
					agentsById={model.agentsById}
					onClose={closeSheets}
					onExited={() => {
						if (teamParam === undefined) setTeamMounted(false);
					}}
					onSave={async (draft) => {
						const saved = await model.actions.saveTeam(draft);
						if (saved) notifyAgentTeamConfigurationChanged();
						return saved;
					}}
					onDelete={() => requestDeleteTeam(sheetTeam)}
					onOpenMember={openAgent}
				/>
			)}
		</>
	);
}
