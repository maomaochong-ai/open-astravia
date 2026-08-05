import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ChangeEvent, useEffect, useMemo, useRef } from "react";
import type { ImportedContentReference } from "../generation/types";
import type {
	ContentAsset,
	ContentNodeData,
	ContentNodeInputBinding,
	ContentPromptDocument,
} from "../project/types";
import {
	contentPromptText,
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
	const removeReferenceLabel = t("nodeEditor.reference.remove");
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
	}, [data]);

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

	return (
		<NodeEditorPanel
			className="min-w-0 max-w-[calc(100vw-32px)] rounded-2xl border border-border/70 bg-card/95 p-2.5 text-card-foreground shadow-lg backdrop-blur-md"
			style={{ width: "min(420px, calc(100vw - 32px))" }}
		>
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
