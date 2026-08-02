import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vetta/ui";
import { type ChangeEvent, type KeyboardEvent, useEffect, useState } from "react";
import type { ContentNodePropertyDefinition } from "./definitions";
import type { ContentNodeData, ContentNodeKind, ContentNodeStatus } from "../project/types";
import type { ContentModelDescriptor } from "../generation/types";
import { AddIcon } from "../shared/icons";

const FIELD_CLASS =
	"min-w-0 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-[12px] font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50";

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

function PropertyEditor({
	property,
	value,
	providerId,
	models,
	onChange,
	onModelChange,
	onCommit,
	onSubmit,
}: PropertyEditorProps) {
	const { t } = useTranslation();
	const fieldWidthClass =
		property.editor === "textarea" || property.editor === "text" ? "w-full" : "min-w-[112px] flex-1";
	const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key !== "Enter" || event.shiftKey || !onSubmit) return;
		event.preventDefault();
		onSubmit();
	};

	return (
		<label className={`flex min-w-0 flex-col gap-1 text-[10px] font-medium text-muted-foreground ${fieldWidthClass}`}>
			<span>{t(property.labelKey)}</span>
			{property.editor === "model" ? (
				<Select
					value={providerId && value ? `${providerId}\u0000${value}` : undefined}
					onValueChange={(next) => {
						const model = models.find(
							(candidate) => `${candidate.providerId}\u0000${candidate.modelId}` === next,
						);
						if (model) onModelChange(model);
					}}
				>
					<SelectTrigger size="sm" className="w-full min-w-0">
						<SelectValue placeholder={t("nodeEditor.modelUnavailable")} />
					</SelectTrigger>
					<SelectContent className="z-[100]">
						{models.length === 0 ? (
							<SelectItem value="__unavailable" disabled>
								{t("nodeEditor.modelUnavailable")}
							</SelectItem>
						) : (
							models.map((model) => (
								<SelectItem
									key={`${model.providerId}:${model.modelId}`}
									value={`${model.providerId}\u0000${model.modelId}`}
								>
									{t(`provider.${model.providerId}`)} · {model.displayName}
								</SelectItem>
							))
						)}
					</SelectContent>
				</Select>
			) : property.editor === "textarea" ? (
				<textarea
					className={`${FIELD_CLASS} min-h-[72px] max-h-[140px] w-full resize-none leading-relaxed`}
					value={value ?? ""}
					rows={3}
					placeholder={property.placeholderKey ? t(property.placeholderKey) : undefined}
					onChange={(event) => onChange(event.target.value)}
					onBlur={onCommit}
					onKeyDown={handlePromptKeyDown}
				/>
			) : property.editor === "select" ? (
				<Select
					value={String(value ?? property.options?.[0]?.value ?? "")}
					onValueChange={(next) => {
						onChange(next);
					}}
				>
					<SelectTrigger size="sm" className="w-full min-w-0">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="z-[100]">
						{property.options?.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{t(option.labelKey)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<input
					className={FIELD_CLASS}
					value={value ?? ""}
					type={property.editor === "number" ? "number" : "text"}
					min={property.min}
					max={property.max}
					step={property.step}
					placeholder={property.placeholderKey ? t(property.placeholderKey) : undefined}
					onChange={(event: ChangeEvent<HTMLInputElement>) =>
						onChange(property.editor === "number" ? Number(event.target.value) : event.target.value)
					}
					onBlur={onCommit}
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
	const capability = kind === "image-generator" ? "text-to-image" : kind === "video-generator" ? "text-to-video" : undefined;
	const availableModels = capability ? models.filter((model) => model.capabilities.includes(capability)) : [];
	const isRunning = status === "running" || status === "queued";
	const canGenerate = isGenerator && availableModels.length > 0 && !isRunning;

	useEffect(() => setDraft(data), [data]);

	const submit = () => {
		if (!canGenerate) return;
		void onUpdate(draft).then(onRunNode);
	};

	const commitSelect = (next: ContentNodeData) => {
		setDraft(next);
		void onUpdate(next);
	};

	return (
		<div
			className="w-full min-w-0 rounded-xl border border-border/70 bg-card p-2.5 text-card-foreground shadow-sm nodrag nowheel"
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
							if (property.editor === "select") {
								commitSelect(next);
								return;
							}
							setDraft(next);
						}}
						onModelChange={(model) => {
							commitSelect({ ...draft, providerId: model.providerId, modelId: model.modelId });
						}}
						onCommit={() => void onUpdate(draft)}
						onSubmit={isGenerator ? submit : undefined}
					/>
				))}
			</div>
			{hasGenerationError ? (
				<p className="mt-2 mb-0 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
					{t("error.generate")}
				</p>
			) : null}
			<div className="mt-2 flex justify-end gap-1.5" onMouseDown={(event) => event.preventDefault()}>
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
