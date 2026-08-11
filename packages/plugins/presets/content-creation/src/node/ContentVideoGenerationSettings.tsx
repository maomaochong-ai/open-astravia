import { useTranslation } from "@vetta-org/plugin-sdk";
import { Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { resolveSupportedModelOption } from "../generation/model-options";
import type { ContentGenerationModeId, ContentModelDescriptor } from "../generation/types";
import type { ContentNodeData } from "../project/types";
import { CONTENT_GENERATION_TRIGGER_CLASS } from "./content-generation-control-styles";
import { useCanvasOverlayOutsideDismiss } from "./use-canvas-overlay-dismiss";

const AUTOMATIC_ASPECT_RATIO = "__automatic__";

type VideoGenerationMethod = "text" | "frames" | "omni";

interface ContentVideoGenerationSettingsProps {
	draft: ContentNodeData;
	model?: ContentModelDescriptor;
	resolvedAspectRatio?: string;
	onChange: (data: ContentNodeData) => void;
}

export function ContentVideoGenerationSettings({
	draft,
	model,
	resolvedAspectRatio,
	onChange,
}: ContentVideoGenerationSettingsProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const dismiss = useCallback(() => setOpen(false), []);
	useCanvasOverlayOutsideDismiss(open, triggerRef, contentRef, dismiss);
	const aspectRatios = model?.aspectRatios ?? [];
	const durations = model?.durations ?? [];
	const resolutions = model?.resolutions ?? [];
	const duration = resolveSupportedModelOption(draft.duration, durations);
	const resolution = resolveSupportedModelOption(draft.resolution, resolutions);
	const availableMethods = videoMethods(model);
	const method = resolveVideoMethod(draft.modeId, availableMethods);
	const selectedMode = model?.modes.find((candidate) => candidate.id === availableMethods[method ?? "frames"]);
	const configurableAspectRatio = selectedMode?.aspectRatioPolicy !== "input-derived";
	const aspectRatio = configurableAspectRatio ? draft.aspectRatio ?? AUTOMATIC_ASPECT_RATIO : AUTOMATIC_ASPECT_RATIO;
	const audioGeneration = selectedMode?.audioGeneration ?? "none";
	const summary = [
		t(`nodeEditor.videoSettings.method.${method ?? "unavailable"}`),
		aspectRatio === AUTOMATIC_ASPECT_RATIO
			? resolvedAspectRatio ?? t("nodeEditor.videoSettings.followImageShort")
			: aspectRatio,
		resolution,
		duration === undefined ? undefined : t("nodeEditor.videoSettings.durationSummary", { duration }),
	].filter((part): part is string => Boolean(part));

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					ref={triggerRef}
					type="button"
					className={CONTENT_GENERATION_TRIGGER_CLASS}
					aria-label={t("nodeEditor.videoSettings.open")}
					aria-expanded={open}
				>
					<span className="truncate">{summary.join(" · ")}</span>
					<span className="text-muted-foreground" aria-hidden="true">
						·
					</span>
					<span
						className={`${audioGeneration === "always" ? "icon-[lucide--volume-2]" : "icon-[lucide--volume-x]"} block size-3.5 shrink-0 text-muted-foreground`}
						aria-hidden="true"
					/>
					<span className="icon-[lucide--chevron-down] block size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				</button>
			</PopoverTrigger>
			{open ? (
				<PopoverContent
					ref={contentRef}
					data-vetta-plugin-root="content-creation"
					align="start"
					side="top"
					sideOffset={10}
					collisionPadding={12}
					className="z-[100] max-h-[min(420px,var(--radix-popover-content-available-height,420px))] gap-3 overflow-y-auto rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-md"
					style={{ width: "min(440px, calc(100vw - 32px))" }}
				>
					<SettingsSection label={t("nodeEditor.videoSettings.generateMethod")}>
						<div className={optionGroupClass("grid grid-cols-3")}>
							{(["text", "frames", "omni"] as const).map((option) => {
								const modeId = availableMethods[option];
								return (
									<button
										key={option}
										type="button"
										className={segmentedOptionClass(method === option)}
										disabled={!modeId}
										aria-pressed={method === option}
										onClick={() => {
											if (!modeId) return;
											const mode = model?.modes.find((candidate) => candidate.id === modeId);
											onChange({
												...draft,
												modeId,
												...(mode?.aspectRatioPolicy === "input-derived" ? { aspectRatio: undefined } : {}),
											});
										}}
									>
										{t(`nodeEditor.videoSettings.method.${option}`)}
										{option === "omni" ? (
											<span
												className="icon-[lucide--info] block size-3.5 shrink-0 text-muted-foreground"
												title={t("nodeEditor.videoSettings.method.omniHint")}
												aria-hidden="true"
											/>
										) : null}
									</button>
								);
							})}
						</div>
					</SettingsSection>

					{aspectRatios.length > 0 ? (
						<SettingsSection label={t("nodeEditor.aspectRatio")}>
							{/* Single row: keep every ratio chip on one line; icon height is capped so portrait frames do not blow the row. */}
							<div
								className={optionGroupClass("grid min-w-0")}
								style={{ gridTemplateColumns: equalColumns(configurableAspectRatio ? aspectRatios.length + 1 : 1) }}
							>
								<AspectRatioOption
									label={t("nodeEditor.videoSettings.followImageShort")}
									ratio={resolvedAspectRatio}
									selected={aspectRatio === AUTOMATIC_ASPECT_RATIO}
									title={t("nodeEditor.videoSettings.followImageSummary", {
										ratio: resolvedAspectRatio ?? aspectRatios[0] ?? "",
									})}
									onClick={() => onChange({ ...draft, aspectRatio: undefined })}
								/>
								{configurableAspectRatio ? aspectRatios.map((option) => (
									<AspectRatioOption
										key={option}
										label={option}
										ratio={option}
										selected={aspectRatio === option}
										onClick={() => onChange({ ...draft, aspectRatio: option })}
									/>
								)) : null}
							</div>
						</SettingsSection>
					) : null}

					{resolutions.length > 0 ? (
						<SettingsSection label={t("nodeEditor.resolution")}>
							<div
								className={optionGroupClass("grid")}
								style={{ gridTemplateColumns: equalColumns(resolutions.length) }}
							>
								{resolutions.map((option) => (
									<button
										key={option}
										type="button"
										className={segmentedOptionClass(resolution === option)}
										aria-pressed={resolution === option}
										onClick={() => onChange({ ...draft, resolution: option })}
									>
										{t(`option.resolution.${option}`)}
									</button>
								))}
							</div>
						</SettingsSection>
					) : null}

					{durations.length > 0 ? (
						<SettingsSection label={t("nodeEditor.duration")}>
							<div className={optionGroupClass("flex min-w-0 overflow-x-auto")}>
								{durations.map((option) => (
									<button
										key={option}
										type="button"
										className={`${segmentedOptionClass(duration === option)} min-w-12 flex-1`}
										aria-pressed={duration === option}
										onClick={() => onChange({ ...draft, duration: option })}
									>
										{t("option.duration.seconds", { duration: option })}
									</button>
								))}
							</div>
						</SettingsSection>
					) : null}

					<SettingsSection
						label={t("nodeEditor.videoSettings.generateAudio")}
						hint={t(
							audioGeneration === "always"
								? "nodeEditor.videoSettings.audioAlways"
								: "nodeEditor.videoSettings.audioUnsupported",
						)}
					>
						<div
							className={optionGroupClass("grid grid-cols-2")}
							title={t(
								audioGeneration === "always"
									? "nodeEditor.videoSettings.audioAlways"
									: "nodeEditor.videoSettings.audioUnsupported",
							)}
						>
							<button
								type="button"
								className={`${segmentedOptionClass(audioGeneration === "always")} disabled:opacity-100`}
								disabled
								aria-pressed={audioGeneration === "always"}
							>
								{t("nodeEditor.videoSettings.audio.on")}
							</button>
							<button
								type="button"
								className={`${segmentedOptionClass(audioGeneration !== "always")} disabled:opacity-100`}
								disabled
								aria-pressed={audioGeneration !== "always"}
							>
								{t("nodeEditor.videoSettings.audio.off")}
							</button>
						</div>
					</SettingsSection>
				</PopoverContent>
			) : null}
		</Popover>
	);
}

