import type {
	DesktopRuntimeConfigurationCatalog,
	DesktopRuntimeConfigurationEntry,
	InstalledPlugin,
} from "@preload/api";
import type { RuntimeConfigurationJsonObject, RuntimeConfigurationJsonValue } from "@vetta/runtime-core/configuration";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePluginI18n } from "../../plugins/runtime/plugin-i18n";
import type { SettingsSectionRegistration } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

interface RuntimeFieldSchema {
	readonly type: "boolean" | "number" | "integer" | "string" | "secret" | "enum" | "desc";
	readonly enum?: readonly string[];
	readonly minimum?: number;
	readonly maximum?: number;
}

export interface PluginSettingFieldModel {
	border: boolean;
	configured: boolean;
	description?: string;
	path: readonly string[];
	schema: RuntimeFieldSchema;
	title?: string;
	value: RuntimeConfigurationJsonValue | undefined;
}

export interface PluginSettingsSectionModel {
	apply: string;
	configurationId: string;
	consumers: string[];
	description?: string;
	fields: PluginSettingFieldModel[];
	section: SettingsSectionRegistration;
}

export interface PluginsSettingsModel {
	actions: {
		update: (configurationId: string, path: readonly string[], value: RuntimeConfigurationJsonValue) => void;
	};
	labels: {
		apply: string;
		consumers: string;
		empty: string;
		pleaseSelect: string;
		secretConfigured: string;
		secretPlaceholder: string;
		title: string;
	};
	sections: PluginSettingsSectionModel[];
}

export function usePluginsSettingsModel(): PluginsSettingsModel {
	const { t } = useTranslation("settings");
	const [catalog, setCatalog] = useState<DesktopRuntimeConfigurationCatalog>();
	const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
	const tr = usePluginI18n();
	const translateDynamic = useCallback(
		(key: string, defaultValue?: string): string =>
			String(defaultValue === undefined ? t(key as never) : t(key as never, { defaultValue } as never)),
		[t],
	);

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			const [nextCatalog, installedPlugins] = await Promise.all([
				window.vetta.runtimeConfiguration.list(),
				window.vetta.plugins.list(),
			]);
			if (cancelled) return;
			setCatalog(nextCatalog);
			setPlugins(installedPlugins);
		};
		void load();
		const unsubscribe = window.vetta.runtimeConfiguration.onChanged(() => void load());
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const update = (configurationId: string, path: readonly string[], value: RuntimeConfigurationJsonValue): void => {
		const patch = createNestedPatch(path, value);
		setCatalog((current) => (current ? patchCatalog(current, configurationId, path, value) : current));
		void window.vetta.runtimeConfiguration.set(configurationId, patch).then(setCatalog, () => {
			void window.vetta.runtimeConfiguration.list().then(setCatalog);
		});
		recordSettingsUsage({
			tab: "plugins",
			action: "changed",
			target: "runtime-configuration",
			value: configurationId,
		});
	};

	const sections = useMemo(
		() => (catalog?.entries ?? []).map((entry) => createSectionModel(entry, plugins, tr, translateDynamic)),
		[catalog, plugins, tr, translateDynamic],
	);

	return {
		actions: { update },
		labels: {
			apply: t("runtimeConfiguration.applyLabel"),
			consumers: t("runtimeConfiguration.consumers"),
			empty: t("runtimeConfiguration.empty"),
			pleaseSelect: t("pleaseSelect"),
			secretConfigured: t("runtimeConfiguration.secretConfigured"),
			secretPlaceholder: t("runtimeConfiguration.secretPlaceholder"),
			title: t("runtimeConfiguration.title"),
		},
		sections,
	};
}

function createSectionModel(
	entry: DesktopRuntimeConfigurationEntry,
	plugins: readonly InstalledPlugin[],
	tr: (plugin: InstalledPlugin, value: string) => string,
	t: (key: string, defaultValue?: string) => string,
): PluginSettingsSectionModel {
	const pluginId = entry.owner.kind === "plugin" ? entry.owner.pluginId : undefined;
	const plugin = pluginId ? plugins.find(({ id }) => id === pluginId) : undefined;
	const title = plugin
		? tr(plugin, entry.descriptor.title)
		: t(`runtimeConfiguration.configurations.${entry.configurationId}.title`, entry.descriptor.title);
	const description = entry.descriptor.description
		? plugin
			? tr(plugin, entry.descriptor.description)
			: t(`runtimeConfiguration.configurations.${entry.configurationId}.description`, entry.descriptor.description)
		: undefined;
	const fields = plugin
		? pluginFields(entry, plugin, tr)
		: schemaFields(entry.descriptor.schema, entry.value).map((field) => ({
				...field,
				title: t(`runtimeConfiguration.fields.${field.path.join(".")}.title`, field.path.at(-1) ?? ""),
				description: t(`runtimeConfiguration.fields.${field.path.join(".")}.description`, "") || undefined,
			}));
	return {
		apply: t(`runtimeConfiguration.apply.${plugin ? "immediate" : entry.apply}`),
		configurationId: entry.configurationId,
		consumers: entry.consumers.map((consumer) => `${consumer.kind}:${consumer.id} · ${consumer.support}`),
		description,
		fields: fields.map((field, index) => ({ ...field, border: index < fields.length - 1 })),
		section: {
			id: `runtime-configuration-${entry.configurationId}`,
			tab: "plugins",
			title,
			titleKey: entry.configurationId,
		},
	};
}

