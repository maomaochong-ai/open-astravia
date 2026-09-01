import { confirmDialogAtom } from "@shared/store/atoms";
import { isBuiltinAgentPreset } from "@vetta/agent-team";
import { Button } from "@vetta/ui";
import { useSetAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { notifyAgentTeamConfigurationChanged } from "../../project/components/sidebar/projects/panel/AgentTeamSidebarList";
import { useAgentLibraryModel } from "../hooks/useAgentLibraryModel";
import {
	agentDisplayDescription,
	agentDisplayName,
} from "../lib/preset-presentation";
import { AgentProfileEditor } from "./AgentProfileEditor";

export function AgentLibraryPage(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	const confirm = useSetAtom(confirmDialogAtom);
	const model = useAgentLibraryModel({
		defaultName: t("library.defaultAgentName"),
		defaultDescription: t("library.defaultAgentDescription"),
	});

	async function requestDelete(): Promise<void> {
		if (!model.selected || isBuiltinAgentPreset(model.selected)) return;
		const selected = model.selected;
		const impact = await model.actions.previewAgent(selected.id);
		if (impact.teamIds.length > 0) {
			confirm({
				title: t("library.deleteBlockedTitle"),
				message: t("library.deleteBlockedMessage", {
					count: impact.teamIds.length,
					teams: impact.teamNames.join("、"),
				}),
				confirmLabel: t("library.gotIt"),
				onConfirm: () => undefined,
			});
			return;
		}
		confirm({
			title: t("library.deleteTitle"),
			message: t("library.deleteMessage", { name: agentDisplayName(selected, t) }),
			confirmLabel: t("library.delete"),
			variant: "danger",
			onConfirm: () => {
				void model.actions.deleteAgent(selected).then((deleted) => {
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
			<header className="flex shrink-0 items-start justify-between border-b border-border/60 px-8 py-6">
				<div>
					<h1 className="text-2xl font-bold">{t("library.title")}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{t("library.subtitle")}</p>
				</div>
				<div className="flex items-center gap-2">
					{model.selected && !isBuiltinAgentPreset(model.selected) && (
						<Button variant="ghost" onClick={() => void requestDelete()}>
							<span className="icon-[solar--trash-bin-trash-linear] h-4 w-4" aria-hidden="true" />
							{t("library.delete")}
						</Button>
					)}
					<Button variant="primary" onClick={() => void model.actions.createAgent()}>
						<span className="icon-[solar--add-circle-linear] h-4 w-4" aria-hidden="true" />
						{t("library.add")}
					</Button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1">
				<aside className="w-64 shrink-0 overflow-y-auto border-r border-border/60 p-3">
					{model.libraryAgents.length ? (
						<div className="space-y-1">
							{model.libraryAgents.map((agent) => {
								const blueprint = model.blueprints.find((candidate) => candidate.id === agent.blueprintId);
								const displayName = agentDisplayName(agent, t);
								return (
									<button
										key={agent.id}
										type="button"
										onClick={() => model.actions.selectAgent(agent.id)}
										className={`w-full rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 ${
											model.selectedId === agent.id
												? "bg-primary/10 text-foreground"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
										}`}
									>
										<div className="truncate text-sm font-medium">{displayName}</div>
										<div className="mt-0.5 truncate text-xs">
											{blueprint ? t(blueprint.nameKey as never) : agent.blueprintId}
										</div>
									</button>
								);
							})}
						</div>
					) : (
						<p className="px-2 py-3 text-xs text-muted-foreground">{t("library.empty")}</p>
					)}
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
							identityReadOnly={isBuiltinAgentPreset(model.selected)}
							blueprint={model.blueprint}
							capabilities={model.capabilities}
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
