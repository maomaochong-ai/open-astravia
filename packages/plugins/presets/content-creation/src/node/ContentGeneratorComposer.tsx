import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useEffect, useMemo, useState } from "react";
import {
	assignContentReferenceSlots,
	isContentReferenceSlotCompatibleWithMode,
	isContentReferenceSlotDeclared,
	listAcceptedReferenceKinds,
	outputKindForNodeKind,
	shouldResolveStrictContentGenerationMode,
	slotIdForReferenceKind,
} from "../generation/model-inputs";
import { resolveContentAspectRatio } from "../generation/aspect-ratio";
import { inferImageDimensionsFromUrl, type ImageDimensions } from "../generation/image-dimensions";
import { resolveSupportedModelOption } from "../generation/model-options";
import type {
	ContentModelDescriptor,
	ContentReferenceKind,
	ImportedContentReference,
} from "../generation/types";
import type {
	ContentAsset,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentNodeKind,
	ContentNodeStatus,
} from "../project/types";
import { contentNodeDataEqual } from "./content-node-data-equal";
import { ContentGenerationControls } from "./ContentGenerationControls";
import {
	ContentGeneratorPromptEditor,
	type ContentGeneratorAssetMention,
} from "./ContentGeneratorPromptEditor";
import { ContentReferenceInput } from "./ContentReferenceInput";
import { ContentVideoReferenceInput } from "./ContentVideoReferenceInput";
import type { ConnectedContentAsset } from "./material-assets";
import { NodeEditorPanel } from "./NodeEditorPanel";
import {
	resolveConnectedPromptSources,
	resolveContentPrompt,
	type ConnectedPromptSource,
} from "./prompt-sources";
import type { ContentAssetReferenceCandidate } from "./reference-candidates";
import type { ContentKeyframeReference, ContentKeyframeSlotId } from "./keyframe-sources";

interface ContentGeneratorComposerProps {
	kind: Extract<ContentNodeKind, "image-generator" | "video-generator">;
	status: ContentNodeStatus;
	data: ContentNodeData;
	models: readonly ContentModelDescriptor[];
	connectedAssets: readonly ConnectedContentAsset[];
	connectedPrompts: readonly ConnectedPromptSource[];
	mentionAssets: readonly ContentAssetReferenceCandidate[];
	keyframeReferences: readonly ContentKeyframeReference[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onRunNode: () => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[], slotId?: string) => Promise<void>;
	onSetKeyframeSource: (
		slotId: ContentKeyframeSlotId,
		assetId: string,
		sourceNodeId?: string,
	) => Promise<void>;
	onClearKeyframeSource: (slotId: ContentKeyframeSlotId) => Promise<void>;
}