function schemaFields(
	schema: RuntimeConfigurationJsonObject,
	value: RuntimeConfigurationJsonObject,
	prefix: readonly string[] = [],
): Omit<PluginSettingFieldModel, "border">[] {
	const properties = asRecord(schema.properties);
	if (!properties) return [];
	const result: Omit<PluginSettingFieldModel, "border">[] = [];
	for (const [key, rawFieldSchema] of Object.entries(properties)) {
		const fieldSchema = asRecord(rawFieldSchema);
		if (!fieldSchema) continue;
		const path = [...prefix, key];
		const fieldValue = valueAt(value, [key]);
		const objectValue = asRecord(fieldValue);
		if (fieldSchema.type === "object" && objectValue) {
			result.push(...schemaFields(fieldSchema, objectValue, path));
			continue;
		}
		const type = typeof fieldSchema.type === "string" ? fieldSchema.type : "string";
		if (!isFieldType(type)) continue;
		const enumValues = stringArray(fieldSchema.enum);
		result.push({
			configured: false,
			path,
			schema: {
				type,
				...(enumValues ? { enum: enumValues } : {}),
				...(typeof fieldSchema.minimum === "number" ? { minimum: fieldSchema.minimum } : {}),
				...(typeof fieldSchema.maximum === "number" ? { maximum: fieldSchema.maximum } : {}),
			},
			value: fieldValue,
		});
	}
	return result;
}

function pluginFields(
	entry: DesktopRuntimeConfigurationEntry,
	plugin: InstalledPlugin,
	tr: (plugin: InstalledPlugin, value: string) => string,
): Omit<PluginSettingFieldModel, "border">[] {
	const presentation = asRecord(entry.descriptor.presentation);
	const rawFields = Array.isArray(presentation?.fields) ? presentation.fields : [];
	return rawFields.flatMap((raw) => {
		const field = asRecord(raw);
		if (!field || typeof field.key !== "string" || typeof field.type !== "string" || !isFieldType(field.type))
			return [];
		const visibleWhen = asRecord(field.visibleWhen);
		const visibleValues = stringArray(visibleWhen?.in);
		if (visibleWhen && typeof visibleWhen.key === "string" && visibleValues) {
			const current = entry.value[visibleWhen.key];
			if (typeof current !== "string" || !visibleValues.includes(current)) return [];
		}
		const enumValues = stringArray(field.enum);
		const pointer = `/${escapeJsonPointer(field.key)}`;
		return [
			{
				configured: field.type === "secret" && entry.configuredSensitivePaths.includes(pointer),
				path: [field.key],
				schema: { type: field.type, ...(enumValues ? { enum: enumValues } : {}) },
				title: typeof field.title === "string" ? tr(plugin, field.title) : undefined,
				description: typeof field.description === "string" ? tr(plugin, field.description) : undefined,
				value: entry.value[field.key],
			},
		];
	});
}

function patchCatalog(
	catalog: DesktopRuntimeConfigurationCatalog,
	configurationId: string,
	path: readonly string[],
	value: RuntimeConfigurationJsonValue,
): DesktopRuntimeConfigurationCatalog {
	return {
		...catalog,
		entries: catalog.entries.map((entry) =>
			entry.configurationId === configurationId ? { ...entry, value: setAtPath(entry.value, path, value) } : entry,
		),
	};
}

function createNestedPatch(
	path: readonly string[],
	value: RuntimeConfigurationJsonValue,
): RuntimeConfigurationJsonObject {
	return setAtPath({}, path, value);
}

function setAtPath(
	root: RuntimeConfigurationJsonObject,
	path: readonly string[],
	value: RuntimeConfigurationJsonValue,
): RuntimeConfigurationJsonObject {
	const [head, ...tail] = path;
	if (!head) return root;
	return { ...root, [head]: tail.length === 0 ? value : setAtPath(asRecord(root[head]) ?? {}, tail, value) };
}

function valueAt(
	root: RuntimeConfigurationJsonObject,
	path: readonly string[],
): RuntimeConfigurationJsonValue | undefined {
	let current: RuntimeConfigurationJsonValue = root;
	for (const key of path) {
		const object = asRecord(current);
		if (!object) return undefined;
		current = object[key];
		if (current === undefined) return undefined;
	}
	return current;
}

function asRecord(value: unknown): RuntimeConfigurationJsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as RuntimeConfigurationJsonObject)
		: undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function isFieldType(value: string): value is RuntimeFieldSchema["type"] {
	return ["boolean", "number", "integer", "string", "secret", "enum", "desc"].includes(value);
}

function escapeJsonPointer(value: string): string {
	return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
