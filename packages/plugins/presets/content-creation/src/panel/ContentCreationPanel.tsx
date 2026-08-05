import { useActiveConversation, useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
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

export function ContentCreationPanel() {
	const { cwd } = useActiveConversation();
	const { t } = useTranslation();
	const [project, setProject] = useState<ContentProjectDocument | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [assetPreviewUrls, setAssetPreviewUrls] = useState<ReadonlyMap<string, string>>(new Map());
	const workspace = getContentCreationWorkspace();
	const generation = getContentGenerationService();
	const assetPreviewResolver = getContentAssetPreviewResolver();
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
	useEffect(() => {
		let active = true;
		if (!project) {
			setAssetPreviewUrls(new Map());
			return () => {
				active = false;
			};
		}
		void assetPreviewResolver.resolveAll(project.assets).then((urls) => {
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
