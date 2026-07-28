import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BuiltinMcpSectionView } from "@vetta/theme-ui/settings";
import {
	BUILTIN_MCP_PRESETS,
	type BuiltinMcpPreset,
	getListedBuiltinMcpPresets,
	presetRequiresSecrets,
	resolveMcpPresetDescription,
	resolveMcpPresetDisplayName,
	resolveMcpPresetIconUrl,
} from "../mcp/builtin-mcp-presets";
import { SETTINGS_SECTION } from "../registry";

export function BuiltinMcpSection({
	addedNames,
	onAdd,
	onRemove,
	busyName,
	variant = "full",
}: {
	addedNames: Set<string>;
	onAdd: (preset: BuiltinMcpPreset) => Promise<void> | void;
	onRemove: (name: string) => Promise<void> | void;
	busyName: string | null;
	/** discover：展示全部推荐（含已添加，卡片标「已添加」） */
	variant?: "full" | "discover";
}): JSX.Element {
	const { t } = useTranslation("settings");
	const listedPresets = useMemo(() => getListedBuiltinMcpPresets(), []);
	const items = useMemo(
		() =>
			listedPresets.map((preset) => ({
				id: String(preset.id),
				name: preset.name,
				displayName: resolveMcpPresetDisplayName(preset, (key) => t(key)),
				description: resolveMcpPresetDescription(preset, (key) => t(key)),
				iconUrl: resolveMcpPresetIconUrl(preset),
				needsKey: presetRequiresSecrets(preset),
			})),
		[listedPresets, t],
	);

	const byName = useMemo(() => {
		// 匹配仍用全量预设：已添加但未 listed 的项在「我的」里仍可识别
		const map = new Map(BUILTIN_MCP_PRESETS.map((preset) => [preset.name, preset]));
		return map;
	}, []);

	return (
		<BuiltinMcpSectionView
			items={items}
			addedNames={addedNames}
			busyName={busyName}
			variant={variant}
			section={SETTINGS_SECTION["mcp-builtin-available"]}
			labels={{
				listTitle: t("section_mcp-builtin-list"),
				sectionHint: t("mcpPresets.sectionHint"),
				allAdded: t("mcpStore.recommendedAllAdded"),
				added: t("added"),
				processing: t("processing"),
				connect: t("mcpPresets.connect"),
				add: t("add"),
				remove: t("remove"),
			}}
			onAdd={(name) => {
				const preset = byName.get(name);
				if (preset) void onAdd(preset);
			}}
			onRemove={(name) => void onRemove(name)}
		/>
	);
}
