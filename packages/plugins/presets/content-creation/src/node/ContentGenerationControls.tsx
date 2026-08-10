import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@vetta/ui";
import { useCallback, useRef, useState } from "react";
import type { ContentModelDescriptor } from "../generation/types";
import type { ContentNodeData, ContentNodeKind } from "../project/types";
import { CONTENT_GENERATION_TRIGGER_CLASS } from "./content-generation-control-styles";
import { ContentVideoGenerationSettings } from "./ContentVideoGenerationSettings";
import { useCanvasOverlayOutsideDismiss } from "./use-canvas-overlay-dismiss";

interface ContentGenerationControlsProps {
	kind: Extract<ContentNodeKind, "image-generator" | "video-generator">;
	draft: ContentNodeData;
	models: readonly ContentModelDescriptor[];
	selectedModel?: ContentModelDescriptor;
	resolvedAspectRatio?: string;
	isRunning: boolean;
	canGenerate: boolean;
	onChange: (data: ContentNodeData) => void;
	onModelChange: (model: ContentModelDescriptor) => void;
	onSubmit: () => void;
}

export function ContentGenerationControls({
	kind,
	draft,
	models,
	selectedModel,
	resolvedAspectRatio,
	isRunning,
	canGenerate,
	onChange,
	onModelChange,
	onSubmit,
}: ContentGenerationControlsProps) {
	const { t } = useTranslation();
	const modelValue = selectedModel ? `${selectedModel.providerId}\u0000${selectedModel.modelId}` : undefined;
	const aspectRatios = selectedModel?.aspectRatios ?? [];
	const aspectRatio = draft.aspectRatio ?? aspectRatios[0];
	const quality = draft.quality ?? "standard";

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border/45 pt-2.5">
			<div className="flex h-8 items-center gap-1.5 px-1.5 text-xs font-medium text-muted-foreground">
				<span className="icon-[lucide--image] block size-3.5 shrink-0" aria-hidden="true" />
				<span>{t(`node.kind.${kind}`)}</span>
			</div>
			<ContentOptionMenu
				value={modelValue}
				label={
					selectedModel
						? `${t(`provider.${selectedModel.providerId}`)} · ${selectedModel.displayName}`
						: t("nodeEditor.modelUnavailable")
				}
				options={models.map((model) => ({
					value: `${model.providerId}\u0000${model.modelId}`,
					label: `${t(`provider.${model.providerId}`)} · ${model.displayName}`,
				}))}
				onValueChange={(value) => {
					const model = models.find((candidate) => `${candidate.providerId}\u0000${candidate.modelId}` === value);
					if (model) onModelChange(model);
				}}
			/>
			{kind === "image-generator" && aspectRatios.length > 0 ? (
				<ContentOptionMenu
					value={aspectRatio}
					label={t(`option.aspectRatio.${aspectRatio}`)}
					options={aspectRatios.map((option) => ({
						value: option,
						label: t(`option.aspectRatio.${option}`),
					}))}
					onValueChange={(nextAspectRatio) => onChange({ ...draft, aspectRatio: nextAspectRatio })}
				/>
			) : null}
			{kind === "image-generator" ? (
				<ContentOptionMenu
					value={quality}
					label={t(`option.quality.${quality}`)}
					options={["standard", "hd", "ultra"].map((option) => ({
						value: option,
						label: t(`option.quality.${option}`),
					}))}
					onValueChange={(nextQuality) => onChange({ ...draft, quality: nextQuality })}
				/>
			) : (
				<ContentVideoGenerationSettings
					draft={draft}
					model={selectedModel}
					resolvedAspectRatio={resolvedAspectRatio}
					onChange={onChange}
				/>
			)}
			<Button
				type="button"
				size="icon"
				variant="primary"
				className="ml-auto size-10 shrink-0 rounded-full"
				disabled={!canGenerate}
				title={isRunning ? t("action.generating") : t("action.generate")}
				aria-label={isRunning ? t("action.generating") : t("action.generate")}
				onClick={onSubmit}
			>
				<span className="icon-[lucide--arrow-up] block size-5 shrink-0" aria-hidden="true" />
			</Button>
		</div>
	);
}

interface ContentOptionMenuProps {
	value?: string;
	label: string;
	options: readonly { value: string; label: string }[];
	onValueChange: (value: string) => void;
}

function ContentOptionMenu({ value, label, options, onValueChange }: ContentOptionMenuProps) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const dismiss = useCallback(() => setOpen(false), []);
	useCanvasOverlayOutsideDismiss(open, triggerRef, contentRef, dismiss);

	return (
		<DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button
					ref={triggerRef}
					type="button"
					className={CONTENT_GENERATION_TRIGGER_CLASS}
					aria-expanded={open}
				>
					<span className="truncate">{label}</span>
					<span className="icon-[lucide--chevron-down] block size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				</button>
			</DropdownMenuTrigger>
			{open ? (
				<DropdownMenuContent
					ref={contentRef}
					data-vetta-plugin-root="content-creation"
					align="start"
					className="z-[100] min-w-36 rounded-lg p-1"
				>
					<DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
						{options.map((option) => (
							<DropdownMenuRadioItem
								key={option.value}
								value={option.value}
								className="rounded-md px-2 py-[5px] pr-8 text-[12px] font-medium focus:bg-accent data-highlighted:bg-accent"
							>
								{option.label}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			) : null}
		</DropdownMenu>
	);
}