export function ContentGeneratorComposer({
	kind,
	status,
	data,
	models,
	connectedAssets,
	connectedPrompts,
	mentionAssets,
	keyframeReferences,
	referenceAssets,
	onUpdate,
	onRunNode,
	onImportReferences,
	onSetKeyframeSource,
	onClearKeyframeSource,
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
					...keyframeReferences.map(({ asset }) => asset),
					...connectedAssets.map(({ asset }) => asset),
					...mentionAssets.map(({ asset }) => asset),
				].map((asset) => [asset.id, asset]),
			),
		[connectedAssets, keyframeReferences, mentionAssets, referenceAssets],
	);
	const boundReferenceAssets = (draft.inputs ?? []).flatMap((binding) => {
		const asset = assetById.get(binding.assetId);
		return asset ? [{ binding, asset }] : [];
	});
	const resolvedKeyframeAssets = keyframeReferences.map(({ slotId, asset, sourceNodeId }) => ({
		binding: {
			id: `keyframe:${slotId}:${sourceNodeId ?? asset.id}`,
			assetId: asset.id,
			slotId,
			...(sourceNodeId ? { sourceNodeId } : {}),
		},
		asset,
	}));
	const selectedReferenceAssets = [
		...boundReferenceAssets,
		...resolvedKeyframeAssets.filter(
			({ binding }) =>
				!boundReferenceAssets.some(
					(reference) =>
						reference.binding.slotId === binding.slotId && reference.asset.id === binding.assetId,
				),
		),
	];
	const selectedPromptSources = resolveConnectedPromptSources(connectedPrompts, draft);
	const localAssetIds = new Set(selectedReferenceAssets.map(({ asset }) => asset.id));
	const promptReferenceAssets = selectedPromptSources.flatMap((source) => source.references).filter(
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
				assignGeneratorReferences(model, selectedReferenceAssets, promptReferenceKinds, draft.modeId).mode !== null,
		) ??
		availableModels[0];
	const resolution = selectedModel
		? assignGeneratorReferences(selectedModel, selectedReferenceAssets, promptReferenceKinds, draft.modeId)
		: { mode: null, reason: null, references: [], assignedSlotIds: [] };
	const referenceShapes = resolution.references;
	const activeReferenceAssets = selectedModel
		? selectedReferenceAssets.filter(({ binding, asset }) =>
				isContentReferenceSlotCompatibleWithMode(selectedModel, resolution.mode?.id ?? draft.modeId, {
					slotId: binding.slotId,
					kind: asset.kind,
				}),
			)
		: selectedReferenceAssets;
	const acceptedKinds = selectedModel
		? listAcceptedReferenceKinds(selectedModel, referenceShapes, resolution.mode?.id ?? draft.modeId)
		: [];
	const selectedAssetIds = new Set([
		...activeReferenceAssets.map(({ asset }) => asset.id),
		...promptReferenceAssets.map(({ asset }) => asset.id),
	]);
	const connectedReferenceOptions = connectedAssets
		.filter(({ asset }) => !selectedAssetIds.has(asset.id))
		.map((candidate) => ({
			...candidate,
				slotId: selectedModel
				? slotIdForReferenceKind(
						selectedModel,
						referenceShapes,
						candidate.asset.kind,
						resolution.mode?.id ?? draft.modeId,
					)
				: null,
		}));
	const promptReferenceAssetIds = new Set(promptReferenceAssets.map(({ asset }) => asset.id));
	const generatorAssetMentions: ContentGeneratorAssetMention[] = mentionAssets.flatMap((candidate) => {
		const binding = (draft.inputs ?? []).find(({ assetId }) => assetId === candidate.asset.id);
		if (!binding && promptReferenceAssetIds.has(candidate.asset.id)) return [];
		const slotId =
			binding?.slotId ??
			(selectedModel
				? slotIdForReferenceKind(
						selectedModel,
						referenceShapes,
						candidate.asset.kind,
						resolution.mode?.id ?? draft.modeId,
					)
				: null);
		return slotId ? [{ candidate, slotId, binding }] : [];
	});
	const isRunning = status === "running" || status === "queued";
	const resolvedPrompt = resolveContentPrompt(connectedPrompts, draft);
	const canGenerate = Boolean(selectedModel && resolution.mode && resolvedPrompt && !isRunning);
	const aspectRatioAssets = [...activeReferenceAssets, ...promptReferenceAssets].map(({ asset }) => asset);
	const firstImage = kind === "video-generator" ? aspectRatioAssets.find(({ kind }) => kind === "image") : undefined;
	const inferredImageDimensions = useInferredImageDimensions(firstImage);
	const resolvedAspectRatio = selectedModel
		? resolveContentAspectRatio({
				outputKind: selectedModel.outputKind,
				explicitAspectRatio: draft.aspectRatio,
				supportedAspectRatios: selectedModel.aspectRatios,
				references: aspectRatioAssets.map((asset) =>
					asset.id === firstImage?.id && inferredImageDimensions
						? { ...asset, ...inferredImageDimensions }
						: asset,
				),
			})
		: undefined;
	const minimumWidth = kind === "image-generator" ? 360 : 400;
	const selectedInputMode = selectedModel?.modes.find(
		(mode) => mode.id === (resolution.mode?.id ?? draft.modeId),
	) ?? selectedModel?.modes[0];
	const hasReferenceInputs = (selectedInputMode?.inputs.length ?? 0) > 0;

	useEffect(() => setDraft(data), [data]);

	const commit = (next: ContentNodeData) => {
		setDraft((current) => (contentNodeDataEqual(current, next) ? current : next));
		if (!contentNodeDataEqual(data, next)) void onUpdate(next);
	};
	const submit = () => {
		if (!canGenerate || !selectedModel || !resolution.mode) return;
		const next = {
			...draft,
			providerId: selectedModel.providerId,
			modelId: selectedModel.modelId,
			modeId: resolution.mode.id,
			...(kind === "video-generator"
				? {
						duration: resolveSupportedModelOption(draft.duration, selectedModel.durations),
						resolution: resolveSupportedModelOption(draft.resolution, selectedModel.resolutions),
					}
				: {}),
		};
		setDraft(next);
		void onUpdate(next).then(onRunNode);
	};
	const compatibilityMessage = resolution.reason
		? t(
				resolution.reason === "missing-required-input"
					? "nodeEditor.reference.required"
					: "nodeEditor.reference.incompatible",
			)
		: null;

	return (
		<>
			<NodeEditorPanel
			className="min-w-0 max-w-[calc(100vw-32px)] rounded-2xl border border-border/70 bg-card/95 p-2.5 text-card-foreground shadow-xl backdrop-blur-md"
			style={{
				width: "fit-content",
				minWidth: `min(${minimumWidth}px, calc(100vw - 32px))`,
				maxWidth: "min(600px, calc(100vw - 32px))",
			}}
		>
			<ContentGeneratorPromptEditor
				data={draft}
				sources={connectedPrompts}
				assetMentions={generatorAssetMentions}
				disabled={isRunning}
				onDraftChange={setDraft}
				onCommit={commit}
			/>
			{hasReferenceInputs ? (
				<div className="my-2 rounded-xl border border-border/50 bg-muted/15 px-2 py-1.5">
					<div className="mb-1 flex items-center gap-1.5 px-0.5 text-[10px] text-muted-foreground">
						<span className="icon-[lucide--library] block size-3" aria-hidden="true" />
						<span>{t("nodeEditor.reference.section")}</span>
					</div>
					{kind === "video-generator" ? (
						<ContentVideoReferenceInput
							modeId={resolution.mode?.id ?? draft.modeId}
							model={selectedModel}
							references={activeReferenceAssets}
							connectedReferences={connectedReferenceOptions}
							acceptedKinds={acceptedKinds}
							keyframeReferences={keyframeReferences}
							keyframeCandidates={mentionAssets}
							disabled={isRunning}
							onImport={async (files, slotId) => {
								if (!selectedModel) return;
								const next = { ...draft, providerId: selectedModel.providerId, modelId: selectedModel.modelId };
								setDraft(next);
								await onUpdate(next);
								await onImportReferences(files, slotId);
							}}
							onRemove={(bindingId) => {
								commit({ ...draft, inputs: (draft.inputs ?? []).filter((binding) => binding.id !== bindingId) });
							}}
							onSelectKeyframe={(slotId, candidate) =>
								void onSetKeyframeSource(
									slotId,
									candidate.asset.id,
									candidate.sourceNodeId,
								)
							}
							onRemoveKeyframe={(slotId) => void onClearKeyframeSource(slotId)}
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
					) : (
						<ContentReferenceInput
							compact
							references={activeReferenceAssets}
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
					)}
				</div>
			) : null}
			{compatibilityMessage ? (
				<p className="mb-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
					{compatibilityMessage}
				</p>
			) : null}
			<ContentGenerationControls
				kind={kind}
				draft={draft}
				models={availableModels}
				selectedModel={selectedModel}
				resolvedAspectRatio={resolvedAspectRatio}
				isRunning={isRunning}
				canGenerate={canGenerate}
				onChange={commit}
				onModelChange={(model) => {
					const nextMode = assignGeneratorReferences(
						model,
						selectedReferenceAssets,
						promptReferenceKinds,
					).mode;
					const aspectRatio =
						draft.aspectRatio && model.aspectRatios.includes(draft.aspectRatio) ? draft.aspectRatio : undefined;
					commit({
						...draft,
						providerId: model.providerId,
						modelId: model.modelId,
						modeId: nextMode?.id,
						aspectRatio,
						...(kind === "video-generator"
							? {
									duration: resolveSupportedModelOption(draft.duration, model.durations),
									resolution: resolveSupportedModelOption(draft.resolution, model.resolutions),
								}
							: {}),
					});
				}}
				onSubmit={submit}
			/>
			</NodeEditorPanel>
		</>
	);
}

