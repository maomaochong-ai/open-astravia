import { useEffect, useState } from "react";
import { MotionSelect, SettingRow, SettingSection } from "@vetta-org/theme-ui/settings";
import { Switch } from "@vetta-org/ui";
import { IMAGE_CUSTOM_PRESET, type ImageNumericPreset, imageNumericPresets } from "./image-numeric-presets";
import type { RuntimeConfigurationFieldModel, RuntimeConfigurationModel } from "./useRuntimeConfigurationModel";
import { SETTINGS_SECTION } from "../registry";

function RuntimeConfigurationControl({
	field,
	configurationId,
	customLabel,
	pleaseSelect,
	onChange,
}: {
	field: RuntimeConfigurationFieldModel;
	configurationId: string;
	customLabel: string;
	pleaseSelect: string;
	onChange: (value: string | number | boolean) => void;
}): JSX.Element {
	const presets = configurationId === "coding.images" ? imageNumericPresets(field.path) : undefined;
	if (presets) {
		return (
			<ImageNumericPresetControl field={field} presets={presets} customLabel={customLabel} onChange={onChange} />
		);
	}
	const { schema, value } = field;
	if (field.control === "ocr-provider-select") {
		return (
			<MotionSelect
				value={typeof value === "string" ? value : ""}
				onValueChange={onChange}
				placeholder={pleaseSelect}
				triggerClassName="min-w-[220px]"
				options={field.options ?? []}
				aria-label={field.title}
			/>
		);
	}
	if (schema.type === "boolean") {
		return <Switch checked={value === true} onCheckedChange={onChange} aria-label={field.title} />;
	}
	if (schema.type === "enum") {
		return (
			<MotionSelect
				value={typeof value === "string" ? value : ""}
				onValueChange={onChange}
				placeholder={pleaseSelect}
				triggerClassName="min-w-[160px]"
				options={field.options ?? (schema.enum ?? []).map((option) => ({ value: option, label: option }))}
				aria-label={field.title}
			/>
		);
	}
	const numeric = schema.type === "number" || schema.type === "integer";
	return (
		<input
			type={numeric ? "number" : "text"}
			min={numeric ? schema.minimum : undefined}
			max={numeric ? schema.maximum : undefined}
			step={schema.type === "integer" ? 1 : undefined}
			aria-label={field.title}
			className="h-8 w-[200px] min-w-0 rounded-lg border border-border bg-transparent px-2.5 text-right text-[12px] tabular-nums outline-none transition-colors focus:border-primary/50"
			value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
			onChange={(event) => {
				if (!numeric) {
					onChange(event.target.value);
					return;
				}
				if (event.target.value !== "") onChange(Number(event.target.value));
			}}
		/>
	);
}

/**
 * A numeric image-processing field as common values, with Custom last.
 * Custom keeps the typed number locally until it leaves the field, so a multi-digit
 * value is not saved one digit at a time. Values outside the schema range are dropped.
 */
function ImageNumericPresetControl({
	field,
	presets,
	customLabel,
	onChange,
}: {
	field: RuntimeConfigurationFieldModel;
	presets: readonly ImageNumericPreset[];
	customLabel: string;
	onChange: (value: number) => void;
}): JSX.Element {
	const numeric = typeof field.value === "number" ? field.value : undefined;
	const matched = presets.some((preset) => preset.value === numeric);
	const [editingCustom, setEditingCustom] = useState(false);
	const custom = editingCustom || !matched;
	const [draft, setDraft] = useState(numeric === undefined ? "" : String(numeric));
	useEffect(() => {
		setDraft(numeric === undefined ? "" : String(numeric));
	}, [numeric]);

	const commit = (): void => {
		const minimum = field.schema.minimum ?? 1;
		const maximum = field.schema.maximum ?? Number.MAX_SAFE_INTEGER;
		const next = /^\d+$/.test(draft) ? Number(draft) : Number.NaN;
		if (!Number.isSafeInteger(next) || next < minimum || next > maximum) {
			setDraft(numeric === undefined ? "" : String(numeric));
			return;
		}
		if (next !== numeric) onChange(next);
	};

	return (
		<div className="flex items-center justify-end gap-2">
			<MotionSelect
				value={custom ? IMAGE_CUSTOM_PRESET : String(numeric)}
				onValueChange={(next) => {
					if (next === IMAGE_CUSTOM_PRESET) {
						setEditingCustom(true);
						return;
					}
					setEditingCustom(false);
					onChange(Number(next));
				}}
				triggerClassName="min-w-[140px]"
				options={[
					...presets.map((preset) => ({ value: String(preset.value), label: preset.label })),
					{ value: IMAGE_CUSTOM_PRESET, label: customLabel },
				]}
				aria-label={field.title}
			/>
			{custom ? (
				<input
					type="number"
					min={field.schema.minimum}
					max={field.schema.maximum}
					step={field.schema.type === "integer" ? 1 : undefined}
					aria-label={`${customLabel} ${field.title}`}
					className="h-8 w-28 min-w-0 rounded-lg border border-border bg-transparent px-2.5 text-right text-[12px] tabular-nums outline-none transition-colors focus:border-primary/50"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					}}
				/>
			) : null}
		</div>
	);
}

/** 内置运行时配置分区，挂在 Agent 配置页下方。 */
export function RuntimeConfigurationSections({ model }: { model: RuntimeConfigurationModel }): JSX.Element | null {
	if (model.sections.length === 0) return null;
	return (
		<>
			{model.sections.map((section) => (
				<div key={section.configurationId} className="mt-6">
					<SettingSection
						title={section.title}
						section={SETTINGS_SECTION["agent-runtime"]}
						description={section.description}
					>
						{section.fields.map((field) => (
							<SettingRow
								key={field.path.join(".")}
								title={field.title}
								description={field.description}
								border={field.border}
							>
								<RuntimeConfigurationControl
									field={field}
									configurationId={section.configurationId}
									customLabel={model.labels.custom}
									pleaseSelect={model.labels.pleaseSelect}
									onChange={(value) => model.actions.update(section.configurationId, field.path, value)}
								/>
							</SettingRow>
						))}
					</SettingSection>
				</div>
			))}
		</>
	);
}
