import type { InstalledPlugin, PluginSettingSchema } from "@preload/api";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePluginI18n } from "../../plugins/runtime/plugin-i18n";
import type { SettingsSectionRegistration } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

type ValuesByPlugin = Record<string, Record<string, unknown>>;

export interface PluginSettingFieldModel {
	border: boolean;
	description?: string;
	schema: PluginSettingSchema;
	title?: string;
	value: unknown;
}

export interface PluginSettingsSectionModel {
	description?: string;
	fields: PluginSettingFieldModel[];
	pluginId: string;
	section: SettingsSectionRegistration;
}

export interface PluginsSettingsModel {
	actions: {
		update: (pluginId: string, key: string, value: unknown) => void;
	};
	labels: {
		noPlugin: string;
		pleaseSelect: string;
		title: string;
	};
	sections: PluginSettingsSectionModel[];
}

function isSettingVisible(setting: PluginSettingSchema, values: Record<string, unknown>): boolean {
	const condition = setting.visibleWhen;
	if (!condition) return true;
	const current = values[condition.key];
	return typeof current === "string" && condition.in.includes(current);
}

export function usePluginsSettingsModel(): PluginsSettingsModel {
	const { t } = useTranslation("settings");
	const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
	const [values, setValues] = useState<ValuesByPlugin>({});
	const tr = usePluginI18n();

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const all = await window.vetta.plugins.list();
			const configurable = all.filter((plugin) => (plugin.settingsSchema?.length ?? 0) > 0);
			if (cancelled) return;
			setPlugins(configurable);
			const entries = await Promise.all(
				configurable.map(async (plugin) => [plugin.id, await window.vetta.plugins.getSettings(plugin.id)] as const),
			);
			if (cancelled) return;
			setValues(Object.fromEntries(entries));
		})();
		const unsubscribe = window.vetta.plugins.onSettingsChanged(({ pluginId, values: next }) => {
			setValues((prev) => ({ ...prev, [pluginId]: next }));
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const update = (pluginId: string, key: string, value: unknown): void => {
		setValues((prev) => ({ ...prev, [pluginId]: { ...prev[pluginId], [key]: value } }));
		void window.vetta.plugins.setSettings(pluginId, { [key]: value });
		recordSettingsUsage({ tab: "plugins", action: "changed", target: "plugin-setting", value: pluginId });
	};

	const sections = useMemo<PluginSettingsSectionModel[]>(
		() =>
			plugins.map((plugin) => {
				const pluginValues = values[plugin.id] ?? {};
				const visible = (plugin.settingsSchema ?? []).filter((setting) => isSettingVisible(setting, pluginValues));
				const section: SettingsSectionRegistration = {
					id: `plugin-${plugin.id}`,
					tab: "plugins",
					title: tr(plugin, plugin.name),
					titleKey: `plugin-${plugin.id}`,
				};
				return {
					pluginId: plugin.id,
					section,
					description: plugin.description ? tr(plugin, plugin.description) : undefined,
					fields: visible.map((setting, index) => ({
						schema: setting,
						title: setting.title ? tr(plugin, setting.title) : undefined,
						description: setting.description ? tr(plugin, setting.description) : undefined,
						border: index < visible.length - 1,
						value: pluginValues[setting.key],
					})),
				};
			}),
		[plugins, tr, values],
	);

	return {
		actions: {
			update,
		},
		labels: {
			noPlugin: t("pluginSettings.noPlugin"),
			pleaseSelect: t("pleaseSelect"),
			title: t("pluginSettings.title"),
		},
		sections,
	};
}
