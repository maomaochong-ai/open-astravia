import { type PluginAiModel, useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ImportedContentReference } from "../generation/types";
import {
	getContentPromptOptimizationService,
	notifyContentCreationError,
} from "../plugin/runtime";
import type {
	ContentAsset,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentPromptDocument,
} from "../project/types";
import {
	contentPromptText,
	contentPromptSourceSignature,
	createContentPromptDocument,
	listContentPromptBindingIds,
} from "./prompt-document";
import { NodeEditorPanel } from "./NodeEditorPanel";
import type { PromptMentionOption } from "./PromptMentionMenu";
import { PromptRichTextInput, type PromptMentionInsertion } from "./PromptRichTextInput";
import { PROMPT_REFERENCE_SLOT_ID } from "./prompt-sources";
import type { ContentAssetReferenceCandidate } from "./reference-candidates";
import { readImportedMediaFile } from "./readImportedMediaFile";

interface ContentPromptEditorProps {
	data: ContentNodeData;
	mentionAssets: readonly ContentAssetReferenceCandidate[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	focusPromptRequest: number;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[]) => Promise<void>;
}

const EMPTY_PROMPT_LABELS = new Map<string, string>();

export function ContentPromptEditor({
	data,
	mentionAssets,
	referenceAssets,
	focusPromptRequest,
	onUpdate,
	onImportReferences,
}: ContentPromptEditorProps) {
	const { t } = useTranslation();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const draftRef = useRef(data);
	const [models, setModels] = useState<PluginAiModel[]>([]);
	const [selectedModelKey, setSelectedModelKey] = useState<string | undefined>(
		data.promptOptimization?.modelKey,
	);
	const [isLoadingModels, setIsLoadingModels] = useState(true);
	const [isOptimizing, setIsOptimizing] = useState(false);
	const [hasPromptContent, setHasPromptContent] = useState(() => hasOptimizableContent(data));
	const removeReferenceLabel = t("nodeEditor.reference.remove");
	const modelLoadErrorMessage = t("error.promptOptimizationModels");
	const assetById = useMemo(
		() =>
			new Map(
				[
					...referenceAssets.map(({ asset }) => asset),
					...mentionAssets.map(({ asset }) => asset),
				].map((asset) => [asset.id, asset]),
			),
		[mentionAssets, referenceAssets],
	);
	const assetByBindingId = useMemo(
		() =>
			new Map(
				(data.inputs ?? []).flatMap((binding) => {
					const asset = assetById.get(binding.assetId);
					return asset ? [[binding.id, asset] as const] : [];
				}),
			),
		[data.inputs, assetById],
	);
	const mentionOptions: PromptMentionOption[] = mentionAssets.map((candidate) => ({
		type: "asset",
		candidate,
	}));

	useEffect(() => {
		draftRef.current = data;
		setHasPromptContent(hasOptimizableContent(data));
	}, [data]);

	useEffect(() => {
		let active = true;
		setIsLoadingModels(true);
		void getContentPromptOptimizationService()
			.listModels()
			.then((result) => {
				if (!active) return;
				const textModels = result.models.filter((model) => model.input.includes("text"));
				setModels(textModels);
				setSelectedModelKey((current) => {
					if (current && textModels.some((model) => model.modelKey === current)) return current;
					if (result.defaultModel && textModels.some((model) => model.modelKey === result.defaultModel)) {
						return result.defaultModel;
					}
					return textModels[0]?.modelKey;
				});
			})
			.catch((error: unknown) => {
				if (active) notifyContentCreationError(modelLoadErrorMessage, error);
			})
			.finally(() => {
				if (active) setIsLoadingModels(false);
			});
		return () => {
			active = false;
		};
	}, [modelLoadErrorMessage]);

	const updateDraft = (promptDocument: ContentPromptDocument) => {
		const referencedBindingIds = new Set(listContentPromptBindingIds(promptDocument));
		const next = {
			...draftRef.current,
			prompt: contentPromptText(promptDocument),
			promptDocument,
			inputs: (draftRef.current.inputs ?? []).filter((binding) =>
				referencedBindingIds.has(binding.id),
			),
		};
		draftRef.current = next;
		setHasPromptContent(hasOptimizableContent(next));
		return next;
	};
	const resolveMention = (option: PromptMentionOption): PromptMentionInsertion | null => {
		if (option.type !== "asset") return null;
		const candidate = option.candidate;
		const existingBinding = (draftRef.current.inputs ?? []).find(
			(binding) => binding.assetId === candidate.asset.id,
		);
		const binding =
			existingBinding ??
			({
				id: crypto.randomUUID(),
				assetId: candidate.asset.id,
				slotId: PROMPT_REFERENCE_SLOT_ID,
				sourceNodeId: candidate.sourceNodeId,
			} satisfies ContentNodeInputBinding);
		if (!existingBinding) {
			draftRef.current = {
				...draftRef.current,
				inputs: [...(draftRef.current.inputs ?? []), binding],
			};
			setHasPromptContent(true);
		}
		return { type: "asset", bindingId: binding.id, asset: candidate.asset };
	};
	const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length === 0) return;
		await onUpdate(draftRef.current);
		await onImportReferences(await Promise.all(files.map(readImportedMediaFile)));
	};
	const handleOptimize = async () => {
		if (!selectedModelKey || isOptimizing) return;
		const requestData = draftRef.current;
		const sourceSignature = contentPromptSourceSignature(requestData);
		const assetMap = new Map(
			(requestData.inputs ?? []).flatMap((binding) => {
				const asset = assetById.get(binding.assetId);
				return asset ? [[binding.id, asset] as const] : [];
			}),
		);
		setIsOptimizing(true);
		try {
			await onUpdate(requestData);
			const optimization = await getContentPromptOptimizationService().optimize({
				data: requestData,
				assetByBindingId: assetMap,
				modelKey: selectedModelKey,
			});
			if (contentPromptSourceSignature(draftRef.current) !== sourceSignature) return;
			const next = { ...draftRef.current, promptOptimization: optimization };
			draftRef.current = next;
			await onUpdate(next);
		} catch (error) {
			notifyContentCreationError(t("error.promptOptimization"), error);
		} finally {
			setIsOptimizing(false);
		}
	};

	return (
		<NodeEditorPanel
			className="min-w-0 max-w-[calc(100vw-32px)] rounded-2xl border border-border/70 bg-card/95 p-2.5 text-card-foreground shadow-lg backdrop-blur-md"
			style={{ width: "min(460px, calc(100vw - 32px))" }}
		>
			<div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 px-1">
				<div className="flex h-8 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<span className="icon-[lucide--text] block size-3.5" aria-hidden="true" />
					<span>{t("nodeEditor.prompt.original")}</span>
				</div>
				<div className="ml-auto flex min-w-0 items-center gap-1.5">
					<Select value={selectedModelKey} onValueChange={setSelectedModelKey} disabled={isLoadingModels}>
						<SelectTrigger
							size="sm"
							className="h-8 w-[min(200px,46vw)] min-w-0"
							aria-label={t("nodeEditor.promptOptimization.model")}
						>
							<SelectValue
								placeholder={
									isLoadingModels
										? t("nodeEditor.promptOptimization.loadingModels")
										: t("nodeEditor.modelUnavailable")
								}
							/>
						</SelectTrigger>
						<SelectContent className="z-[100]">
							{models.map((model) => (
								<SelectItem key={model.modelKey} value={model.modelKey}>
									{model.provider} · {model.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-8 shrink-0"
						disabled={!selectedModelKey || !hasPromptContent || isOptimizing}
						onClick={() => void handleOptimize()}
					>
						<span
							className={`icon-[lucide--wand-sparkles] block size-3.5 ${isOptimizing ? "animate-pulse" : ""}`}
							aria-hidden="true"
						/>
						<span>{isOptimizing ? t("action.optimizingPrompt") : t("action.optimizePrompt")}</span>
					</Button>
				</div>
			</div>
			<PromptRichTextInput
				document={createContentPromptDocument(data)}
				assetByBindingId={assetByBindingId}
				promptLabelByNodeId={EMPTY_PROMPT_LABELS}
				mentionOptions={mentionOptions}
				size="regular"
				placeholder={t("nodeEditor.prompt.placeholder")}
				inlineHint={t("nodeEditor.prompt.mention.inlineHint")}
				menuTitle={t("nodeEditor.prompt.mention.title")}
				emptyMessage={t("nodeEditor.prompt.mention.empty")}
				manualTitle={t("nodeEditor.prompt.mention.manual")}
				removeLabel={removeReferenceLabel}
				focusRequest={focusPromptRequest}
				onResolveMention={resolveMention}
				onChange={(document) => {
					updateDraft(document);
				}}
				onCommit={(document) => void onUpdate(updateDraft(document))}
				onUpload={() => fileInputRef.current?.click()}
				uploadTitle={t("nodeEditor.prompt.mention.upload")}
			/>
			<input
				ref={fileInputRef}
				className="hidden"
				type="file"
				multiple
				accept="image/*,video/*,audio/*"
				onChange={(event) => void handleFiles(event)}
			/>
		</NodeEditorPanel>
	);
}

function hasOptimizableContent(data: ContentNodeData): boolean {
	return createContentPromptDocument(data).segments.some(
		(segment) => segment.type !== "text" || segment.text.trim().length > 0,
	);
}
