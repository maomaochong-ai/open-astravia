import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { type ChangeEvent, type KeyboardEvent, useEffect, useState } from "react";
import type { ContentNodePropertyDefinition } from "../domain/node-definitions";
import type { ContentNodeData, ContentNodeKind, ContentNodeStatus } from "../domain/model";
import type { ContentModelDescriptor } from "../generation/types";
import { AddIcon } from "./icons";

interface PropertyEditorProps {
	property: ContentNodePropertyDefinition;
	value: string | number | undefined;
	providerId?: string;
	models: readonly ContentModelDescriptor[];
	onChange: (value: string | number) => void;
	onModelChange: (model: ContentModelDescriptor) => void;
	onCommit: () => void;
	onSubmit?: () => void;
}

function PropertyEditor({ property, value, providerId, models, onChange, onModelChange, onCommit, onSubmit }: PropertyEditorProps) {
	const { t } = useTranslation();
	const common = {
		value: value ?? "",
		onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
			onChange(property.editor === "number" ? Number(event.target.value) : event.target.value),
		onBlur: onCommit,
	};
	const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey || !onSubmit) return;
		event.preventDefault();
		onSubmit();
	};

	return (
		<label className={`content-creation-node-composer__field is-${property.editor}`}>
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
					onBlur={onCommit}
				>
					{models.length === 0 ? <option value="">{t("nodeEditor.modelUnavailable")}</option> : null}
					{models.map((model) => (
						<option key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}\u0000${model.modelId}`}>
							{t(`provider.${model.providerId}`)} · {model.modelId}
						</option>
					))}
				</select>
			) : property.editor === "textarea" ? (
				<textarea
					{...common}
					rows={3}
					placeholder={property.placeholderKey ? t(property.placeholderKey) : undefined}
					onKeyDown={handlePromptKeyDown}
				/>
			) : property.editor === "select" ? (
				<select {...common}>
					{property.options?.map((option) => (
						<option key={option.value} value={option.value}>{t(option.labelKey)}</option>
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

interface NodeGenerationComposerProps {
	kind: ContentNodeKind;
	status: ContentNodeStatus;
	data: ContentNodeData;
	properties: readonly ContentNodePropertyDefinition[];
	models: readonly ContentModelDescriptor[];
	hasGenerationError: boolean;
	onUpdate: (data: ContentNodeData) => Promise<void>;
	onRunNode: () => Promise<void>;
	onAddToTimeline?: () => Promise<void>;
}

export function NodeGenerationComposer({
	kind,
	status,
	data,
	properties,
	models,
	hasGenerationError,
	onUpdate,
	onRunNode,
	onAddToTimeline,
}: NodeGenerationComposerProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<ContentNodeData>(data);
	const isGenerator = kind === "image-generator" || kind === "video-generator";
	const availableModels = kind === "image-generator" ? models : [];
	const isRunning = status === "running" || status === "queued";
	const canGenerate = kind === "image-generator" && availableModels.length > 0 && !isRunning;

	useEffect(() => setDraft(data), [data]);

	const submit = () => {
		if (!canGenerate) return;
		void onUpdate(draft).then(onRunNode);
	};

	return (
		<div
			className={`content-creation-node-composer nodrag nowheel is-${kind}`}
			onPointerDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<div className="content-creation-node-composer__fields">
				{properties.map((property) => (
					<PropertyEditor
						key={property.key}
						property={property}
						value={draft[property.key]}
						providerId={draft.providerId}
						models={availableModels}
						onChange={(value) => {
							const next = { ...draft, [property.key]: value };
							setDraft(next);
							if (property.editor === "select") void onUpdate(next);
						}}
						onModelChange={(model) => {
							const next = { ...draft, providerId: model.providerId, modelId: model.modelId };
							setDraft(next);
							void onUpdate(next);
						}}
						onCommit={() => void onUpdate(draft)}
						onSubmit={isGenerator ? submit : undefined}
					/>
				))}
			</div>
			{hasGenerationError ? <p className="content-creation-node-composer__error">{t("error.generate")}</p> : null}
			<div className="content-creation-node-composer__actions" onMouseDown={(event) => event.preventDefault()}>
				{isGenerator ? (
					<Button type="button" size="sm" variant="primary" disabled={!canGenerate} onClick={submit}>
						{isRunning ? t("action.generating") : t("action.generate")}
					</Button>
				) : null}
				{onAddToTimeline && data.assetId ? (
					<Button type="button" size="sm" variant="outline" onClick={() => void onAddToTimeline()}>
						<AddIcon /> {t("action.addToTimeline")}
					</Button>
				) : null}
			</div>
		</div>
	);
}
