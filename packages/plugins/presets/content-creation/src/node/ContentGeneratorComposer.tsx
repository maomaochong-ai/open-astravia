import { useTranslation } from "@vetta-org/plugin-sdk";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
	assignContentReferenceSlots,
	listAcceptedReferenceKinds,
	outputKindForNodeKind,
	slotIdForReferenceKind,
} from "../generation/model-inputs";
import type { ContentModelDescriptor, ImportedContentReference } from "../generation/types";
import type {
	ContentAsset,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentNodeKind,
	ContentNodeStatus,
} from "../project/types";
import { ContentGenerationControls } from "./ContentGenerationControls";
import { ContentReferenceInput } from "./ContentReferenceInput";
import type { ConnectedContentAsset } from "./material-assets";
import {
	resolveConnectedPromptSource,
	resolveContentPrompt,
	type ConnectedPromptSource,
} from "./prompt-sources";
import { PromptSourceSelector } from "./PromptSourceSelector";

interface ContentGeneratorComposerProps {
	kind: Extract<ContentNodeKind, "image-generator" | "video-generator">;
	status: ContentNodeStatus;
	data: ContentNodeData;
	models: readonly ContentModelDescriptor[];
	connectedAssets: readonly ConnectedContentAsset[];
	connectedPrompts: readonly ConnectedPromptSource[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	hasGenerationError: boolean;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onRunNode: () => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[]) => Promise<void>;
}

