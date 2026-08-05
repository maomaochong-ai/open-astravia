import { useTranslation } from "@vetta-org/plugin-sdk";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ImportedContentReference } from "../generation/types";
import type { ContentAsset, ContentNodeData, ContentNodeInputBinding } from "../project/types";
import { ContentReferenceInput } from "./ContentReferenceInput";
import type { ConnectedContentAsset } from "./material-assets";
import { PROMPT_REFERENCE_SLOT_ID } from "./prompt-sources";

interface ContentPromptEditorProps {
	data: ContentNodeData;
	connectedAssets: readonly ConnectedContentAsset[];
	referenceAssets: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	focusPromptRequest: number;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onImportReferences: (files: readonly ImportedContentReference[]) => Promise<void>;
}

export function ContentPromptEditor({
	data,
	connectedAssets,
	referenceAssets,
	focusPromptRequest,
	onUpdate,
	onImportReferences,
}: ContentPromptEditorProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState(data);
	const promptInputRef = useRef<HTMLTextAreaElement>(null);
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
	const references = (draft.inputs ?? []).flatMap((binding) => {
		const asset = assetById.get(binding.assetId);
		return asset ? [{ binding, asset }] : [];
	});
	const selectedAssetIds = new Set(references.map(({ asset }) => asset.id));
	const connectedReferences = connectedAssets
		.filter(({ asset }) => !selectedAssetIds.has(asset.id))
		.map((candidate) => ({ ...candidate, slotId: PROMPT_REFERENCE_SLOT_ID }));

	useEffect(() => setDraft(data), [data]);
	useEffect(() => {
		if (focusPromptRequest === 0) return;
		const frame = window.requestAnimationFrame(() => {
			const input = promptInputRef.current;
			if (!input) return;
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusPromptRequest]);

	const commit = (next: ContentNodeData) => {
		setDraft(next);
		void onUpdate(next);
	};
	const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey) return;
		event.preventDefault();
		void onUpdate(draft);
	};

	return (
		<div
			className="nodrag nowheel min-w-0 max-w-[calc(100vw-32px)] rounded-2xl border border-border/70 bg-card/95 p-2.5 text-card-foreground shadow-lg backdrop-blur-md"
			style={{ width: "min(380px, calc(100vw - 32px))" }}
			onPointerDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<div className="overflow-hidden rounded-xl border border-border/65 bg-background/40 focus-within:border-primary/45">
				<textarea
					ref={promptInputRef}
					className="min-h-24 w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
					value={draft.prompt ?? ""}
					placeholder={t("nodeEditor.prompt.placeholder")}
					onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
					onBlur={() => void onUpdate(draft)}
					onKeyDown={handlePromptKeyDown}
				/>
				<div className="border-t border-border/55 px-2 py-1.5">
					<ContentReferenceInput
						references={references}
						connectedReferences={connectedReferences}
						acceptedKinds={["image", "video", "audio"]}
						disabled={false}
						onImport={async (files) => {
							await onUpdate(draft);
							await onImportReferences(files);
						}}
						onRemove={(bindingId) => {
							commit({
								...draft,
								inputs: (draft.inputs ?? []).filter((binding) => binding.id !== bindingId),
							});
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
				</div>
			</div>
			<p className="m-0 mt-1.5 px-1 text-[10px] text-muted-foreground">
				{t("nodeEditor.prompt.materialHint")}
			</p>
		</div>
	);
}
