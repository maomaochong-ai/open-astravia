import { useTranslation } from "@vetta-org/plugin-sdk";
import { Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import type { ContentGenerationModeId, ContentModelDescriptor } from "../generation/types";
import type { ContentNodeData } from "../project/types";

const AUTOMATIC_ASPECT_RATIO = "__automatic__";

type VideoGenerationMethod = "frames" | "omni";

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
	const aspectRatios = model?.aspectRatios ?? [];
	const durations = model?.durations ?? [];
	const resolutions = model?.resolutions ?? [];
	const aspectRatio = draft.aspectRatio ?? AUTOMATIC_ASPECT_RATIO;
	const duration = draft.duration ?? durations[0];
	const resolution = draft.resolution ?? resolutions[0];
	const availableMethods = videoMethods(model);
	const method = resolveVideoMethod(draft.modeId, availableMethods);
	const summary = [
		t(`nodeEditor.videoSettings.method.${method ?? "unavailable"}`),
		aspectRatio === AUTOMATIC_ASPECT_RATIO
			? t("nodeEditor.videoSettings.followImageSummary", {
					ratio: resolvedAspectRatio ?? aspectRatios[0] ?? "",
				})
			: aspectRatio,
		resolution,
		duration === undefined ? undefined : t("nodeEditor.videoSettings.durationSummary", { duration }),
	].filter((part): part is string => Boolean(part));

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="no-drag flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted/65 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
					aria-label={t("nodeEditor.videoSettings.open")}
				>
					<span className="truncate">{summary.join(" · ")}</span>
					<span className="text-muted-foreground" aria-hidden="true">
						·
					</span>
					<span className="icon-[lucide--volume-x] block size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
					<span className="icon-[lucide--chevron-down] block size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				</button>
			</PopoverTrigger>
			{open ? (
				<PopoverContent
					align="start"
					side="top"
					sideOffset={10}
					className="z-[100] w-[min(440px,calc(100vw-32px))] gap-4 rounded-2xl border-border/70 bg-popover/98 p-4 shadow-2xl backdrop-blur-xl"
				>
					<SettingsSection label={t("nodeEditor.videoSettings.generateMethod")}>
						<div className="grid grid-cols-2 rounded-xl bg-muted/55 p-1">
							{(["frames", "omni"] as const).map((option) => {
								const modeId = availableMethods[option];
								return (
									<button
										key={option}
										type="button"
										className={segmentedOptionClass(method === option)}
										disabled={!modeId}
										aria-pressed={method === option}
										onClick={() => modeId && onChange({ ...draft, modeId })}
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
							<div className="grid grid-cols-[repeat(auto-fit,minmax(52px,1fr))] rounded-xl bg-muted/55 p-1">
								<AspectRatioOption
									label={t("nodeEditor.videoSettings.followImage")}
									ratio={resolvedAspectRatio ?? aspectRatios[0]}
									selected={aspectRatio === AUTOMATIC_ASPECT_RATIO}
									onClick={() => onChange({ ...draft, aspectRatio: undefined })}
								/>
								{aspectRatios.map((option) => (
									<AspectRatioOption
										key={option}
										label={option}
										ratio={option}
										selected={aspectRatio === option}
										onClick={() => onChange({ ...draft, aspectRatio: option })}
									/>
								))}
							</div>
						</SettingsSection>
					) : null}

					{resolutions.length > 0 ? (
						<SettingsSection label={t("nodeEditor.resolution")}>
							<div className="grid rounded-xl bg-muted/55 p-1" style={{ gridTemplateColumns: equalColumns(resolutions.length) }}>
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
							<div className="flex min-w-0 overflow-x-auto rounded-xl bg-muted/55 p-1">
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
						hint={t("nodeEditor.videoSettings.audioUnsupported")}
					>
						<div className="grid grid-cols-2 rounded-xl bg-muted/55 p-1" title={t("nodeEditor.videoSettings.audioUnsupported")}>
							<button type="button" className={segmentedOptionClass(false)} disabled>
								{t("nodeEditor.videoSettings.audio.on")}
							</button>
							<button
								type="button"
								className={`${segmentedOptionClass(true)} disabled:opacity-100`}
								disabled
								aria-pressed="true"
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
		<section className="grid gap-1.5">
			<div className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
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
	onClick,
}: {
	label: string;
	ratio?: string;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={`${segmentedOptionClass(selected)} min-w-0 flex-col gap-1 px-1`}
			aria-pressed={selected}
			onClick={onClick}
		>
			<span className="flex h-4 items-center justify-center" aria-hidden="true">
				<span
					className="block rounded-[2px] border border-current"
					style={aspectRatioIconStyle(ratio)}
				/>
			</span>
			<span className="max-w-full truncate text-[10px]">{label}</span>
		</button>
	);
}

function videoMethods(model?: ContentModelDescriptor): Partial<Record<VideoGenerationMethod, ContentGenerationModeId>> {
	if (!model) return {};
	const modeIds = new Set(model.modes.map(({ id }) => id));
	return {
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
	if (methods.frames && modeId === methods.frames) return "frames";
	if (methods.omni && modeId === methods.omni) return "omni";
	if (methods.frames) return "frames";
	if (methods.omni) return "omni";
	return null;
}

function segmentedOptionClass(selected: boolean): string {
	return `flex h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
		selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
	}`;
}

function equalColumns(count: number): string {
	return `repeat(${Math.max(count, 1)}, minmax(0, 1fr))`;
}

function aspectRatioIconStyle(ratio?: string): { width: number; height: number } {
	if (!ratio) return { width: 16, height: 12 };
	const [widthPart, heightPart] = ratio.split(":").map(Number);
	if (!(widthPart > 0) || !(heightPart > 0)) return { width: 16, height: 12 };
	const scale = 18 / Math.max(widthPart, heightPart);
	return {
		width: Math.max(5, Math.round(widthPart * scale)),
		height: Math.max(5, Math.round(heightPart * scale)),
	};
}
