import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { usePluginTextResolver } from "@domains/plugins/runtime/plugin-i18n";
import {
	buildBundleAbilities,
	buildMcpAbilities,
	buildPluginAbilities,
	buildSkillAbilities,
	type LocalAbilityState,
} from "@domains/abilities/lib/build-ability-items";
import type { AbilityItem } from "@domains/abilities/types";
import type { AbilityLedger, InstalledPlugin, InstalledSkill, McpServerConfigData, SkillInfo } from "@preload/api";
import type { AddPanelCategory, AddPanelEntry } from "../components/command-panel/add-panel-catalog";
import { ADD_PANEL_CATEGORY_ICONS, addPanelEntryKey, splitIcon } from "../components/command-panel/add-panel-catalog";

/**
 * 添加面板的分类目录**直接来自能力页的同一套组装结果**。
 *
 * 这是 ADR-0177 §1「分类只由数据来源决定」的落地方式：面板不再自己扫 `mcp.json`、
 * 自己读插件清单、自己猜技能来源，而是复用能力页的 `build*Abilities()`。两者因此
 * **条目集合、名称、图标完全一致**——用户看到的「能力页有什么，这里就有什么」，
 * 不是靠两处规则写得像，而是同一份事实源。
 *
 * 取数范围只限本地安装态（不含市场目录）：面板是「往消息里插东西」，已装即可用，
 * 没有安装入口，因此不必为它拉一次市场快照。
 */
async function loadLocalAbilityState(): Promise<{
	ledger: AbilityLedger;
	skillManifest: Record<string, InstalledSkill>;
	skills: SkillInfo[];
	plugins: InstalledPlugin[];
	mcpServers: Record<string, McpServerConfigData>;
}> {
	const [ledger, skillManifest, skills, plugins, mcp] = await Promise.all([
		window.astravia.abilities.getLedger(),
		window.astravia.skills.getMarketManifest(),
		window.astravia.skills.list(),
		window.astravia.plugins?.listAll?.() ?? Promise.resolve([]),
		window.astravia.mcp.get(),
	]);
	return { ledger, skillManifest, skills, plugins, mcpServers: mcp.mcpServers ?? {} };
}

/** 能力条目 → 面板条目。分类由 `type` 决定，分组由「谁装的」决定。 */
export function projectAbilityEntries(items: readonly AbilityItem[]): AddPanelEntry[] {
	const entries: AddPanelEntry[] = [];
	for (const item of items) {
		if (!item.installed || !item.enabled) continue;
		const category = categoryOf(item);
		if (!category) continue;
		entries.push({
			category,
			id: item.id,
			key: addPanelEntryKey(category, item.id),
			label: item.title || item.slug,
			description: item.description,
			...splitIcon(item.icon),
			groupId: groupOf(item),
			searchable: category !== "files",
			fallbackIcon: ADD_PANEL_CATEGORY_ICONS[category],
		});
	}
	// 同名同类的条目只保留一条：能力页按 id 去重，面板再多一条会让人以为装了两份。
	const unique = new Map<string, AddPanelEntry>();
	for (const entry of entries) {
		const dedupeKey = `${entry.category}:${entry.label}`;
		if (!unique.has(dedupeKey)) unique.set(dedupeKey, entry);
	}
	return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function categoryOf(item: AbilityItem): AddPanelCategory | undefined {
	if (item.type === "skill") return "skills";
	if (item.type === "mcp") return "connectors";
	if (item.type === "plugin") return "plugins";
	if (item.type === "bundle") return "apps";
	return undefined;
}

/**
 * 分组：与能力页的「内置 / 市场 / 我的」判据一致。
 *
 * - `isBuiltin`：随 App 分发的内置能力（skill-presets、系统插件、内置 MCP 预设）；
 * - 插件贡献的技能归「插件」；
 * - 从市场装的归「市场」；
 * - 其余（用户自己的目录、通用 Agent 目录）归「我的」。
 */
function groupOf(item: AbilityItem): string {
	if (item.type === "mcp") return "connected";
	if (item.type === "plugin") return "installed";
	if (item.type === "bundle") return "mine";
	if (item.isBuiltin) return "builtin";
	if (item.skillProvenance?.kind === "provided") return "plugin";
	if (item.fromMarket) return "market";
	if (item.isCustom) return "mine";
	return "mine";
}

export function useAddPanelAbilityEntries(open: boolean): readonly AddPanelEntry[] {
	const { t } = useTranslation("settings");
	const trPlugin = usePluginTextResolver();
	const [state, setState] = useState<{
		ledger: AbilityLedger;
		skillManifest: Record<string, InstalledSkill>;
		skills: SkillInfo[];
		plugins: InstalledPlugin[];
		mcpServers: Record<string, McpServerConfigData>;
	} | null>(null);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		void loadLocalAbilityState()
			.then((value) => {
				if (!cancelled) setState(value);
			})
			.catch((error: unknown) => {
				console.warn("[useAddPanelAbilityEntries] load failed:", error);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	return useMemo(() => {
		if (!state) return [];
		const localState = {
			ledger: state.ledger,
			mcpSetupStatus: {},
			skillManifest: state.skillManifest,
			// 能力页同样只把「不由台账管理」的来源当本地只读技能；这里保持一致。
			localSkills: state.skills.filter((skill) => skill.source.startsWith("agents-") || skill.source === "builtin"),
			plugins: state.plugins,
			mcpConfig: { mcpServers: state.mcpServers },
			oauthAuthByName: {},
			busyIds: new Set<string>(),
		} as unknown as LocalAbilityState;
		const skills = buildSkillAbilities([], localState);
		const mcps = buildMcpAbilities([], localState, t);
		const plugins = buildPluginAbilities([], localState, trPlugin);
		const bundles = buildBundleAbilities([], [...skills, ...mcps, ...plugins], localState, t);
		return projectAbilityEntries([...skills, ...mcps, ...plugins, ...bundles]);
	}, [state, t, trPlugin]);
}
