import { type PluginMediaErrorCode, useTranslation } from "@vetta-org/plugin-sdk";
import { Spin } from "@vetta/ui";
import { memo } from "react";
import type {
	ContentAsset,
	ContentNodeData,
	ContentNodeKind,
	ContentNodeStatus,
	GenerationJob,
} from "../project/types";
import { ContentAssetNodeSurface } from "./ContentAssetNodeSurface";
import { ContentAssetKindIcon } from "./ContentAssetKindIcon";
import { NodeKindIcon } from "./NodeKindIcon";
import { contentPromptTextFromData } from "./prompt-document";

interface ContentNodeSurfaceProps {
	kind: ContentNodeKind;
	status: ContentNodeStatus;
	data: ContentNodeData;
	descriptionKey: string;
	assetUrl?: string;
	assetKind?: "image" | "video" | "audio";
	assets?: readonly ContentAsset[];
	referenceAssets?: readonly ContentAsset[];
	job?: GenerationJob;
}

/**
 * Fluid type/spacing relative to the node shell (container-type: size).
 * Base ≈ 400px-wide media card; clamps keep small/large resizes readable.
 */
const surfaceTextStyle = {
	fontSize: "clamp(12px, 3.6cqw, 16px)",
	lineHeight: 1.55,
} as const;

const captionTextStyle = {
	fontSize: "clamp(11px, 3cqw, 14px)",
	lineHeight: 1.4,
} as const;

const GENERATION_ERROR_KEYS: Record<PluginMediaErrorCode, string> = {
	unauthenticated: "job.error.unauthenticated",
	"provider-unavailable": "job.error.providerUnavailable",
	"operation-unsupported": "job.error.operationUnsupported",
	"invalid-request": "job.error.invalidRequest",
	"not-entitled": "job.error.notEntitled",
	"quota-exhausted": "job.error.quotaExhausted",
	"content-rejected": "job.error.contentRejected",
	"provider-timeout": "job.error.providerTimeout",
	"provider-failed": "job.error.providerFailed",
	cancelled: "job.error.cancelled",
};

function MediaPlaceholder({
	kind,
	descriptionKey,
	prompt,
}: Pick<ContentNodeSurfaceProps, "kind" | "descriptionKey"> & { prompt?: string }) {
	const { t } = useTranslation();
	return (
		<div
			className="flex h-full w-full flex-col items-center justify-center text-center text-muted-foreground"
			style={{
				gap: "clamp(10px, 3.5cqmin, 18px)",
				padding: "clamp(16px, 6cqmin, 28px)",
			}}
		>
			<span
				className="grid place-items-center rounded-2xl border border-dashed border-border/80 bg-background/40"
				style={{
					width: "clamp(40px, 14cqmin, 64px)",
					height: "clamp(40px, 14cqmin, 64px)",
				}}
			>
				<NodeKindIcon
					kind={kind}
					className="opacity-60"
					style={{
						width: "clamp(20px, 7cqmin, 32px)",
						height: "clamp(20px, 7cqmin, 32px)",
					}}
				/>
			</span>
			<span className="max-w-[min(280px,85%)]" style={surfaceTextStyle}>
				{prompt?.trim() || t(descriptionKey)}
			</span>
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
	assets = [],
	referenceAssets = [],
	job,
}: ContentNodeSurfaceProps) {
	const { t } = useTranslation();
	const isMedia = kind === "image-generator" || kind === "video-generator";
	const isBusy = status === "running" || status === "queued";
	const emptyText = kind === "prompt" ? t("node.prompt.doubleClickToEdit") : t(descriptionKey);
	const jobError = job?.errorCode ? t(GENERATION_ERROR_KEYS[job.errorCode]) : job?.error;

	if (kind === "asset") return <ContentAssetNodeSurface assets={assets} />;
	if (kind === "prompt") {
		const prompt = contentPromptTextFromData(data);
		return (
			<div
				className="flex h-full w-full flex-col justify-between [container-type:size]"
				style={{ gap: "clamp(8px, 2.5cqw, 14px)", padding: "clamp(12px, 4cqw, 20px)" }}
			>
				<div className="min-h-0 flex-1">
					{data.promptOptimization ? (
						<div className="mb-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/75">
							<span className="icon-[lucide--sparkles] block size-3" aria-hidden="true" />
							<span>{t("node.prompt.optimized")}</span>
						</div>
					) : null}
					<p className="m-0 line-clamp-6 whitespace-pre-wrap text-foreground/85" style={surfaceTextStyle}>
						{prompt || emptyText}
					</p>
				</div>
				{referenceAssets.length > 0 ? (
					<div className="flex min-w-0 items-center gap-1.5 border-t border-border/55 pt-2">
						{referenceAssets.slice(0, 2).map((asset) => (
							<span
								key={asset.id}
								className="inline-flex min-w-0 max-w-[42%] items-center gap-1 rounded-md bg-muted/70 px-1.5 py-1 text-[10px] text-foreground"
							>
								<ContentAssetKindIcon kind={asset.kind} className="size-3 shrink-0 text-muted-foreground" />
								<span className="truncate">{asset.name}</span>
							</span>
						))}
						<span className="truncate text-[10px] text-muted-foreground">
							{t("node.prompt.references", { count: referenceAssets.length })}
						</span>
					</div>
				) : null}
			</div>
		);
	}

	if (isMedia) {
		return (
			<div className="relative h-full w-full bg-muted/40 [container-type:size]">
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
					<MediaPlaceholder kind={kind} descriptionKey={descriptionKey} prompt={data.prompt} />
				)}
				{isBusy ? (
					<div
						className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-background/45 backdrop-blur-[2px]"
						style={{ gap: "clamp(8px, 2.5cqmin, 14px)" }}
						aria-label={t("action.generating")}
					>
						<div className="absolute inset-0 animate-[content-creation-shimmer_1.5s_linear_infinite] bg-[linear-gradient(110deg,transparent_25%,color-mix(in_srgb,var(--primary)_12%,transparent)_45%,transparent_65%)] bg-[length:220%_100%]" />
						<Spin size="md" className="relative text-primary" label={t("action.generating")} />
						<span
							className="relative rounded-md border border-border/60 bg-popover/90 px-2 py-1 font-medium text-popover-foreground shadow-sm"
							style={captionTextStyle}
						>
							{t("job.progress", { progress: Math.round((job?.progress ?? 0) * 100) })}
						</span>
					</div>
				) : null}
				{job?.status === "failed" && jobError ? (
					<div
						className="absolute right-2 top-2 max-w-[calc(100%_-_16px)] truncate rounded-md border border-destructive/30 bg-destructive/90 px-2 py-1 font-medium text-destructive-foreground shadow-sm"
						style={captionTextStyle}
						title={job.error}
					>
						{jobError}
					</div>
				) : null}
			</div>
		);
	}

	return (
		<div
			className="flex h-full w-full flex-col [container-type:size]"
			style={{
				gap: "clamp(8px, 2.5cqw, 14px)",
				padding: "clamp(12px, 4cqw, 20px)",
			}}
		>
			<p
				className="m-0 line-clamp-6 whitespace-pre-wrap text-foreground/85"
				style={surfaceTextStyle}
			>
				{data.prompt?.trim() || emptyText}
			</p>
		</div>
	);
});
