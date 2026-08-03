import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ChangeEvent, useRef } from "react";
import type { ContentReferenceKind, ImportedContentReference } from "../generation/types";
import type { ContentAsset, ContentNodeInputBinding } from "../project/types";
import { CloseIcon, ImageIcon } from "../shared/icons";

interface ContentReferenceInputProps {
	references: readonly { binding: ContentNodeInputBinding; asset: ContentAsset }[];
	acceptedKinds: readonly ContentReferenceKind[];
	disabled: boolean;
	onImport: (files: readonly ImportedContentReference[]) => Promise<void>;
	onRemove: (bindingId: string) => void;
}

export function ContentReferenceInput({
	references,
	acceptedKinds,
	disabled,
	onImport,
	onRemove,
}: ContentReferenceInputProps) {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLInputElement>(null);
	const accept = acceptedKinds.map((kind) => `${kind}/*`).join(",");
	const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length === 0) return;
		await onImport(await Promise.all(files.map(readReferenceFile)));
	};

	return (
		<div className="flex min-h-14 flex-wrap items-start gap-1.5">
			{references.map(({ binding, asset }, index) => (
				<div
					key={binding.id}
					className="group/reference relative size-14 shrink-0 overflow-hidden rounded-lg border border-border/75 bg-muted/45"
				>
					{asset.kind === "video" ? (
						<video className="h-full w-full object-cover" src={asset.url} muted preload="metadata" />
					) : (
						<img className="h-full w-full object-cover" src={asset.url} alt={asset.name} />
					)}
					<span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-black/75 text-[8px] font-semibold text-white">
						{index + 1}
					</span>
					<button
						type="button"
						className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity group-hover/reference:opacity-100 focus-visible:opacity-100"
						title={t("nodeEditor.reference.remove")}
						aria-label={t("nodeEditor.reference.remove")}
						onClick={() => onRemove(binding.id)}
					>
						<CloseIcon className="size-4" />
					</button>
				</div>
			))}
			<button
				type="button"
				className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-background/35 text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
				disabled={disabled || acceptedKinds.length === 0}
				title={
					acceptedKinds.length === 0
						? t("nodeEditor.reference.unsupported")
						: t("nodeEditor.reference.add")
				}
				aria-label={t("nodeEditor.reference.add")}
				onClick={() => inputRef.current?.click()}
			>
				<ImageIcon className="size-4.5" />
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
		</div>
	);
}

async function readReferenceFile(file: File): Promise<ImportedContentReference> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => reject(reader.error ?? new Error("failed to read content reference"));
		reader.readAsDataURL(file);
	});
	const separator = dataUrl.indexOf(",");
	if (separator < 0) throw new Error("content reference is not a valid data URL");
	return { name: file.name, mimeType: file.type || inferMimeType(file.name), data: dataUrl.slice(separator + 1) };
}

function inferMimeType(fileName: string): string {
	const extension = fileName.split(".").at(-1)?.toLowerCase();
	if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	if (extension === "png") return "image/png";
	if (extension === "webp") return "image/webp";
	if (extension === "mov") return "video/quicktime";
	if (extension === "webm") return "video/webm";
	if (extension === "mp4") return "video/mp4";
	return "application/octet-stream";
}
