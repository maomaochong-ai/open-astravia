import { MotionSelect, SettingRow, SettingSection } from "@vetta/theme-ui/settings";
import { Switch } from "@vetta/ui";
import type { RuntimeConfigurationFieldModel, RuntimeConfigurationModel } from "./useRuntimeConfigurationModel";
import { SETTINGS_SECTION } from "../registry";

function RuntimeConfigurationControl({
	field,
	pleaseSelect,
	onChange,
}: {
	field: RuntimeConfigurationFieldModel;
	pleaseSelect: string;
	onChange: (value: string | number | boolean) => void;
}): JSX.Element {
	const { schema, value } = field;
	if (schema.type === "boolean") {
		return <Switch checked={value === true} onCheckedChange={onChange} />;
	}
	if (schema.type === "enum") {
		return (
			<MotionSelect
				value={typeof value === "string" ? value : ""}
				onValueChange={onChange}
				placeholder={pleaseSelect}
				triggerClassName="min-w-[160px]"
				options={(schema.enum ?? []).map((option) => ({ value: option, label: option }))}
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

/** 内置运行时配置分区（当前为「图片处理」），挂在 Agent 配置页下方。 */
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
									pleaseSelect={model.labels.pleaseSelect}
									onChange={(value) => model.actions.update(section.configurationId, field.path, value)}
								/>
							</SettingRow>
						))}
					</SettingSection>
					<p className="mt-2 px-1 text-[11px] text-muted-foreground">
						{model.labels.apply}: {section.apply}
					</p>
				</div>
			))}
		</>
	);
}
