import { confirmDialogAtom, pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { Button } from "@vetta/ui";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { notifyAgentTeamConfigurationChanged } from "../../project/components/sidebar/projects/panel/AgentTeamSidebarList";
import { useAgentLibraryModel } from "../hooks/useAgentLibraryModel";
import {
	agentDisplayDescription,
	agentDisplayName,
	teamDisplayName,
} from "@shared/agent-teams/agent-team-presentation";
import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import { AgentProfileEditor } from "./AgentProfileEditor";

export function AgentLibraryPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const confirm = useSetAtom(confirmDialogAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const model = useAgentLibraryModel({
		defaultName: t("library.defaultAgentName"),
		defaultDescription: t("library.defaultAgentDescription"),
	});
	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	async function requestDelete(): Promise<void> {
		if (!model.selected) return;
		const selected = model.selected;
		const impact = await model.actions.previewAgentDelete(selected.id);
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
				? t("library.deleteCascadeMessage", {
						name: agentDisplayName(selected, t),
						teams: impactLabels.join("、"),
					})
				: t("library.deleteMessage", { name: agentDisplayName(selected, t) }),
			confirmLabel: t("library.delete"),
			variant: "danger",
			onConfirm: () => {
				void model.actions.deleteAgent(selected, impact).then((deleted) => {
					if (deleted) notifyAgentTeamConfigurationChanged();
				});
			},
		});
	}

	if (model.loading) {
		return <div className="p-8 text-sm text-muted-foreground">{t("loading")}</div>;
	}

	if (model.error && !model.document) {
		return <div className="p-8 text-sm text-destructive">{t("error.load", { error: model.error })}</div>;
	}

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{/* Top Header */}
			<header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-card/25 backdrop-blur-md px-5">
				{/* Left Title Area */}
				<div className="flex min-w-0 items-center gap-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
						<span className="icon-[solar--user-id-linear] h-4 w-4" aria-hidden="true" />
					</div>
					<h1 className="text-base font-bold tracking-tight text-foreground">{t("library.title")}</h1>
					<span className="hidden items-center rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex">
						{t("teams.memberCount", { count: model.libraryAgents.length })}
					</span>
					<span className="hidden text-xs text-muted-foreground/60 lg:inline-block border-l border-border/40 pl-3 ml-1 truncate max-w-sm">
						{t("library.subtitle")}
					</span>
				</div>

				{/* Right Actions */}
				<div className="flex items-center gap-2">
					{model.selected && (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
							onClick={() => void requestDelete()}
						>
							<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" aria-hidden="true" />
							<span>{t("library.delete")}</span>
						</Button>
					)}
					<Button
						variant="primary"
						size="sm"
						className="h-8 gap-1.5 rounded-lg px-3.5 text-xs font-medium"
						onClick={() => void model.actions.createAgent()}
					>
						<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" aria-hidden="true" />
						<span>{t("library.add")}</span>
					</Button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1">
				<aside className="flex w-72 shrink-0 flex-col border-r border-border/50 bg-card/15 backdrop-blur-sm p-3">
					<div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/70">
						<span>{t("library.title")}</span>
						<span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.2 text-[10px] font-semibold text-primary">
							{model.libraryAgents.length}
						</span>
					</div>

					<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pt-1">
						{model.libraryAgents.length ? (
							model.libraryAgents.map((agent) => {
								const blueprint = model.blueprints.find((candidate) => candidate.id === agent.blueprintId);
								const displayName = agentDisplayName(agent, t);
								const isSelected = model.selectedId === agent.id;
								return (
									<button
										key={agent.id}
										type="button"
										onClick={() => model.actions.selectAgent(agent.id)}
										className={[
											"group relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left outline-none transition-all duration-150",
											isSelected
												? "border border-primary/40 bg-card text-foreground"
												: "border border-border/40 bg-card/25 text-muted-foreground hover:border-border/80 hover:bg-card/60 hover:text-foreground",
										].join(" ")}
									>
										{isSelected && (
											<div className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r bg-primary" aria-hidden="true" />
										)}
										<AgentAvatarView
											name={displayName}
											avatar={agentAvatarUrl(agent)}
											blueprintId={agent.blueprintId}
											size="md"
										/>
										<div className="min-w-0 flex-1">
											<div className={`truncate text-sm ${isSelected ? "font-semibold text-foreground" : "font-medium"}`}>
												{displayName}
											</div>
											<div className="mt-0.5 truncate text-xs text-muted-foreground/75">
												{blueprint ? t(blueprint.nameKey as never) : agent.blueprintId}
											</div>
										</div>
									</button>
								);
							})
						) : (
							<p className="px-2 py-8 text-center text-xs text-muted-foreground">{t("library.empty")}</p>
						)}
					</div>

					<div className="pt-2 border-t border-border/30">
						<button
							type="button"
							onClick={() => void model.actions.createAgent()}
							className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 py-2 text-xs text-muted-foreground/80 transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary outline-none"
						>
							<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" aria-hidden="true" />
							<span>{t("library.add")}</span>
						</button>
					</div>
				</aside>

				<main className="min-w-0 flex-1 overflow-y-auto p-8">
					{model.error && (
						<div aria-live="polite" className="mx-auto mb-4 max-w-3xl text-xs text-destructive">
							{model.error}
						</div>
					)}
					{model.selected ? (
						<AgentProfileEditor
							agent={model.selected}
							displayName={agentDisplayName(model.selected, t)}
							displayDescription={agentDisplayDescription(model.selected, t)}
							blueprint={model.blueprint}
							capabilities={model.capabilities}
							layout="tabs"
							onPreview={model.actions.previewAgent}
							onSave={model.actions.saveAgent}
						/>
					) : (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							{t("library.selectHint")}
						</div>
					)}
				</main>
			</div>
		</div>
	);
}
