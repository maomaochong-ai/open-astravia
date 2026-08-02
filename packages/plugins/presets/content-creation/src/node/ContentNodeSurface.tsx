import { useTranslation } from "@vetta-org/plugin-sdk";
import { Spin } from "@vetta/ui";
import { memo } from "react";
import type { ContentNodeData, ContentNodeKind, ContentNodeStatus, GenerationJob } from "../project/types";
import { NodeKindIcon } from "./NodeKindIcon";

interface ContentNodeSurfaceProps {
	kind: ContentNodeKind;
	status: ContentNodeStatus;
	data: ContentNodeData;
	descriptionKey: string;
	assetUrl?: string;
	assetKind?: "image" | "video" | "audio";
	job?: GenerationJob;
}

function MediaPlaceholder({ kind, descriptionKey }: Pick<ContentNodeSurfaceProps, "kind" | "descriptionKey">) {
	const { t } = useTranslation();
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
			<span className="grid size-12 place-items-center rounded-2xl border border-dashed border-border/80 bg-background/40">
				<NodeKindIcon kind={kind} className="size-6 opacity-60" />
			</span>
			<span className="max-w-[240px] text-[11px] leading-relaxed">{t(descriptionKey)}</span>
		</div>
	);
}

export const ContentNodeSurface = memo(function ContentNodeSurface({
	kind,
	status,
	data,
	descriptionKey,
	assetUrl,
	assetKind,
	job,
}: ContentNodeSurfaceProps) {
	const { t } = useTranslation();
	const isMedia = kind === "image-generator" || kind === "video-generator" || kind === "asset";
	const isBusy = status === "running" || status === "queued";

	if (isMedia) {
		return (
			<div className="relative h-full w-full bg-muted/40">
				{assetUrl && assetKind === "video" ? (
					<video
						className="nodrag nowheel block h-full w-full border-0 bg-background object-contain"
						src={assetUrl}
						controls
						preload="none"
					/>
				) : assetUrl ? (
					<img
						className="block h-full w-full border-0 bg-background object-contain"
						src={assetUrl}
						alt={t("node.generatedPreview")}
						loading="lazy"
						decoding="async"
						draggable={false}
					/>
				) : (
					<MediaPlaceholder kind={kind} descriptionKey={descriptionKey} />
				)}
				{isBusy ? (
					<div
						className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/45 backdrop-blur-[2px]"
						aria-label={t("action.generating")}
					>
						<div className="absolute inset-0 animate-[content-creation-shimmer_1.5s_linear_infinite] bg-[linear-gradient(110deg,transparent_25%,color-mix(in_srgb,var(--primary)_12%,transparent)_45%,transparent_65%)] bg-[length:220%_100%]" />
						<Spin size="md" className="relative text-primary" label={t("action.generating")} />
						<span className="relative rounded-md border border-border/60 bg-popover/90 px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-sm">
							{t("job.progress", { progress: Math.round((job?.progress ?? 0) * 100) })}
						</span>
					</div>
				) : null}
				{job?.status === "failed" && job.error ? (
					<div
						className="absolute right-2 top-2 max-w-[calc(100%_-_16px)] truncate rounded-md border border-destructive/30 bg-destructive/90 px-2 py-1 text-[10px] font-medium text-destructive-foreground shadow-sm"
						title={job.error}
					>
						{t("job.failed")}
					</div>
				) : null}
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col gap-3 p-4">
			<p className="m-0 line-clamp-6 whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/85">
				{data.prompt?.trim() || t(descriptionKey)}
			</p>
		</div>
	);
});