function useInferredImageDimensions(asset: ContentAsset | undefined): ImageDimensions | undefined {
	const source = asset?.previewUrl;
	const key = asset && source ? `${asset.id}:${source}` : undefined;
	const hasDimensions = isPositiveDimension(asset?.width) && isPositiveDimension(asset?.height);
	const [result, setResult] = useState<{ key: string; dimensions?: ImageDimensions }>();

	useEffect(() => {
		if (!key || !source || hasDimensions) return;
		let active = true;
		void inferImageDimensionsFromUrl(source).then((dimensions) => {
			if (active) setResult({ key, dimensions });
		});
		return () => {
			active = false;
		};
	}, [hasDimensions, key, source]);

	return !hasDimensions && key && result?.key === key ? result.dimensions : undefined;
}

function isPositiveDimension(value: number | undefined): value is number {
	return Number.isFinite(value) && (value ?? 0) > 0;
}

function assignGeneratorReferences(
	model: ContentModelDescriptor,
	references: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[],
	unassignedKinds: readonly ContentReferenceKind[],
	preferredModeId?: string,
) {
	const strictPreferredMode = shouldResolveStrictContentGenerationMode(
		model,
		preferredModeId,
		references.map(({ binding, asset }) => ({ slotId: binding.slotId, kind: asset.kind })),
	);
	const preferredMode = strictPreferredMode
		? model.modes.find((mode) => mode.id === preferredModeId)
		: undefined;
	const activeReferences = references.filter(({ binding, asset }) => {
		const reference = { slotId: binding.slotId, kind: asset.kind };
		return (
			!preferredMode ||
			isContentReferenceSlotCompatibleWithMode(model, preferredModeId, reference) ||
			!isContentReferenceSlotDeclared(model, binding.slotId)
		);
	});
	const fixedReferences = activeReferences.flatMap(({ binding, asset }) => {
		const reference = { slotId: binding.slotId, kind: asset.kind };
		return isContentReferenceSlotCompatibleWithMode(model, preferredModeId, reference) ? [reference] : [];
	});
	const reassignedKinds = activeReferences.flatMap(({ binding, asset }) => {
		const reference = { slotId: binding.slotId, kind: asset.kind };
		return isContentReferenceSlotCompatibleWithMode(model, preferredModeId, reference) ? [] : [asset.kind];
	});
	return assignContentReferenceSlots(
		model,
		fixedReferences,
		[...reassignedKinds, ...unassignedKinds],
		preferredModeId,
		strictPreferredMode && Boolean(preferredMode),
	);
}
