import { MotionSelect, SettingRow, SettingSection } from "@vetta/theme-ui/settings";
import { Switch } from "@vetta/ui";
import { SettingsAiAssist } from "../ai-assist";
import type { PluginSettingFieldModel, PluginsSettingsModel } from "./usePluginsSettingsModel";

function SettingControl({
	field,
	onChange,
	pleaseSelect,
}: {
	field: PluginSettingFieldModel;
	onChange: (value: string | number | boolean) => void;
	pleaseSelect: string;
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
			type={schema.type === "secret" ? "password" : numeric ? "number" : "text"}
			autoComplete={schema.type === "secret" ? "off" : undefined}
			min={numeric ? schema.minimum : undefined}
			max={numeric ? schema.maximum : undefined}
			step={schema.type === "integer" ? 1 : undefined}
			className="h-8 w-[240px] min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 text-[12px] outline-none focus-visible:border-ring/60"
			value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
			onChange={(event) => {
				if (numeric) {
					if (event.target.value !== "") onChange(Number(event.target.value));
				} else {
					onChange(event.target.value);
				}
			}}
		/>
	);
}

export function PluginsSettingsView({ model }: { model: PluginsSettingsModel }): JSX.Element {
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[20px] font-bold text-foreground">{model.labels.title}</h1>
				<SettingsAiAssist tabId="plugins" />
			</div>

			{model.sections.length === 0 ? (
				<div className="rounded-xl border border-border bg-card px-5 py-4 text-[12px] text-muted-foreground">
					{model.labels.empty}
				</div>
			) : (
				model.sections.map((section) => (
					<SettingSection key={section.configurationId} section={section.section} description={section.description}>
						{section.consumers.length > 0 && (
							<div className="border-b border-border px-5 py-3 text-[11px] text-muted-foreground">
								{model.labels.apply}: {section.apply} · {model.labels.consumers}: {section.consumers.join(", ")}
							</div>
						)}
						{section.fields.map((field) => (
							<SettingRow
								key={field.path.join(".")}
								title={field.title ?? field.path.at(-1) ?? ""}
								description={field.description}
								border={field.border}
							>
								<SettingControl
									field={field}
									pleaseSelect={model.labels.pleaseSelect}
									onChange={(value) => model.actions.update(section.configurationId, field.path, value)}
								/>
							</SettingRow>
						))}
					</SettingSection>
				))
			)}
		</div>
	);
}
