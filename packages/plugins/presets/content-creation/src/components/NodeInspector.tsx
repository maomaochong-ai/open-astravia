import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { type ChangeEvent, useEffect, useState } from "react";
import type { ContentProjectCommand } from "../domain/commands";
import { getContentNodeDefinition, type ContentNodePropertyDefinition } from "../domain/node-definitions";
import type { ContentNode, ContentNodeData, ContentProjectDocument } from "../domain/model";
import type { ContentModelDescriptor } from "../generation/types";
import { AddIcon, DuplicateIcon, TrashIcon } from "./icons";

interface NodeInspectorProps {
	project: ContentProjectDocument;
	node: ContentNode | null;
	models: readonly ContentModelDescriptor[];
	onDispatch: (commands: readonly ContentProjectCommand[]) => Promise<void>;
	onRunNode: (nodeId: string) => Promise<void>;
}

function nextClipStart(project: ContentProjectDocument, trackId: string): number {
	const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
	return track?.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0) ?? 0;
}

interface PropertyEditorProps {
	property: ContentNodePropertyDefinition;
	value: string | number | undefined;
	providerId?: string;
	models: readonly ContentModelDescriptor[];
	onChange: (value: string | number) => void;
	onModelChange: (model: ContentModelDescriptor) => void;
}

function PropertyEditor({ property, value, providerId, models, onChange, onModelChange }: PropertyEditorProps) {
	const { t } = useTranslation();
	const common = {
		value: value ?? "",
		onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
			onChange(property.editor === "number" ? Number(event.target.value) : event.target.value),
	};

	return (
		<label className="content-creation-field">
			<span>{t(property.labelKey)}</span>
			{property.editor === "model" ? (
				<select
					value={providerId && value ? `${providerId}\u0000${value}` : ""}
					onChange={(event) => {
						const model = models.find(
							(candidate) => `${candidate.providerId}\u0000${candidate.modelId}` === event.target.value,
						);
						if (model) onModelChange(model);
					}}
				>
					{models.length === 0 ? <option value="">{t("inspector.modelUnavailable")}</option> : null}
					{models.map((model) => (
						<option key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}\u0000${model.modelId}`}>
							{t(`provider.${model.providerId}`)} · {model.modelId}
						</option>
					))}
				</select>
			) : property.editor === "textarea" ? (
				<textarea {...common} rows={6} placeholder={property.placeholderKey ? t(property.placeholderKey) : undefined} />
			) : property.editor === "select" ? (
				<select {...common}>
					{property.options?.map((option) => (
						<option key={option.value} value={option.value}>
							{t(option.labelKey)}
						</option>
					))}
				</select>
			) : (
				<input
					{...common}
					type={property.editor === "number" ? "number" : "text"}
					min={property.min}
					max={property.max}
					step={property.step}
					placeholder={property.placeholderKey ? t(property.placeholderKey) : undefined}
				/>
			)}
		</label>
	);
}

export function NodeInspector({ project, node, models, onDispatch, onRunNode }: NodeInspectorProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<ContentNodeData>({});

	useEffect(() => setDraft(node?.data ?? {}), [node]);

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

	const definition = getContentNodeDefinition(node.kind);
	const asset = node.data.assetId ? project.assets.find((candidate) => candidate.id === node.data.assetId) : undefined;
	const latestJob = project.jobs.filter((job) => job.nodeId === node.id).at(-1);
	const save = () => onDispatch([{ type: "node.update", nodeId: node.id, data: draft }]);
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
			<div className="content-creation-inspector__summary">
				<strong>{t(`node.kind.${node.kind}`)}</strong>
				<span>{t(`node.category.${definition.category}`)}</span>
				<p>{t(definition.descriptionKey)}</p>
			</div>
			{definition.properties.map((property) => (
				<PropertyEditor
					key={property.key}
					property={property}
					value={draft[property.key]}
					providerId={draft.providerId}
					models={models}
					onChange={(value) => setDraft((current) => ({ ...current, [property.key]: value }))}
					onModelChange={(model) =>
						setDraft((current) => ({ ...current, providerId: model.providerId, modelId: model.modelId }))
					}
				/>
			))}
			{asset?.kind === "image" ? (
				<div className="content-creation-inspector__preview">
					<img src={asset.url} alt={t("inspector.generatedPreview")} />
				</div>
			) : null}
			{latestJob?.status === "failed" && latestJob.error ? (
				<p className="content-creation-inspector__job-error">{t("error.generate")}</p>
			) : null}
			<div className="content-creation-inspector__ports">
				<h3>{t("inspector.inputs")}</h3>
				<div>{definition.inputs.map((port) => <span key={port.id}>{t(port.labelKey)} · {port.dataType}</span>)}</div>
				<h3>{t("inspector.outputs")}</h3>
				<div>{definition.outputs.map((port) => <span key={port.id}>{t(port.labelKey)} · {port.dataType}</span>)}</div>
			</div>
			<div className="content-creation-inspector__actions">
				<Button type="button" size="sm" variant="primary" onClick={() => void save()}>
					{t("action.save")}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="primary"
					disabled={node.kind !== "image-generator" || node.status === "running" || node.status === "queued" || models.length === 0}
					onClick={() => {
						void save().then(() => onRunNode(node.id));
					}}
				>
					{node.status === "running" || node.status === "queued" ? t("action.generating") : t("action.generate")}
				</Button>
				<Button type="button" size="sm" variant="outline" disabled={!canAddToTimeline} onClick={() => void addToTimeline()}>
					<AddIcon /> {t("action.addToTimeline")}
				</Button>
				<Button type="button" size="sm" variant="outline" onClick={() => void onDispatch([{ type: "node.duplicate", nodeId: node.id }])}>
					<DuplicateIcon /> {t("action.duplicateNode")}
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
