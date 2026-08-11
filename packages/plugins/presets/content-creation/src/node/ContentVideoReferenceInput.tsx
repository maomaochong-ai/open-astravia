import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ChangeEvent, useRef } from "react";
import type { ContentModelDescriptor, ImportedContentReference } from "../generation/types";
import type { ContentAsset, ContentNodeInputBinding } from "../project/types";
import { ConnectedAssetPicker, type ConnectedReferenceOption } from "./ConnectedAssetPicker";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import { ContentReferenceInput } from "./ContentReferenceInput";
import { createImportedMediaFile } from "./imported-media-file";

interface ContentVideoReferenceInputProps {
	modeId?: string;
	model?: ContentModelDescriptor;
	references: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	connectedReferences: readonly ConnectedReferenceOption[];
	acceptedKinds: readonly ("image" | "video" | "audio")[];
	disabled: boolean;
	onImport: (files: readonly ImportedContentReference[], slotId?: string) => Promise<void>;
	onRemove: (bindingId: string) => void;
	onSelectConnected: (option: ConnectedReferenceOption) => void;
}

export function ContentVideoReferenceInput({
	modeId,
	model,
	references,
	connectedReferences,
	acceptedKinds,
	disabled,
	onImport,
	onRemove,
	onSelectConnected,
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
						reference={references.find(({ binding }) => binding.slotId === slot.id)}
						connectedReferences={connectedReferences
							.filter(({ asset }) => asset.kind === "image")
							.map((option) => ({ ...option, slotId: slot.id }))}
						disabled={disabled}
						onImport={onImport}
						onRemove={onRemove}
						onSelectConnected={onSelectConnected}
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
	connectedReferences,
	disabled,
	onImport,
	onRemove,
	onSelectConnected,
}: {
	slotId: "firstFrame" | "lastFrame";
	reference?: { binding: ContentNodeInputBinding; asset: ContentAsset };
	connectedReferences: readonly ConnectedReferenceOption[];
	disabled: boolean;
	onImport: (files: readonly ImportedContentReference[], slotId?: string) => Promise<void>;
	onRemove: (bindingId: string) => void;
	onSelectConnected: (option: ConnectedReferenceOption) => void;
}) {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (file) await onImport([await createImportedMediaFile(file)], slotId);
	};
	return (
		<div className="min-w-0 rounded-lg border border-border/65 bg-background/30 p-1.5">
		<div className="mb-1 flex items-center justify-between px-0.5 text-[10px] font-medium text-muted-foreground">
			<span>{t(`nodeEditor.videoReference.${slotId}`)}</span>
			{slotId === "lastFrame" ? <span>{t("nodeEditor.videoReference.optional")}</span> : null}
		</div>
		<div className="flex items-start gap-1.5">
			{reference ? (
				<div className="group/frame relative h-14 min-w-0 flex-1 overflow-hidden rounded-md bg-muted/45">
					<ContentAssetThumbnail asset={reference.asset} className="h-full w-full object-cover" />
					<button
						type="button"
						className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover/frame:opacity-100 focus-visible:opacity-100"
						disabled={disabled}
						aria-label={t("nodeEditor.reference.remove")}
						onClick={() => onRemove(reference.binding.id)}
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
				<ConnectedAssetPicker
					options={connectedReferences}
					disabled={disabled}
					compact
					onSelect={onSelectConnected}
				/>
			) : null}
		</div>
		<input ref={inputRef} className="hidden" type="file" accept="image/*" disabled={disabled} onChange={(event) => void handleFile(event)} />
	</div>
	);
}
