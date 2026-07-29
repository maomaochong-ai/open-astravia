import { Switch } from "@vetta/ui";
import { cn } from "@shared/lib/utils";
import { openExternalLink } from "@shared/lib/open-external-link";
import { SettingsAiAssist } from "../ai-assist";
import type { PluginSettingFieldModel, PluginsSettingsModel } from "./usePluginsSettingsModel";
import { MotionSelect, SettingRow, SettingSection } from "@vetta/theme-ui/settings";

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function DescRow({
	title,
	description,
	border,
}: {
	border: boolean;
	description: string;
	title: string | undefined;
}): JSX.Element {
	const parts = description.split(URL_PATTERN);
	return (
		<div className={cn("px-5 py-4", border && "border-b border-border")}>
			{title && <div className="mb-0.5 text-[13px] font-medium text-foreground">{title}</div>}
			<div className="text-[12px] leading-relaxed text-muted-foreground">
				{parts.map((part, index) =>
					/^https?:\/\//.test(part) ? (
						<a
							// biome-ignore lint/suspicious/noArrayIndexKey: split segments are positional and stable
							key={index}
							href={part}
							onClick={(event) => openExternalLink(event, part)}
							className="text-primary underline underline-offset-2 hover:opacity-80"
						>
							{part}
						</a>
					) : (
						// biome-ignore lint/suspicious/noArrayIndexKey: split segments are positional and stable
						<span key={index}>{part}</span>
					),
				)}
			</div>
		</div>
	);
}

function SettingControl({
	field,
	onChange,
	pleaseSelect,
}: {
	field: PluginSettingFieldModel;
	onChange: (value: unknown) => void;
	pleaseSelect: string;
}): JSX.Element {
	const { schema, value } = field;
	switch (schema.type) {
		case "boolean":
			return <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} />;
		case "number":
			return (
				<input
					type="number"
					className="h-8 w-[200px] min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 text-[12px] outline-none focus-visible:border-ring/60"
					value={value === undefined || value === null ? "" : String(value)}
					onChange={(event) => {
						const raw = event.target.value;
						onChange(raw === "" ? undefined : Number(raw));
					}}
				/>
			);
		case "secret":
			return (
				<input
					type="password"
					autoComplete="off"
					className="h-8 w-[240px] min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 text-[12px] outline-none focus-visible:border-ring/60"
					value={typeof value === "string" ? value : ""}
					onChange={(event) => onChange(event.target.value)}
				/>
			);
		case "enum":
			return (
				<MotionSelect
					value={typeof value === "string" ? value : ""}
					onValueChange={(next) => onChange(next)}
					placeholder={pleaseSelect}
					triggerClassName="min-w-[160px]"
					options={(schema.enum ?? []).map((option) => ({ value: option, label: option }))}
				/>
			);
		default:
			return (
				<input
					type="text"
					className="h-8 w-[240px] min-w-0 rounded-lg border border-border/60 bg-transparent px-2.5 text-[12px] outline-none focus-visible:border-ring/60"
					value={typeof value === "string" ? value : ""}
					onChange={(event) => onChange(event.target.value)}
				/>
			);
	}
}

function PluginSettingsSection({
	model,
	section,
}: {
	model: PluginsSettingsModel;
	section: PluginsSettingsModel["sections"][number];
}): JSX.Element {
	return (
		<SettingSection section={section.section} description={section.description}>
			{section.fields.map((field) => {
				if (field.schema.type === "desc") {
					return (
						<DescRow
							key={field.schema.key}
							title={field.title}
							description={field.description ?? ""}
							border={field.border}
						/>
					);
				}
				return (
					<SettingRow
						key={field.schema.key}
						title={field.title ?? ""}
						description={field.description}
						border={field.border}
					>
						<SettingControl
							field={field}
							pleaseSelect={model.labels.pleaseSelect}
							onChange={(value) => model.actions.update(section.pluginId, field.schema.key, value)}
						/>
					</SettingRow>
				);
			})}
		</SettingSection>
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
					{model.labels.noPlugin}
				</div>
			) : (
				model.sections.map((section) => (
					<PluginSettingsSection key={section.pluginId} model={model} section={section} />
				))
			)}
		</div>
	);
}
