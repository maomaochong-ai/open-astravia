import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ChangeEvent, useRef } from "react";
import type { ContentModelDescriptor, ImportedContentReference } from "../generation/types";
import type { ContentAsset, ContentNodeInputBinding } from "../project/types";
import { ConnectedAssetPicker, type ConnectedReferenceOption } from "./ConnectedAssetPicker";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import { ContentReferenceInput } from "./ContentReferenceInput";
import { createImportedMediaFile } from "./imported-media-file";
import {
	ContentAssetPicker,
	type ContentAssetPickerOption,
} from "./ContentAssetPicker";
import type { ContentAssetReferenceCandidate } from "./reference-candidates";
import type { ContentKeyframeReference, ContentKeyframeSlotId } from "./keyframe-sources";

interface ContentVideoReferenceInputProps {
	modeId?: string;
	model?: ContentModelDescriptor;
	references: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	connectedReferences: readonly ConnectedReferenceOption[];
	keyframeReferences: readonly ContentKeyframeReference[];
	keyframeCandidates: readonly ContentAssetReferenceCandidate[];
	acceptedKinds: readonly ("image" | "video" | "audio")[];
	disabled: boolean;
	onImport: (files: readonly ImportedContentReference[], slotId?: string) => Promise<void>;
	onRemove: (bindingId: string) => void;
	onSelectConnected: (option: ConnectedReferenceOption) => void;
	onSelectKeyframe: (slotId: ContentKeyframeSlotId, candidate: ContentAssetReferenceCandidate) => void;
	onRemoveKeyframe: (slotId: ContentKeyframeSlotId) => void;
}

export function ContentVideoReferenceInput({
	modeId,
	model,
	references,
	connectedReferences,
	keyframeReferences,
	keyframeCandidates,
	acceptedKinds,
	disabled,
	onImport,
	onRemove,
	onSelectConnected,
	onSelectKeyframe,
	onRemoveKeyframe,
}: ContentVideoReferenceInputProps) {
	const mode = model?.modes.find((candidate) => candidate.id === modeId) ?? model?.modes[0];
	const frameSlots = mode?.inputs.filter((slot) => slot.id === "firstFrame" || slot.id === "lastFrame") ?? [];
	if (frameSlots.length > 0) {
		return (
			<div className="grid grid-cols-2 gap-2">
				{frameSlots.map((slot) => (
					<FrameInput
						key={slot.id}
						slotId={slot.id as "firstFrame" | "lastFrame"}
						reference={keyframeReferences.find((reference) => reference.slotId === slot.id)}
						candidates={keyframeCandidates}
						disabled={disabled}
						onImport={onImport}
						onRemove={onRemoveKeyframe}
						onSelect={onSelectKeyframe}
					/>
				))}
			</div>
		);
	}
	return (
		<ContentReferenceInput
			compact
			numberByKind
			references={references}
			connectedReferences={connectedReferences}
			acceptedKinds={acceptedKinds}
			disabled={disabled}
			onImport={onImport}
			onRemove={onRemove}
			onSelectConnected={onSelectConnected}
		/>
	);
}

function FrameInput({
	slotId,
	reference,
	candidates,
	disabled,
	onImport,
	onRemove,
	onSelect,
}: {
	slotId: ContentKeyframeSlotId;
	reference?: ContentKeyframeReference;
	candidates: readonly ContentAssetReferenceCandidate[];
	disabled: boolean;
	onImport: (files: readonly ImportedContentReference[], slotId?: string) => Promise<void>;
	onRemove: (slotId: ContentKeyframeSlotId) => void;
	onSelect: (slotId: ContentKeyframeSlotId, candidate: ContentAssetReferenceCandidate) => void;
}) {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (file) await onImport([await createImportedMediaFile(file)], slotId);
	};
	const pickerOptions = candidates
		.filter((candidate) => candidate.asset.kind === "image" && candidate.asset.id !== reference?.asset.id)
		.map(
			(candidate): ContentAssetPickerOption & { candidate: ContentAssetReferenceCandidate } => ({
				id: `${candidate.origin}:${candidate.sourceNodeId ?? "project"}:${candidate.asset.id}`,
				asset: candidate.asset,
				source: candidate.sourceNodeId ? "workflow" : "project",
				candidate,
			}),
		);
	return (
		<div className="min-w-0 rounded-lg border border-border/65 bg-background/30 p-1.5">
		<div className="mb-1 flex items-center justify-between px-0.5 text-[10px] font-medium text-muted-foreground">
			<span>{t(`nodeEditor.videoReference.${slotId}`)}</span>
			{slotId === "lastFrame" ? <span>{t("nodeEditor.videoReference.optional")}</span> : null}
		</div>
		<div className="flex flex-wrap items-start gap-1.5">
			{reference ? (
				<div className="group/frame relative h-14 min-w-0 flex-1 overflow-hidden rounded-md bg-muted/45">
					<ContentAssetThumbnail asset={reference.asset} className="h-full w-full object-cover" />
					<button
						type="button"
						className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover/frame:opacity-100 focus-visible:opacity-100"
						disabled={disabled}
						aria-label={t("nodeEditor.reference.remove")}
						onClick={() => onRemove(slotId)}
					>
						<span className="icon-[lucide--x] block size-4" aria-hidden="true" />
					</button>
				</div>
			) : (
				<button
					type="button"
					className="flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:border-primary/45 hover:text-foreground disabled:opacity-40"
					disabled={disabled}
					onClick={() => inputRef.current?.click()}
				>
					<span className="icon-[lucide--image-plus] block size-4" aria-hidden="true" />
					<span>{t("nodeEditor.videoReference.addFrame")}</span>
				</button>
			)}
			{!reference ? (
				<ContentAssetPicker
					options={pickerOptions}
					disabled={disabled}
					compact
					labelKey="nodeEditor.videoReference.chooseExisting"
					onSelect={(option) => onSelect(slotId, option.candidate)}
				/>
			) : null}
		</div>
		<input ref={inputRef} className="hidden" type="file" accept="image/*" disabled={disabled} onChange={(event) => void handleFile(event)} />
	</div>
	);
}
