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
		<label className="flex min-w-0 flex-1 flex-col gap-1 text-[10px] text-muted-foreground">
			<span className="font-medium">{t(property.labelKey)}</span>
			{property.editor === "model" ? (
					<select className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
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
					<textarea className="min-h-[72px] resize-y rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
					{...common}
					rows={3}
					placeholder={property.placeholderKey ? t(property.placeholderKey) : undefined}
					onKeyDown={handlePromptKeyDown}
				/>
			) : property.editor === "select" ? (
				<select className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring" {...common}>
					{property.options?.map((option) => (
						<option key={option.value} value={option.value}>{t(option.labelKey)}</option>
					))}
				</select>
			) : (
				<input className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
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
			className="w-[min(520px,calc(100vw-32px))] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl nodrag nowheel"
			onPointerDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<div className="flex flex-wrap gap-2">
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
			{hasGenerationError ? <p className="px-1 py-1 text-xs text-destructive">{t("error.generate")}</p> : null}
			<div className="flex items-center justify-end gap-2 pt-1" onMouseDown={(event) => event.preventDefault()}>
				{isGenerator ? (
					<Button type="button" size="sm" variant="primary" disabled={!canGenerate} onClick={submit}>
						{isRunning ? t("action.generating") : hasGenerationError ? t("action.retry") : t("action.generate")}
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