export function ContentGeneratorComposer({
	kind,
	status,
	data,
	models,
	connectedAssets,
	connectedPrompts,
	referenceAssets,
	hasGenerationError,
	onUpdate,
	onRunNode,
	onImportReferences,
}: ContentGeneratorComposerProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState(data);
	const outputKind = outputKindForNodeKind(kind);
	const availableModels = useMemo(
		() => models.filter((model) => model.outputKind === outputKind),
		[models, outputKind],
	);
	const assetById = useMemo(
		() =>
			new Map(
				[
					...referenceAssets.map(({ asset }) => asset),
					...connectedAssets.map(({ asset }) => asset),
				].map((asset) => [asset.id, asset]),
			),
		[connectedAssets, referenceAssets],
	);
	const draftReferenceAssets = (draft.inputs ?? []).flatMap((binding) => {
		const asset = assetById.get(binding.assetId);
		return asset ? [{ binding, asset }] : [];
	});
	const fixedReferenceShapes = draftReferenceAssets.map(({ binding, asset }) => ({
		slotId: binding.slotId,
		kind: asset.kind,
	}));
	const selectedPromptSource = resolveConnectedPromptSource(connectedPrompts, draft);
	const localAssetIds = new Set(draftReferenceAssets.map(({ asset }) => asset.id));
	const promptReferenceAssets = (selectedPromptSource?.references ?? []).filter(
		({ asset }, index, references) =>
			!localAssetIds.has(asset.id) && references.findIndex((candidate) => candidate.asset.id === asset.id) === index,
	);
	const promptReferenceKinds = promptReferenceAssets.map(({ asset }) => asset.kind);
	const selectedModel =
		availableModels.find(
			(model) => model.providerId === draft.providerId && model.modelId === draft.modelId,
		) ??
		availableModels.find(
			(model) =>
				assignContentReferenceSlots(model, fixedReferenceShapes, promptReferenceKinds, draft.modeId).mode !== null,
		) ??
		availableModels[0];
	const resolution = selectedModel
		? assignContentReferenceSlots(selectedModel, fixedReferenceShapes, promptReferenceKinds, draft.modeId)
		: { mode: null, reason: null, references: fixedReferenceShapes, assignedSlotIds: [] };
	const referenceShapes = resolution.references;
	const acceptedKinds = selectedModel ? listAcceptedReferenceKinds(selectedModel, referenceShapes) : [];
	const selectedAssetIds = new Set([
		...draftReferenceAssets.map(({ asset }) => asset.id),
		...promptReferenceAssets.map(({ asset }) => asset.id),
	]);
	const connectedReferenceOptions = connectedAssets
		.filter(({ asset }) => !selectedAssetIds.has(asset.id))
		.map((candidate) => ({
			...candidate,
			slotId: selectedModel
				? slotIdForReferenceKind(selectedModel, referenceShapes, candidate.asset.kind)
				: null,
		}));
	const isRunning = status === "running" || status === "queued";
	const resolvedPrompt = resolveContentPrompt(connectedPrompts, draft);
	const canGenerate = Boolean(selectedModel && resolution.mode && resolvedPrompt && !isRunning);
	const minimumWidth = kind === "image-generator" ? 360 : 400;
	const promptRows = estimatePromptRows(resolvedPrompt);

	useEffect(() => setDraft(data), [data]);

	const commit = (next: ContentNodeData) => {
		setDraft(next);
		void onUpdate(next);
	};
	const submit = () => {
		if (!canGenerate || !selectedModel || !resolution.mode) return;
		const next = {
			...draft,
			providerId: selectedModel.providerId,
			modelId: selectedModel.modelId,
			modeId: resolution.mode.id,
		};
		setDraft(next);
		void onUpdate(next).then(onRunNode);
	};
	const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey) return;
		event.preventDefault();
		submit();
	};
	const compatibilityMessage = resolution.reason
		? t(
				resolution.reason === "missing-required-input"
					? "nodeEditor.reference.required"
					: "nodeEditor.reference.incompatible",
			)
		: null;

	return (
		<div
			className="nodrag nowheel min-w-0 max-w-[calc(100vw-32px)] rounded-2xl border border-border/70 bg-card/95 p-2.5 text-card-foreground shadow-xl backdrop-blur-md"
			style={{
				width: "fit-content",
				minWidth: `min(${minimumWidth}px, calc(100vw - 32px))`,
				maxWidth: "min(600px, calc(100vw - 32px))",
			}}
			onPointerDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<PromptSourceSelector
				sources={connectedPrompts}
				selectedSource={selectedPromptSource}
				disabled={isRunning}
				onChange={(nodeId) => commit({ ...draft, promptSourceNodeId: nodeId })}
			/>
			<ContentReferenceInput
				references={draftReferenceAssets}
				connectedReferences={connectedReferenceOptions}
				acceptedKinds={acceptedKinds}
				disabled={isRunning}
				onImport={async (files) => {
					if (!selectedModel) return;
					const next = { ...draft, providerId: selectedModel.providerId, modelId: selectedModel.modelId };
					setDraft(next);
					await onUpdate(next);
					await onImportReferences(files);
				}}
				onRemove={(bindingId) => {
					commit({ ...draft, inputs: (draft.inputs ?? []).filter((binding) => binding.id !== bindingId) });
				}}
				onSelectConnected={({ sourceNodeId, asset, slotId }) => {
					if (!slotId) return;
					commit({
						...draft,
						inputs: [
							...(draft.inputs ?? []),
							{ id: crypto.randomUUID(), assetId: asset.id, slotId, sourceNodeId },
						],
					});
				}}
			/>
			<textarea
				className="my-1.5 min-h-[48px] max-h-[112px] w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground read-only:text-muted-foreground"
				value={selectedPromptSource?.prompt ?? draft.prompt ?? ""}
				rows={promptRows}
				placeholder={t("nodeEditor.prompt.placeholder")}
				readOnly={Boolean(selectedPromptSource)}
				onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
				onBlur={() => {
					if (!selectedPromptSource) void onUpdate(draft);
				}}
				onKeyDown={handlePromptKeyDown}
			/>
			{compatibilityMessage || hasGenerationError ? (
				<p className="mb-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
					{hasGenerationError ? t("error.generate") : compatibilityMessage}
				</p>
			) : null}
			<ContentGenerationControls
				kind={kind}
				draft={draft}
				models={availableModels}
				selectedModel={selectedModel}
				isRunning={isRunning}
				canGenerate={canGenerate}
				onChange={commit}
				onModelChange={(model) => {
					const nextMode = assignContentReferenceSlots(
						model,
						fixedReferenceShapes,
						promptReferenceKinds,
					).mode;
					commit({
						...draft,
						providerId: model.providerId,
						modelId: model.modelId,
						modeId: nextMode?.id,
					});
				}}
				onSubmit={submit}
			/>
		</div>
	);
}

function estimatePromptRows(prompt: string | undefined): number {
	const visualRows = (prompt || "").split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 44)), 0);
	return Math.min(5, Math.max(2, visualRows));
}
