import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import { useState } from "react";
import type { ContentModelDescriptor } from "../generation/types";
import type { ContentNodeData, ContentNodeKind } from "../project/types";
import { ContentVideoGenerationSettings } from "./ContentVideoGenerationSettings";

const AUTO_TRIGGER_CLASS = "w-fit max-w-none flex-none border-0 bg-transparent shadow-none";
const AUTO_VALUE_CLASS = "line-clamp-none! overflow-visible! whitespace-nowrap";
const AUTOMATIC_ASPECT_RATIO = "__automatic__";

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
	const [openSelect, setOpenSelect] = useState<"model" | "aspect-ratio" | "quality" | null>(null);
	const modelValue = selectedModel ? `${selectedModel.providerId}\u0000${selectedModel.modelId}` : undefined;
	const aspectRatios = selectedModel?.aspectRatios ?? [];
	const aspectRatio = kind === "video-generator" && !draft.aspectRatio
		? AUTOMATIC_ASPECT_RATIO
		: draft.aspectRatio ?? aspectRatios[0];
	const quality = draft.quality ?? "standard";

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border/45 pt-2.5">
			<div className="flex h-8 items-center gap-1.5 px-1.5 text-xs font-medium text-muted-foreground">
				<span className="icon-[lucide--image] block size-3.5 shrink-0" aria-hidden="true" />
				<span>{t(`node.kind.${kind}`)}</span>
			</div>
			<Select
				open={openSelect === "model"}
				onOpenChange={(open) => setOpenSelect(open ? "model" : null)}
				value={modelValue}
				onValueChange={(value) => {
					const model = models.find((candidate) => `${candidate.providerId}\u0000${candidate.modelId}` === value);
					if (model) onModelChange(model);
				}}
			>
				<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
					<SelectValue className={AUTO_VALUE_CLASS} placeholder={t("nodeEditor.modelUnavailable")}>
						{selectedModel ? `${t(`provider.${selectedModel.providerId}`)} · ${selectedModel.displayName}` : undefined}
					</SelectValue>
				</SelectTrigger>
				{openSelect === "model" ? (
					<SelectContent className="z-[100]">
						{models.map((model) => (
							<SelectItem
								key={`${model.providerId}:${model.modelId}`}
								value={`${model.providerId}\u0000${model.modelId}`}
							>
								{t(`provider.${model.providerId}`)} · {model.displayName}
							</SelectItem>
						))}
					</SelectContent>
				) : null}
			</Select>
			{aspectRatios.length > 0 ? (
				<Select
					open={openSelect === "aspect-ratio"}
					onOpenChange={(open) => setOpenSelect(open ? "aspect-ratio" : null)}
					value={aspectRatio}
					onValueChange={(nextAspectRatio) =>
						onChange({
							...draft,
							aspectRatio: nextAspectRatio === AUTOMATIC_ASPECT_RATIO ? undefined : nextAspectRatio,
						})
					}
				>
					<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
						<SelectValue className={AUTO_VALUE_CLASS}>
							{aspectRatio === AUTOMATIC_ASPECT_RATIO
								? t("option.aspectRatio.auto", {
										ratio: resolvedAspectRatio ? t(`option.aspectRatio.${resolvedAspectRatio}`) : "",
									})
								: t(`option.aspectRatio.${aspectRatio}`)}
						</SelectValue>
					</SelectTrigger>
					{openSelect === "aspect-ratio" ? (
						<SelectContent className="z-[100]">
							{kind === "video-generator" ? (
								<SelectItem value={AUTOMATIC_ASPECT_RATIO}>
									{t("option.aspectRatio.auto", {
										ratio: resolvedAspectRatio ? t(`option.aspectRatio.${resolvedAspectRatio}`) : "",
									})}
								</SelectItem>
							) : null}
							{aspectRatios.map((option) => (
								<SelectItem key={option} value={option}>
									{t(`option.aspectRatio.${option}`)}
								</SelectItem>
							))}
						</SelectContent>
					) : null}
				</Select>
			) : null}
			{kind === "image-generator" ? (
				<Select
					open={openSelect === "quality"}
					onOpenChange={(open) => setOpenSelect(open ? "quality" : null)}
					value={quality}
					onValueChange={(nextQuality) => onChange({ ...draft, quality: nextQuality })}
				>
					<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
						<SelectValue className={AUTO_VALUE_CLASS}>{t(`option.quality.${quality}`)}</SelectValue>
					</SelectTrigger>
					{openSelect === "quality" ? (
						<SelectContent className="z-[100]">
							{["standard", "hd", "ultra"].map((option) => (
								<SelectItem key={option} value={option}>
									{t(`option.quality.${option}`)}
								</SelectItem>
							))}
						</SelectContent>
					) : null}
				</Select>
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
