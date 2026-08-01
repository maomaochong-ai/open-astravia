import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useEffect, useState } from "react";
import type { ContentProjectCommand } from "../domain/commands";
import type { ContentNode, ContentProjectDocument } from "../domain/model";
import { AddIcon, TrashIcon } from "./icons";

interface NodeInspectorProps {
	project: ContentProjectDocument;
	node: ContentNode | null;
	onDispatch: (commands: readonly ContentProjectCommand[]) => Promise<void>;
}

function nextClipStart(project: ContentProjectDocument, trackId: string): number {
	const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
	return track?.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0) ?? 0;
}

export function NodeInspector({ project, node, onDispatch }: NodeInspectorProps) {
	const { t } = useTranslation();
	const [label, setLabel] = useState("");
	const [prompt, setPrompt] = useState("");

	useEffect(() => {
		setLabel(node?.data.label ?? "");
		setPrompt(node?.data.prompt ?? "");
	}, [node]);

	if (!node) {
		return (
		<aside className="content-creation-inspector">
			<h2>{t("inspector.title")}</h2>
			<p className="content-creation-muted">{t("inspector.empty")}</p>
			<div className="content-creation-stat-grid">
				<div><strong>{project.assets.length}</strong><span>{t("stats.assets")}</span></div>
				<div><strong>{project.jobs.length}</strong><span>{t("stats.jobs")}</span></div>
			</div>
		</aside>
		);
	}

	const save = () => onDispatch([{ type: "node.update", nodeId: node.id, data: { label, prompt } }]);
	const canAddToTimeline = node.kind === "image-generator" || node.kind === "video-generator" || node.kind === "asset";
	const addToTimeline = () =>
		onDispatch([
			{
				type: "timeline.clip.add",
				clip: {
					trackId: "video-1",
					sourceNodeId: node.id,
					start: nextClipStart(project, "video-1"),
					duration: 5,
					sourceIn: 0,
					speed: 1,
				},
			},
		]);

	return (
		<aside className="content-creation-inspector">
			<h2>{t("inspector.title")}</h2>
			<label className="content-creation-field">
				<span>{t("inspector.label")}</span>
				<input value={label} onChange={(event) => setLabel(event.target.value)} />
			</label>
			<label className="content-creation-field">
				<span>{t("inspector.prompt")}</span>
				<textarea value={prompt} rows={7} onChange={(event) => setPrompt(event.target.value)} />
			</label>
			<div className="content-creation-inspector__actions">
				<Button type="button" size="sm" variant="primary" onClick={() => void save()}>
					{t("action.save")}
				</Button>
				<Button type="button" size="sm" variant="outline" disabled={!canAddToTimeline} onClick={() => void addToTimeline()}>
					<AddIcon /> {t("action.addToTimeline")}
				</Button>
			</div>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="content-creation-delete"
				onClick={() => void onDispatch([{ type: "node.delete", nodeId: node.id }])}
			>
				<TrashIcon /> {t("action.deleteNode")}
			</Button>
		</aside>
	);
}
