import { MotionSelect, SettingRow, SettingSection } from "@vetta/theme-ui/settings";
import { Input, Switch } from "@vetta/ui";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { SettingsAiAssist } from "../ai-assist";
import type { PluginSettingFieldModel, PluginsSettingsModel } from "./usePluginsSettingsModel";

function SettingControl({
	field,
	onChange,
	pleaseSelect,
	secretConfigured,
	secretPlaceholder,
}: {
	field: PluginSettingFieldModel;
	onChange: (value: string | number | boolean) => void;
	pleaseSelect: string;
	secretConfigured: string;
	secretPlaceholder: string;
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
	if (schema.type === "secret") {
		return (
			<SecretSettingControl
				configured={field.configured}
				onChange={onChange}
				configuredPlaceholder={secretConfigured}
				emptyPlaceholder={secretPlaceholder}
			/>
		);
	}
	if (!numeric) {
		return <StringSettingControl value={typeof value === "string" ? value : ""} onChange={onChange} />;
	}
	return (
		<Input
			type="number"
			min={schema.minimum}
			max={schema.maximum}
			step={schema.type === "integer" ? 1 : undefined}
			className="h-9 w-[260px] border-border bg-input text-[13px] text-foreground shadow-sm dark:bg-input/60"
			value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
			onChange={(event) => {
				if (event.target.value !== "") onChange(Number(event.target.value));
			}}
		/>
	);
}

function StringSettingControl({ value, onChange }: { value: string; onChange: (value: string) => void }): JSX.Element {
	const [draft, setDraft] = useState(value);
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (document.activeElement !== input.current) setDraft(value);
	}, [value]);

	return (
		<Input
			ref={input}
			type="text"
			className="h-9 w-[260px] border-border bg-input text-[13px] text-foreground shadow-sm dark:bg-input/60"
			value={draft}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={() => {
				if (draft !== value) onChange(draft);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
			}}
		/>
	);
}

function SecretSettingControl({
	configured,
	onChange,
	configuredPlaceholder,
	emptyPlaceholder,
}: {
	configured: boolean;
	onChange: (value: string) => void;
	configuredPlaceholder: string;
	emptyPlaceholder: string;
}): JSX.Element {
	const [draft, setDraft] = useState("");
	const committed = useRef("");
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!configured || document.activeElement === input.current) return;
		committed.current = "";
		setDraft("");
	}, [configured]);

	const commit = (): void => {
		if (draft === committed.current) return;
		committed.current = draft;
		onChange(draft);
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
		if (event.key !== "Enter") return;
		commit();
		event.currentTarget.blur();
	};

	return (
		<Input
			ref={input}
			type="password"
			autoComplete="new-password"
			className="h-9 w-[260px] border-border bg-input text-[13px] text-foreground shadow-sm placeholder:text-muted-foreground dark:bg-input/60"
			value={draft}
			placeholder={configured ? configuredPlaceholder : emptyPlaceholder}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={handleKeyDown}
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
									secretConfigured={model.labels.secretConfigured}
									secretPlaceholder={model.labels.secretPlaceholder}
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
