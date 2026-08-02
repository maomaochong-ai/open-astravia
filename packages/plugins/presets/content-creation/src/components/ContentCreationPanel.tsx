import { useActiveConversation, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentProjectCommand } from "../domain/commands";
import type { ContentProjectDocument } from "../domain/model";
import {
	getContentCreationWorkspace,
	getContentGenerationService,
	notifyContentCreationError,
} from "../runtime/plugin-runtime";
import { GraphWorkspace } from "./GraphWorkspace";
import { TimelineWorkspace } from "./TimelineWorkspace";
import { ContentCreationIcon } from "./icons";

type WorkspaceMode = "graph" | "timeline";

export function ContentCreationPanel() {
	const { cwd } = useActiveConversation();
	const { t } = useTranslation();
	const [project, setProject] = useState<ContentProjectDocument | null>(null);
	const [mode, setMode] = useState<WorkspaceMode>("graph");
	const [error, setError] = useState<string | null>(null);
	const workspace = getContentCreationWorkspace();
	const generation = getContentGenerationService();
	const models = useMemo(() => generation.listModels(), [generation]);

	useEffect(() => {
		let active = true;
		setProject(workspace.getSnapshot(cwd));
		setError(null);
		const unsubscribe = workspace.subscribe(cwd, () => {
			if (active) setProject(workspace.getSnapshot(cwd));
		});
		void workspace.load(cwd).catch((loadError) => {
			if (!active) return;
			setError(t("error.load"));
			notifyContentCreationError(t("error.load"), loadError);
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [cwd, t, workspace]);

	const dispatch = useCallback(
		async (commands: readonly ContentProjectCommand[]) => {
			try {
				setError(null);
				await workspace.dispatch(cwd, commands);
			} catch (dispatchError) {
				setError(t("error.save"));
				notifyContentCreationError(t("error.save"), dispatchError);
			}
		},
		[cwd, t, workspace],
	);
	const runNode = useCallback(
		async (nodeId: string) => {
			try {
				setError(null);
				await generation.runNode(cwd, nodeId);
			} catch (generationError) {
				setError(t("error.generate"));
				notifyContentCreationError(t("error.generate"), generationError);
			}
		},
		[cwd, generation, t],
	);

	if (!project) {
		return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">{error ?? t("state.loading")}</div>;
	}

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
			<header className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-card/80 px-4 py-2 backdrop-blur">
				<div className="flex min-w-0 items-center gap-2">
					<ContentCreationIcon className="h-4 w-4" />
					<div>
						<strong className="block text-sm font-semibold">{t("workspace.title")}</strong>
						<span className="block max-w-[320px] truncate text-xs text-muted-foreground">{cwd ?? t("workspace.global")}</span>
					</div>
				</div>
				<div className="ml-auto flex items-center gap-1 rounded-md bg-muted/60 p-0.5">
					<Button type="button" size="sm" variant={mode === "graph" ? "secondary" : "ghost"} onClick={() => setMode("graph")}>
						{t("mode.graph")}
					</Button>
					<Button type="button" size="sm" variant={mode === "timeline" ? "secondary" : "ghost"} onClick={() => setMode("timeline")}>
						{t("mode.timeline")}
					</Button>
				</div>
				<div className="text-xs text-muted-foreground">{t("workspace.revision", { revision: project.revision })}</div>
			</header>
			{error && <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>}
			<main className="min-h-0 flex-1">
				{mode === "graph" ? (
					<GraphWorkspace
						project={project}
						models={models}
						onDispatch={dispatch}
						onRunNode={runNode}
					/>
				) : (
					<TimelineWorkspace project={project} />
				)}
			</main>
		</div>
	);
}
