import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ContentNodeData, ContentNodeKind, ContentNodeStatus, GenerationJob } from "../domain/model";
import { NodeKindIcon } from "./NodeKindIcon";

interface ContentNodeSurfaceProps {
	kind: ContentNodeKind;
	status: ContentNodeStatus;
	data: ContentNodeData;
	title: string;
	descriptionKey: string;
	assetUrl?: string;
	assetKind?: "image" | "video" | "audio";
	job?: GenerationJob;
}

function MediaPlaceholder({ kind, descriptionKey }: Pick<ContentNodeSurfaceProps, "kind" | "descriptionKey">) {
	const { t } = useTranslation();
	return (
		<div className="content-creation-node-surface__placeholder">
			<NodeKindIcon kind={kind} />
			<span>{t(descriptionKey)}</span>
		</div>
	);
}

export function ContentNodeSurface({ kind, status, data, title, descriptionKey, assetUrl, assetKind, job }: ContentNodeSurfaceProps) {
	const { t } = useTranslation();
	const isMedia = kind === "image-generator" || kind === "video-generator" || kind === "asset";

	if (isMedia) {
		return (
			<div className="content-creation-node-surface is-media">
				{assetUrl && assetKind === "video" ? (
					<video className="content-creation-node-surface__media nodrag nowheel" src={assetUrl} controls preload="none" />
				) : assetUrl ? (
					<img className="content-creation-node-surface__media" src={assetUrl} alt={t("node.generatedPreview")} loading="lazy" decoding="async" />
				) : (
					<MediaPlaceholder kind={kind} descriptionKey={descriptionKey} />
				)}
				<div className="content-creation-node-surface__label">
					<span>{title}</span>
					<span className={`content-creation-node__status is-${status}`}>{t(`node.status.${status}`)}</span>
				</div>
				{status === "running" || status === "queued" ? (
					<div className="content-creation-node-surface__progress" aria-label={t("action.generating")}>
						<span>{t("job.progress", { progress: Math.round((job?.progress ?? 0) * 100) })}</span>
					</div>
				) : null}
				{job?.status === "failed" && job.error ? (
					<div className="content-creation-node-surface__failure" title={job.error}>{t("job.failed")}</div>
				) : null}
			</div>
		);
	}

	return (
		<div className="content-creation-node-surface is-document">
			<div className="content-creation-node-surface__document-header">
				<span className="content-creation-node-surface__document-icon"><NodeKindIcon kind={kind} /></span>
				<div>
					<strong>{title}</strong>
					<span>{t(`node.kind.${kind}`)}</span>
				</div>
			</div>
		<p>{data.prompt?.trim() || t(descriptionKey)}</p>
		</div>
	);
}