function SettingsSection({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<section className="grid gap-1">
			<div className="flex items-center gap-1 px-1 text-[11px] font-medium text-muted-foreground">
				<span>{label}</span>
				{hint ? (
					<span className="icon-[lucide--circle-help] block size-3.5" title={hint} aria-hidden="true" />
				) : null}
			</div>
			{children}
		</section>
	);
}

function AspectRatioOption({
	label,
	ratio,
	selected,
	title,
	onClick,
}: {
	label: string;
	ratio?: string;
	selected: boolean;
	title?: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={`flex min-h-10 min-w-0 flex-col items-center justify-center gap-1 rounded-md border px-1 py-1.5 text-[12px] font-medium outline-none transition-colors focus-visible:border-primary ${
				selected
					? "border-border bg-accent text-accent-foreground"
					: "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
			}`}
			aria-pressed={selected}
			title={title}
			onClick={onClick}
		>
			{/* Fixed visual budget: landscape/portrait icons scale inside, never grow the cell. */}
			<span className="flex h-3 w-5 shrink-0 items-center justify-center" aria-hidden="true">
				<span
					className="block rounded-[2px] border border-current"
					style={aspectRatioIconStyle(ratio)}
				/>
			</span>
			<span className="max-w-full truncate text-[10px] leading-none">{label}</span>
		</button>
	);
}

