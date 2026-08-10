import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ChangeEvent, useRef } from "react";
import type { ContentReferenceKind, ImportedContentReference } from "../generation/types";
import type { ContentAsset, ContentNodeInputBinding } from "../project/types";
import { ContentAssetThumbnail } from "./ContentAssetThumbnail";
import { ConnectedAssetPicker, type ConnectedReferenceOption } from "./ConnectedAssetPicker";
import { createImportedMediaFile } from "./imported-media-file";

interface ContentReferenceInputProps {
	references: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	connectedReferences: readonly ConnectedReferenceOption[];
	acceptedKinds: readonly ContentReferenceKind[];
	disabled: boolean;
	compact?: boolean;
	onImport: (files: readonly ImportedContentReference[]) => Promise<void>;
	onRemove: (bindingId: string) => void;
	onSelectConnected: (option: ConnectedReferenceOption) => void;
}

export function ContentReferenceInput({
	references,
	connectedReferences,
	acceptedKinds,
	disabled,
	compact = false,
	onImport,
	onRemove,
	onSelectConnected,
}: ContentReferenceInputProps) {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const accept = acceptedKinds.map((kind) => `${kind}/*`).join(",");
	const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length === 0) return;
		await onImport(await Promise.all(files.map((file) => createImportedMediaFile(file))));
	};

	return (
		<div className={`flex flex-wrap items-start gap-1.5 ${compact ? "min-h-10" : "min-h-14"}`}>
			{references.map(({ binding, asset }, index) => (
				<div
					key={binding.id}
					className={`group/reference relative shrink-0 overflow-hidden rounded-lg border border-border/75 bg-muted/45 ${compact ? "size-10" : "size-14"}`}
				>
					<ContentAssetThumbnail
						asset={asset}
						className="flex h-full w-full items-center justify-center object-cover text-muted-foreground"
					/>
					<span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-black/75 text-[8px] font-semibold text-white">
						{index + 1}
					</span>
					<button
						type="button"
						className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover/reference:opacity-100 focus-visible:opacity-100"
						disabled={disabled}
						title={t("nodeEditor.reference.remove")}
						aria-label={t("nodeEditor.reference.remove")}
						onClick={() => onRemove(binding.id)}
					>
						<span className="icon-[lucide--x] block size-4 shrink-0" aria-hidden="true" />
					</button>
				</div>
			))}
			<button
				type="button"
				className={`flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-background/35 text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "size-10" : "size-14"}`}
				disabled={disabled || acceptedKinds.length === 0}
				title={
					acceptedKinds.length === 0
						? t("nodeEditor.reference.unsupported")
						: t("nodeEditor.reference.add")
				}
				aria-label={t("nodeEditor.reference.add")}
				onClick={() => inputRef.current?.click()}
			>
				<span className="icon-[lucide--paperclip] block size-4.5 shrink-0" aria-hidden="true" />
			</button>
			<input
				ref={inputRef}
				className="hidden"
				type="file"
				multiple
				accept={accept}
				disabled={disabled || acceptedKinds.length === 0}
				onChange={(event) => void handleFiles(event)}
			/>
			<ConnectedAssetPicker
				options={connectedReferences}
				disabled={disabled}
				compact={compact}
				onSelect={onSelectConnected}
			/>
		</div>
	);
}
