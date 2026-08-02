import { useTranslation } from "@vetta-org/plugin-sdk";
import { memo } from "react";
import type { ContentNodeData, ContentNodeKind, ContentNodeStatus, GenerationJob } from "../domain/model";
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
		<div className="flex min-h-[112px] flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
			<NodeKindIcon kind={kind} className="h-8 w-8 opacity-60" />
			<span>{t(descriptionKey)}</span>
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

	if (isMedia) {
		return (
			<div className="relative flex min-h-[112px] flex-1 flex-col overflow-hidden bg-muted/20">
				{assetUrl && assetKind === "video" ? (
					<video className="nodrag nowheel h-full min-h-[112px] w-full object-contain" src={assetUrl} controls preload="none" />
				) : assetUrl ? (
					<img
						className="h-full min-h-[112px] w-full object-cover"
						src={assetUrl}
						alt={t("node.generatedPreview")}
						loading="lazy"
						decoding="async"
						draggable={false}
					/>
				) : (
					<MediaPlaceholder kind={kind} descriptionKey={descriptionKey} />
				)}
				{status === "running" || status === "queued" ? (
					<div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-background/80 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur" aria-label={t("action.generating")}>
						<span>{t("job.progress", { progress: Math.round((job?.progress ?? 0) * 100) })}</span>
					</div>
				) : null}
				{job?.status === "failed" && job.error ? (
					<div className="absolute inset-x-2 bottom-2 rounded bg-destructive/90 px-2 py-1 text-[10px] text-destructive-foreground" title={job.error}>{t("job.failed")}</div>
				) : null}
			</div>
		);
	}

	return (
		<div className="flex min-h-[112px] flex-1 items-center p-3 text-xs leading-relaxed text-muted-foreground">
			<p className="line-clamp-5 whitespace-pre-wrap">{data.prompt?.trim() || t(descriptionKey)}</p>
		</div>
	);
});