function videoMethods(model?: ContentModelDescriptor): Partial<Record<VideoGenerationMethod, ContentGenerationModeId>> {
	if (!model) return {};
	const modeIds = new Set(model.modes.map(({ id }) => id));
	return {
		...(modeIds.has("text-to-video") ? { text: "text-to-video" as const } : {}),
		...(modeIds.has("image-to-video") ? { frames: "image-to-video" as const } : {}),
		...(modeIds.has("reference-to-video")
			? { omni: "reference-to-video" as const }
			: modeIds.has("video-to-video")
				? { omni: "video-to-video" as const }
				: {}),
	};
}

function resolveVideoMethod(
	modeId: string | undefined,
	methods: Partial<Record<VideoGenerationMethod, ContentGenerationModeId>>,
): VideoGenerationMethod | null {
	if (methods.text && modeId === methods.text) return "text";
	if (methods.frames && modeId === methods.frames) return "frames";
	if (methods.omni && modeId === methods.omni) return "omni";
	if (methods.text) return "text";
	if (methods.frames) return "frames";
	if (methods.omni) return "omni";
	return null;
}

function segmentedOptionClass(selected: boolean): string {
	return `flex h-9 items-center justify-center gap-1.5 rounded-md border px-2 text-[12px] font-medium outline-none transition-colors focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 ${
		selected
			? "border-border bg-accent text-accent-foreground"
			: "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
	}`;
}

function optionGroupClass(layout: string): string {
	return `${layout} rounded-lg border border-border bg-card p-1`;
}

function equalColumns(count: number): string {
	return `repeat(${Math.max(count, 1)}, minmax(0, 1fr))`;
}

function aspectRatioIconStyle(ratio?: string): { width: number; height: number } {
	// Keep icons inside the fixed h-3 / w-5 slot so 9:16 frames stay level with 16:9.
	const maxWidth = 16;
	const maxHeight = 12;
	const fallback = { width: 14, height: 9 };
	if (!ratio) return fallback;
	const [widthPart, heightPart] = ratio.split(":").map(Number);
	if (!(widthPart > 0) || !(heightPart > 0)) return fallback;
	const scale = Math.min(maxWidth / widthPart, maxHeight / heightPart);
	return {
		width: Math.max(6, Math.round(widthPart * scale)),
		height: Math.max(6, Math.round(heightPart * scale)),
	};
}
