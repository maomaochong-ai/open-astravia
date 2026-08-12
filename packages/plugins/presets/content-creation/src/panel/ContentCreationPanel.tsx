import { useActivityTab, usePromptAttachment, useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentProjectCommand } from "../project/commands";
import type { ContentHistoryMetadata, ContentProjectHistoryView } from "../project/history";
import type { ContentProjectDocument } from "../project/types";
import type { ImportedContentAsset, ImportedContentReference } from "../generation/types";
import type { ContentImageEditRequest } from "../image-edit/image-edit-document";
import type { ContentCreationPluginRuntime } from "../plugin/runtime";
import {
	ContentCreationRuntimeProvider,
	useContentCreationRuntime,
} from "../plugin/runtime-context";
import { GraphWorkspace } from "../canvas/GraphWorkspace";
import {
	CONTENT_SELECTION_PROMPT_ATTACHMENT_ID,
	createContentSelectionPromptAttachment,
	isCurrentContentSelectionPromptAttachment,
} from "../plugin/selection-prompt-context";

export function ContentCreationPanel({ runtime }: { runtime: ContentCreationPluginRuntime }) {
	return (
		<ContentCreationRuntimeProvider runtime={runtime}>
			<ContentCreationPanelContent />
		</ContentCreationRuntimeProvider>
	);
}

