import type { DesktopRuntimeConfigurationCatalog } from "@preload/api";
import type { RuntimeConfigurationJsonObject, RuntimeConfigurationJsonValue } from "@vetta/runtime-core/configuration";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { recordSettingsUsage } from "./recordSettingsUsage";

interface RuntimeFieldSchema {
	readonly type: "boolean" | "number" | "integer" | "string" | "enum";
	readonly enum?: readonly string[];
	readonly minimum?: number;
	readonly maximum?: number;
}

export interface RuntimeConfigurationFieldModel {
	border: boolean;
	description?: string;
	path: readonly string[];
	schema: RuntimeFieldSchema;
	title: string;
	value: RuntimeConfigurationJsonValue | undefined;
}

export interface RuntimeConfigurationSectionModel {
	apply: string;
	configurationId: string;
	description?: string;
	fields: RuntimeConfigurationFieldModel[];
	title: string;
}

export interface RuntimeConfigurationModel {
	actions: {
		update: (configurationId: string, path: readonly string[], value: RuntimeConfigurationJsonValue) => void;
	};
	labels: {
		apply: string;
		pleaseSelect: string;
	};
	sections: RuntimeConfigurationSectionModel[];
}

/**
 * 内置运行时配置（目前只有 `coding.images`）的读写模型。
 *
 * 插件配置不在此列：插件自己渲染配置界面并持久化（ADR-0105）。
 */
export function useRuntimeConfigurationModel(): RuntimeConfigurationModel {
	const { t } = useTranslation("settings");
	const [catalog, setCatalog] = useState<DesktopRuntimeConfigurationCatalog>();
	const translate = useCallback(
		(key: string, defaultValue: string): string => String(t(key as never, { defaultValue } as never)),
		[t],
	);

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			const next = await window.vetta.runtimeConfiguration.list();
			if (!cancelled) setCatalog(next);
		};
		void load();
		const unsubscribe = window.vetta.runtimeConfiguration.onChanged(() => void load());
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const update = (configurationId: string, path: readonly string[], value: RuntimeConfigurationJsonValue): void => {
		setCatalog((current) => (current ? patchCatalog(current, configurationId, path, value) : current));
		void window.vetta.runtimeConfiguration.set(configurationId, setAtPath({}, path, value)).then(setCatalog, () => {
			void window.vetta.runtimeConfiguration.list().then(setCatalog);
		});
		recordSettingsUsage({
			tab: "agent",
			action: "changed",
			target: "runtime-configuration",
			value: configurationId,
		});
	};

	const sections = useMemo(
		() =>
			(catalog?.entries ?? []).map((entry): RuntimeConfigurationSectionModel => {
				const fields = schemaFields(entry.descriptor.schema, entry.value).map((field) => ({
					...field,
					title: translate(`runtimeConfiguration.fields.${field.path.join(".")}.title`, field.path.at(-1) ?? ""),
					description:
						translate(`runtimeConfiguration.fields.${field.path.join(".")}.description`, "") || undefined,
				}));
				return {
					apply: translate(`runtimeConfiguration.apply.${entry.apply}`, entry.apply),
					configurationId: entry.configurationId,
					title: translate(
						`runtimeConfiguration.configurations.${entry.configurationId}.title`,
						entry.descriptor.title,
					),
					description:
						translate(
							`runtimeConfiguration.configurations.${entry.configurationId}.description`,
							entry.descriptor.description ?? "",
						) || undefined,
					fields: fields.map((field, index) => ({ ...field, border: index < fields.length - 1 })),
				};
			}),
		[catalog, translate],
	);

	return {
		actions: { update },
		labels: {
			apply: t("runtimeConfiguration.applyLabel"),
			pleaseSelect: t("pleaseSelect"),
		},
		sections,
	};
}

function schemaFields(
	schema: RuntimeConfigurationJsonObject,
	value: RuntimeConfigurationJsonObject,
	prefix: readonly string[] = [],
): Omit<RuntimeConfigurationFieldModel, "border" | "title">[] {
	const properties = asRecord(schema.properties);
	if (!properties) return [];
	const result: Omit<RuntimeConfigurationFieldModel, "border" | "title">[] = [];
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
	return ["boolean", "number", "integer", "string", "enum"].includes(value);
}
