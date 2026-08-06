import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useRef } from "react";
import type {
	ContentNodeData,
	ContentNodeInputBinding,
	ContentPromptDocument,
} from "../project/types";
import {
	contentPromptText,
	createContentPromptDocument,
	listContentPromptBindingIds,
	listContentPromptSourceNodeIds,
} from "./prompt-document";
import type { ConnectedPromptSource } from "./prompt-sources";
import type { PromptMentionOption } from "./PromptMentionMenu";
import { PromptRichTextInput, type PromptMentionInsertion } from "./PromptRichTextInput";
import type { ContentAssetReferenceCandidate } from "./reference-candidates";

export interface ContentGeneratorAssetMention {
	candidate: ContentAssetReferenceCandidate;
	slotId: string;
	binding?: ContentNodeInputBinding;
}

interface ContentGeneratorPromptEditorProps {
	data: ContentNodeData;
	sources: readonly ConnectedPromptSource[];
	assetMentions: readonly ContentGeneratorAssetMention[];
	disabled: boolean;
	onDraftChange: (data: ContentNodeData) => void;
	onCommit: (data: ContentNodeData) => void;
}

export function ContentGeneratorPromptEditor({
	data,
	sources,
	assetMentions,
	disabled,
	onDraftChange,
	onCommit,
}: ContentGeneratorPromptEditorProps) {
	const { t } = useTranslation();
	const draftRef = useRef(data);
	const removeLabel = t("nodeEditor.prompt.mention.remove");
	const promptDocument = createGeneratorPromptDocument(data, sources);
	const promptLabelByNodeId = useMemo(
		() =>
			new Map(
				sources.map((source, index) => [
					source.nodeId,
					source.label?.trim() || t("nodeEditor.prompt.source.connected", { index: index + 1 }),
				]),
			),
		[sources, t],
	);
	const assetMentionById = useMemo(
		() => new Map(assetMentions.map((option) => [option.candidate.asset.id, option])),
		[assetMentions],
	);
	const assetByBindingId = useMemo(
		() =>
			new Map(
				(data.inputs ?? []).flatMap((binding) => {
					const asset = assetMentionById.get(binding.assetId)?.candidate.asset;
					return asset ? [[binding.id, asset] as const] : [];
				}),
			),
		[assetMentionById, data.inputs],
	);
	const selectedSourceIds = new Set(listContentPromptSourceNodeIds(promptDocument));
	const mentionOptions: PromptMentionOption[] = [
		...sources.flatMap((source, index): PromptMentionOption[] => {
			if (selectedSourceIds.has(source.nodeId)) return [];
			return [
				{
					type: "prompt",
					source,
					label:
						source.label?.trim() ||
						t("nodeEditor.prompt.source.connected", { index: index + 1 }),
				},
			];
		}),
		...assetMentions.map(({ candidate }): PromptMentionOption => ({ type: "asset", candidate })),
	];

	useEffect(() => {
		draftRef.current = data;
	}, [data]);

	const updateDraft = (document: ContentPromptDocument) => {
		const previousInlineBindingIds = new Set(
			draftRef.current.promptDocument
				? listContentPromptBindingIds(draftRef.current.promptDocument)
				: [],
		);
		const nextInlineBindingIds = new Set(listContentPromptBindingIds(document));
		const next = {
			...draftRef.current,
			prompt: contentPromptText(document),
			promptDocument: document,
			promptSourceNodeId: undefined,
			inputs: (draftRef.current.inputs ?? []).filter(
				(binding) =>
					!previousInlineBindingIds.has(binding.id) || nextInlineBindingIds.has(binding.id),
			),
		};
		draftRef.current = next;
		return next;
	};
	const resolveMention = (option: PromptMentionOption): PromptMentionInsertion | null => {
		if (option.type === "prompt") {
			return { type: "prompt", sourceNodeId: option.source.nodeId, label: option.label };
		}
		const candidate = option.candidate;
		const assetOption = assetMentionById.get(candidate.asset.id);
		if (!assetOption) return null;
		const binding =
			assetOption.binding ??
			({
				id: crypto.randomUUID(),
				assetId: candidate.asset.id,
				slotId: assetOption.slotId,
				sourceNodeId: candidate.sourceNodeId,
			} satisfies ContentNodeInputBinding);
		if (!assetOption.binding) {
			draftRef.current = {
				...draftRef.current,
				inputs: [...(draftRef.current.inputs ?? []), binding],
			};
		}
		return { type: "asset", bindingId: binding.id, asset: candidate.asset };
	};

	return (
		<PromptRichTextInput
			document={promptDocument}
			assetByBindingId={assetByBindingId}
			promptLabelByNodeId={promptLabelByNodeId}
			mentionOptions={mentionOptions}
			disabled={disabled}
			size="compact"
			placeholder={t("nodeEditor.generatorPrompt.placeholder")}
			inlineHint={t("nodeEditor.generatorPrompt.inlineHint")}
			menuTitle={t("nodeEditor.generatorPrompt.mention.title")}
			emptyMessage={t("nodeEditor.generatorPrompt.mention.empty")}
			manualTitle={t("nodeEditor.generatorPrompt.mention.manual")}
			removeLabel={removeLabel}
			onResolveMention={resolveMention}
			onChange={(document) => onDraftChange(updateDraft(document))}
			onCommit={(document) => onCommit(updateDraft(document))}
		/>
	);
}

function createGeneratorPromptDocument(
	data: ContentNodeData,
	sources: readonly ConnectedPromptSource[],
): ContentPromptDocument {
	const availableBindingIds = new Set((data.inputs ?? []).map(({ id }) => id));
	const inlineBindingIds = data.promptDocument
		? listContentPromptBindingIds(data.promptDocument).filter((bindingId) =>
				availableBindingIds.has(bindingId),
			)
		: [];
	const document = createContentPromptDocument(data, { bindingIds: inlineBindingIds });
	if (
		data.promptDocument ||
		data.promptSourceNodeId !== undefined ||
		data.prompt?.trim() ||
		!sources[0]
	) {
		return document;
	}
	return {
		version: 1,
		segments: [{ type: "prompt-reference", sourceNodeId: sources[0].nodeId }],
	};
}
