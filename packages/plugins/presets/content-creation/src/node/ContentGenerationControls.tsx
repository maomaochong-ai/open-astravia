import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta/ui";
import type { ContentModelDescriptor } from "../generation/types";
import type { ContentNodeData, ContentNodeKind } from "../project/types";

const AUTO_TRIGGER_CLASS = "w-fit max-w-none flex-none border-0 bg-transparent shadow-none";
const AUTO_VALUE_CLASS = "line-clamp-none! overflow-visible! whitespace-nowrap";

interface ContentGenerationControlsProps {
	kind: Extract<ContentNodeKind, "image-generator" | "video-generator">;
	draft: ContentNodeData;
	models: readonly ContentModelDescriptor[];
	selectedModel?: ContentModelDescriptor;
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
	isRunning,
	canGenerate,
	onChange,
	onModelChange,
	onSubmit,
}: ContentGenerationControlsProps) {
	const { t } = useTranslation();
	const modelValue = selectedModel ? `${selectedModel.providerId}\u0000${selectedModel.modelId}` : undefined;
	const aspectRatios = selectedModel?.aspectRatios ?? [];

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border/45 pt-2.5">
			<div className="flex h-8 items-center gap-1.5 px-1.5 text-xs font-medium text-muted-foreground">
				<span className="icon-[lucide--image] block size-3.5 shrink-0" aria-hidden="true" />
				<span>{t(`node.kind.${kind}`)}</span>
			</div>
			<Select
				value={modelValue}
				onValueChange={(value) => {
					const model = models.find((candidate) => `${candidate.providerId}\u0000${candidate.modelId}` === value);
					if (model) onModelChange(model);
				}}
			>
				<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
					<SelectValue className={AUTO_VALUE_CLASS} placeholder={t("nodeEditor.modelUnavailable")} />
				</SelectTrigger>
				<SelectContent className="z-[100]">
					{models.map((model) => (
						<SelectItem key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}\u0000${model.modelId}`}>
							{t(`provider.${model.providerId}`)} · {model.displayName}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{aspectRatios.length > 0 ? (
				<Select value={draft.aspectRatio ?? aspectRatios[0]} onValueChange={(aspectRatio) => onChange({ ...draft, aspectRatio })}>
					<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
						<SelectValue className={AUTO_VALUE_CLASS} />
					</SelectTrigger>
					<SelectContent className="z-[100]">
						{aspectRatios.map((aspectRatio) => (
							<SelectItem key={aspectRatio} value={aspectRatio}>
								{t(`option.aspectRatio.${aspectRatio}`)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
			{kind === "image-generator" ? (
				<Select value={draft.quality ?? "standard"} onValueChange={(quality) => onChange({ ...draft, quality })}>
					<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
						<SelectValue className={AUTO_VALUE_CLASS} />
					</SelectTrigger>
					<SelectContent className="z-[100]">
						{["standard", "hd", "ultra"].map((quality) => (
							<SelectItem key={quality} value={quality}>
								{t(`option.quality.${quality}`)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<VideoControls draft={draft} model={selectedModel} onChange={onChange} />
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

function VideoControls({
	draft,
	model,
	onChange,
}: {
	draft: ContentNodeData;
	model?: ContentModelDescriptor;
	onChange: (data: ContentNodeData) => void;
}) {
	const { t } = useTranslation();
	const durations = model?.durations ?? [];
	const resolutions = model?.resolutions ?? [];
	return (
		<>
			{durations.length > 0 ? (
				<Select
					value={String(draft.duration ?? durations[0])}
					onValueChange={(duration) => onChange({ ...draft, duration: Number(duration) })}
				>
					<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
						<SelectValue className={AUTO_VALUE_CLASS} />
					</SelectTrigger>
					<SelectContent className="z-[100]">
						{durations.map((duration) => (
							<SelectItem key={duration} value={String(duration)}>
								{t("option.duration.seconds", { duration })}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
			{resolutions.length > 0 ? (
				<Select
					value={draft.resolution ?? resolutions[0]}
					onValueChange={(resolution) => onChange({ ...draft, resolution })}
				>
					<SelectTrigger size="sm" className={AUTO_TRIGGER_CLASS}>
						<SelectValue className={AUTO_VALUE_CLASS} />
					</SelectTrigger>
					<SelectContent className="z-[100]">
						{resolutions.map((resolution) => (
							<SelectItem key={resolution} value={resolution}>
								{t(`option.resolution.${resolution}`)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
		</>
	);
}