function ContentCreationPanelContent() {
	const runtime = useContentCreationRuntime();
	const { cwd } = useActivityTab();
	const { t } = useTranslation();
	const [project, setProject] = useState<ContentProjectDocument | null>(null);
	const [history, setHistory] = useState<ContentProjectHistoryView>(() => workspaceHistoryEmpty());
	const [error, setError] = useState<string | null>(null);
	const [assetPreviewUrls, setAssetPreviewUrls] = useState<ReadonlyMap<string, string>>(new Map());
	const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>([]);
	const [modelRevision, setModelRevision] = useState(0);
	const promptAttachment = usePromptAttachment();
	const publishedSelectionRef = useRef<string | null>(null);
	const dismissedSelectionRef = useRef<string | null>(null);
	const previousSelectionRef = useRef("");
	const workspace = runtime.workspace;
	const generation = runtime.generation;
	const assetPreviewResolver = runtime.assetPreviewResolver;
	const models = useMemo(() => generation.listModels(), [generation, modelRevision]);
	const selectionSignature = useMemo(
		() => `${project?.projectId ?? ""}\u0000${[...selectedNodeIds].sort().join("\u0001")}`,
		[project?.projectId, selectedNodeIds],
	);
	const selectionAttachment = useMemo(() => {
		if (!project || selectedNodeIds.length === 0) return null;
		const selectedNodes = project.graph.nodes.filter((node) => selectedNodeIds.includes(node.id));
		if (selectedNodes.length === 0) return null;
		// 输入框逐条画出条目，所以按节点给名字；label 只是没有 labels 时的回退说法。
		const names = selectedNodes.map((node) => node.name?.trim() || t(`node.kind.${node.kind}`));
		const label = names.length === 1 ? names[0] : t("selection.count", { count: selectedNodes.length });
		return createContentSelectionPromptAttachment(project, selectedNodeIds, label, names);
	}, [project, selectedNodeIds, t]);

	// Match the design canvas: maximize on each tab activation, then leave resizing to the user.
	useEffect(() => runtime.maximizeActivityPanel(), [runtime]);
	useEffect(
		() => runtime.subscribeModels(() => setModelRevision((revision) => revision + 1)),
		[runtime],
	);

	useEffect(() => {
		const selectionChanged = previousSelectionRef.current !== selectionSignature;
		if (selectionChanged) {
			previousSelectionRef.current = selectionSignature;
			publishedSelectionRef.current = null;
			dismissedSelectionRef.current = null;
		}
		if (!selectionAttachment) {
			if (promptAttachment?.id === CONTENT_SELECTION_PROMPT_ATTACHMENT_ID) {
				runtime.publishPromptAttachment(null);
			}
			publishedSelectionRef.current = null;
			return;
		}
		if (promptAttachment && promptAttachment.id !== CONTENT_SELECTION_PROMPT_ATTACHMENT_ID) {
			publishedSelectionRef.current = null;
			return;
		}
		if (!promptAttachment && publishedSelectionRef.current === selectionSignature) {
			dismissedSelectionRef.current = selectionSignature;
			publishedSelectionRef.current = null;
			return;
		}
		if (dismissedSelectionRef.current === selectionSignature) return;
		if (isCurrentContentSelectionPromptAttachment(promptAttachment, selectionAttachment)) {
			publishedSelectionRef.current = selectionSignature;
			return;
		}
		runtime.publishPromptAttachment(selectionAttachment);
		publishedSelectionRef.current = selectionSignature;
	}, [promptAttachment, runtime, selectionAttachment, selectionSignature]);

	useEffect(
		() => () => {
			runtime.publishPromptAttachment(null);
		},
		[runtime],
	);

	useEffect(() => {
		let active = true;
		setProject(workspace.getSnapshot(cwd));
		setHistory(workspace.getHistoryView(cwd));
		setSelectedNodeIds([]);
		setError(null);
		const unsubscribe = workspace.subscribe(cwd, () => {
			if (active) {
				setProject(workspace.getSnapshot(cwd));
				setHistory(workspace.getHistoryView(cwd));
			}
		});
		void workspace
			.load(cwd)
			.then(() => generation.recoverActiveJobs(cwd))
			.catch((loadError) => {
				if (!active) return;
				setError(t("error.load"));
				runtime.notifyError(t("error.load"), loadError);
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, [cwd, generation, runtime, t, workspace]);
	useEffect(() => {
		let active = true;
		if (!project) {
			setAssetPreviewUrls(new Map());
			return () => {
				active = false;
			};
		}
		void assetPreviewResolver.resolveAll(project.cwd, project.assets).then((urls) => {
			if (active) {
				setAssetPreviewUrls((current) => (previewUrlMapsEqual(current, urls) ? current : urls));
			}
		});
		return () => {
			active = false;
		};
	}, [assetPreviewResolver, project]);

	const dispatch = useCallback(
		async (commands: readonly ContentProjectCommand[], historyMetadata?: ContentHistoryMetadata) => {
			try {
				setError(null);
				await workspace.dispatch(cwd, commands, undefined, historyMetadata);
			} catch (dispatchError) {
				setError(t("error.save"));
				runtime.notifyError(t("error.save"), dispatchError);
			}
		},
		[cwd, runtime, t, workspace],
	);
	const runNode = useCallback(
		async (nodeId: string) => {
			if (!cwd) {
				setError(t("error.outputWorkspaceRequired"));
				runtime.notifyError(t("error.outputWorkspaceRequired"), new Error("workspace is required"));
				return;
			}
			try {
				setError(null);
				await generation.runNode(cwd, nodeId);
			} catch (generationError) {
				// The job owns the user-facing error; renderer logging preserves diagnostic details.
				console.error("[plugin:content-creation] generation failed", generationError);
			}
		},
		[cwd, generation, runtime, t],
	);
	const runImageEdit = useCallback(
		async (nodeId: string, edit: ContentImageEditRequest) => {
			if (!cwd) {
				setError(t("error.outputWorkspaceRequired"));
				runtime.notifyError(t("error.outputWorkspaceRequired"), new Error("workspace is required"));
				return;
			}
			try {
				setError(null);
				await generation.runImageEdit(cwd, nodeId, edit);
			} catch (generationError) {
				console.error("[plugin:content-creation] image editing failed", generationError);
			}
		},
		[cwd, generation, runtime, t],
	);
	const restoreHistory = useCallback(
		async (direction: "undo" | "redo") => {
			try {
				setError(null);
				if (direction === "undo") await workspace.undo(cwd);
				else await workspace.redo(cwd);
			} catch (historyError) {
				setError(t("error.historyRestore"));
				runtime.notifyError(t("error.historyRestore"), historyError);
			}
		},
		[cwd, runtime, t, workspace],
	);
	const importReferences = useCallback(
		async (nodeId: string, files: readonly ImportedContentReference[], slotId?: string) => {
			try {
				setError(null);
				await generation.importReferences(cwd, nodeId, files, slotId);
			} catch (importError) {
				setError(t("error.importReference"));
				runtime.notifyError(t("error.importReference"), importError);
			}
		},
		[cwd, generation, runtime, t],
	);
	const importAssets = useCallback(
		async (nodeId: string, files: readonly ImportedContentAsset[], historyMetadata?: ContentHistoryMetadata) => {
			try {
				setError(null);
				await generation.importAssets(cwd, nodeId, files, historyMetadata);
			} catch (importError) {
				setError(t("error.importAsset"));
				runtime.notifyError(t("error.importAsset"), importError);
			}
		},
		[cwd, generation, runtime, t],
	);

	if (!project) {
		return (
			<div className="flex h-full items-center justify-center bg-background text-[13px] text-muted-foreground">
				{error ?? t("state.loading")}
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-background font-[family-name:var(--font-sans)] text-foreground">
			{error ? (
				<div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-3.5 py-1.5 text-xs text-destructive">
					{error}
				</div>
			) : null}
			<main className="flex min-h-0 flex-1">
				<GraphWorkspace
					project={project}
					assetPreviewUrls={assetPreviewUrls}
					models={models}
					registerShortcutScope={runtime.registerShortcutScope}
					onDispatch={dispatch}
					history={history}
					onUndo={() => restoreHistory("undo")}
					onRedo={() => restoreHistory("redo")}
					onRunNode={runNode}
					onRunImageEdit={runImageEdit}
					onImportAssets={importAssets}
					onImportReferences={importReferences}
					onSelectedNodeIdsChange={setSelectedNodeIds}
					onOpenSettings={runtime.openPluginSettings}
				/>
			</main>
		</div>
	);
}

function workspaceHistoryEmpty(): ContentProjectHistoryView {
	return { canUndo: false, canRedo: false };
}

function previewUrlMapsEqual(
	left: ReadonlyMap<string, string>,
	right: ReadonlyMap<string, string>,
): boolean {
	if (left === right) return true;
	if (left.size !== right.size) return false;
	for (const [assetId, url] of left) {
		if (right.get(assetId) !== url) return false;
	}
	return true;
}
