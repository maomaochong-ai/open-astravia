import {
	useActiveConversation,
	usePromptAttachment,
	useTranslation,
} from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentProjectCommand } from "../project/commands";
import type { ContentProjectDocument } from "../project/types";
import type { ImportedContentAsset, ImportedContentReference } from "../generation/types";
import {
	getContentCreationWorkspace,
	getContentGenerationService,
	getContentAssetPreviewResolver,
	notifyContentCreationError,
} from "../plugin/runtime";
import { GraphWorkspace } from "../canvas/GraphWorkspace";
import { maximizeActivityPanel, publishPromptAttachment } from "../plugin/plugin-ui";
import {
	CONTENT_SELECTION_PROMPT_ATTACHMENT_ID,
	createContentSelectionPromptAttachment,
	isCurrentContentSelectionPromptAttachment,
} from "../plugin/selection-prompt-context";

export function ContentCreationPanel() {
	const { cwd } = useActiveConversation();
	const { t } = useTranslation();
	const [project, setProject] = useState<ContentProjectDocument | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [assetPreviewUrls, setAssetPreviewUrls] = useState<ReadonlyMap<string, string>>(new Map());
	const [selectedNodeIds, setSelectedNodeIds] = useState<readonly string[]>([]);
	const promptAttachment = usePromptAttachment();
	const publishedSelectionRef = useRef<string | null>(null);
	const dismissedSelectionRef = useRef<string | null>(null);
	const previousSelectionRef = useRef("");
	const workspace = getContentCreationWorkspace();
	const generation = getContentGenerationService();
	const assetPreviewResolver = getContentAssetPreviewResolver();
	const models = useMemo(() => generation.listModels(), [generation]);
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
	useEffect(() => maximizeActivityPanel(), []);

	useEffect(() => {
		const selectionChanged = previousSelectionRef.current !== selectionSignature;
		if (selectionChanged) {
			previousSelectionRef.current = selectionSignature;
			publishedSelectionRef.current = null;
			dismissedSelectionRef.current = null;
		}
		if (!selectionAttachment) {
			if (promptAttachment?.id === CONTENT_SELECTION_PROMPT_ATTACHMENT_ID) {
				publishPromptAttachment(null);
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
		publishPromptAttachment(selectionAttachment);
		publishedSelectionRef.current = selectionSignature;
	}, [promptAttachment, selectionAttachment, selectionSignature]);

	useEffect(
		() => () => {
			publishPromptAttachment(null);
		},
		[],
	);

	useEffect(() => {
		let active = true;
		setProject(workspace.getSnapshot(cwd));
		setSelectedNodeIds([]);
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
			if (!cwd) {
				setError(t("error.outputWorkspaceRequired"));
				notifyContentCreationError(t("error.outputWorkspaceRequired"), new Error("workspace is required"));
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
		[cwd, generation, t],
	);
	const importReferences = useCallback(
		async (nodeId: string, files: readonly ImportedContentReference[]) => {
			try {
				setError(null);
				await generation.importReferences(cwd, nodeId, files);
			} catch (importError) {
				setError(t("error.importReference"));
				notifyContentCreationError(t("error.importReference"), importError);
			}
		},
		[cwd, generation, t],
	);
	const importAssets = useCallback(
		async (nodeId: string, files: readonly ImportedContentAsset[]) => {
			try {
				setError(null);
				await generation.importAssets(cwd, nodeId, files);
			} catch (importError) {
				setError(t("error.importAsset"));
				notifyContentCreationError(t("error.importAsset"), importError);
			}
		},
		[cwd, generation, t],
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
					onDispatch={dispatch}
					onRunNode={runNode}
					onImportAssets={importAssets}
					onImportReferences={importReferences}
					onSelectedNodeIdsChange={setSelectedNodeIds}
				/>
			</main>
		</div>
	);
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
