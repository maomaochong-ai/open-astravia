import { useActiveConversation, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useCallback, useEffect, useState } from "react";
import type { ContentProjectCommand } from "../domain/commands";
import type { ContentProjectDocument } from "../domain/model";
import { getContentCreationWorkspace, notifyContentCreationError } from "../runtime/plugin-runtime";
import { GraphWorkspace } from "./GraphWorkspace";
import { NodeInspector } from "./NodeInspector";
import { TimelineWorkspace } from "./TimelineWorkspace";
import { ContentCreationIcon } from "./icons";

type WorkspaceMode = "graph" | "timeline";

export function ContentCreationPanel() {
	const { cwd } = useActiveConversation();
	const { t } = useTranslation();
	const [project, setProject] = useState<ContentProjectDocument | null>(null);
	const [mode, setMode] = useState<WorkspaceMode>("graph");
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const workspace = getContentCreationWorkspace();

	useEffect(() => {
		let active = true;
		setProject(workspace.getSnapshot(cwd));
		setSelectedNodeId(null);
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

	if (!project) {
		return <div className="content-creation-state">{error ?? t("state.loading")}</div>;
	}

	const selectedNode = project.graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
	return (
		<div className="content-creation-shell">
			<header className="content-creation-header">
				<div className="content-creation-title">
					<ContentCreationIcon className="h-4 w-4" />
					<div>
						<strong>{t("workspace.title")}</strong>
						<span>{cwd ?? t("workspace.global")}</span>
					</div>
				</div>
				<div className="content-creation-mode-switch">
					<Button type="button" size="sm" variant={mode === "graph" ? "secondary" : "ghost"} onClick={() => setMode("graph")}>
						{t("mode.graph")}
					</Button>
					<Button type="button" size="sm" variant={mode === "timeline" ? "secondary" : "ghost"} onClick={() => setMode("timeline")}>
						{t("mode.timeline")}
					</Button>
				</div>
				<div className="content-creation-revision">{t("workspace.revision", { revision: project.revision })}</div>
			</header>
			{error && <div className="content-creation-error">{error}</div>}
			<main className="content-creation-main">
				{mode === "graph" ? (
					<>
						<GraphWorkspace project={project} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onDispatch={dispatch} />
						<NodeInspector project={project} node={selectedNode} onDispatch={dispatch} />
					</>
				) : (
					<TimelineWorkspace project={project} />
				)}
			</main>
		</div>
	);
}

