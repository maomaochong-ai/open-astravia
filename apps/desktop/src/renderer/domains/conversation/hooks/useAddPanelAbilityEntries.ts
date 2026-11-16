import { isAbilityListedInPersonal, isManuallyInstalledAbility } from "@domains/abilities/lib/ability-catalog-query";
import {
	buildBundleAbilities,
	buildMcpAbilities,
	buildPluginAbilities,
	buildSkillAbilities,
	type LocalAbilityState,
} from "@domains/abilities/lib/build-ability-items";
import type { AbilityItem } from "@domains/abilities/types";
import { usePluginTextResolver } from "@domains/plugins/runtime/plugin-i18n";
import type { AbilityLedger, InstalledPlugin, InstalledSkill, McpServerConfigData, SkillInfo } from "@preload/api";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AddPanelCategory, AddPanelEntry } from "../components/command-panel/add-panel-catalog";
import { ADD_PANEL_CATEGORY_ICONS, addPanelEntryKey, splitIcon } from "../components/command-panel/add-panel-catalog";
import { useSkillIconMap } from "./useSkillIconMap";

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
		// 宿主缺 mcp 命名空间时按空配置处理：面板是「顺手插东西」的地方，不该因此崩掉。
		window.astravia.mcp?.get?.() ?? Promise.resolve({ mcpServers: {} }),
	]);
	return { ledger, skillManifest, skills, plugins, mcpServers: mcp.mcpServers ?? {} };
}

/**
 * 能力条目 → 面板条目。分类由 `type` 决定，分组由「谁装的」决定。
 *
 * `skillIcons` 是 `skills.list()` 里按名字索引的图标：能力页的市场行带图标，而面板不拉
 * 市场快照，走清单分支的技能条目上就没有 `icon` 字段——不补这一层，安装来的技能在面板里
 * 全是默认图，看着像「没识别出来」。
 */
export function projectAbilityEntries(
	items: readonly AbilityItem[],
	skillIcons?: ReadonlyMap<string, string | undefined>,
): AddPanelEntry[] {
	const entries: AddPanelEntry[] = [];
	for (const item of items) {
		if (!item.installed || !item.enabled) continue;
		const category = categoryOf(item);
		if (!category) continue;
		const icon = item.icon ?? (item.type === "skill" ? skillIcons?.get(item.slug) : undefined);
		entries.push({
			category,
			id: item.id,
			key: addPanelEntryKey(category, item.id),
			label: item.title || item.slug,
			description: item.description,
			...splitIcon(icon),
			groupId: groupOf(item),
			kind: item.type,
			searchable: true,
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

/**
 * 能力类型 → 面板分类（键与能力页类型一致，见 ADR-0183）。
 *
 * `bundle`（能力套装）不映射：它的成员已经各自出现在技能/连接器/插件分类里，
 * 再以套装出现就重复了一遍；面板的套装分类因此保持空态。
 */
function categoryOf(item: AbilityItem): AddPanelCategory | undefined {
	if (item.type === "skill") return "skill";
	if (item.type === "mcp") return "mcp";
	if (item.type === "plugin") return "plugin";
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
	// 「内置」优先：能力页把 skill-presets、通用 Agent Skill、**系统插件**都算 Astravia 内置，
	// 面板必须同口径——否则随 App 分发的十几个系统插件会被当成「插件」分类里的第三方扩展。
	if (item.isBuiltin) return "builtin";
	if (item.type === "mcp") return "connected";
	if (item.type === "plugin") return "installed";
	if (item.type === "bundle") return "mine";
	if (item.skillProvenance?.kind === "provided") return "plugin";
	// 市场安装：能力页里这部分来自市场行（`fromMarket`），面板不拉市场快照，
	// 因此还要认清单写进 provenance 的 `market` scope。
	if (item.fromMarket) return "market";
	if (item.skillProvenance?.kind === "native" && item.skillProvenance.scope === "market") return "market";
	if (item.isCustom) return "mine";
	return "mine";
}

/**
 * 上一次打开时的条目（模块级缓存）。
 *
 * 这份数据要串五个 IPC（台账 / 清单 / 技能 / 插件 / mcp 配置），冷读一次两百毫秒上下。
 * 每次展开都从零开始读，用户看到的就是「点了之后先空一下、内容才冒出来」。缓存之后
 * 再打开时立刻用上一份渲染，同时后台刷新——与 `useSkillList` 同一条 stale-while-revalidate
 * 思路，只是这里连「骨架」都不需要，直接给上次的列表。
 */
let entryCache: readonly AddPanelEntry[] = [];
/** 上次成功读取的时间：短时间内重复开合不必再串一次五个 IPC。 */
let lastLoadAt = 0;
const RELOAD_AFTER_MS = 5_000;

export function useAddPanelAbilityEntries(open: boolean): readonly AddPanelEntry[] {
	const { t } = useTranslation("settings");
	const trPlugin = usePluginTextResolver();
	// 市场技能不在 skills.list() 里（它们只进 skills-manifest），图标得从市场目录补。
	// 与命令区共用的 useSkillIconMap 有模块级缓存：命令面板已经拉过时这里零成本命中。
	const marketIconMap = useSkillIconMap(open, true);
	const [state, setState] = useState<{
		ledger: AbilityLedger;
		skillManifest: Record<string, InstalledSkill>;
		skills: SkillInfo[];
		plugins: InstalledPlugin[];
		mcpServers: Record<string, McpServerConfigData>;
	} | null>(null);

	useEffect(() => {
		if (!open) return;
		// 刚读过就跳过：面板会被反复开合，每次都串五个 IPC 是「点了以后慢半拍」的主因。
		if (state && Date.now() - lastLoadAt < RELOAD_AFTER_MS) return;
		let cancelled = false;
		void loadLocalAbilityState()
			.then((value) => {
				if (cancelled) return;
				lastLoadAt = Date.now();
				setState(value);
			})
			.catch((error: unknown) => {
				console.warn("[useAddPanelAbilityEntries] load failed:", error);
			});
		return () => {
			cancelled = true;
		};
	}, [open, state]);

	const entries = useMemo(() => {
		if (!state) return entryCache;
		const localState: LocalAbilityState = {
			ledger: state.ledger,
			mcpSetupStatus: {},
			skillManifest: state.skillManifest,
			// 能力页同样只把「不由台账管理」的来源当本地只读技能；这里保持一致。
			localSkills: state.skills.filter((skill) => skill.source.startsWith("agents-") || skill.source === "builtin"),
			plugins: state.plugins,
			mcpConfig: { mcpServers: state.mcpServers },
			oauthAuthByName: {},
			busyIds: new Set<string>(),
		};
		const skills = buildSkillAbilities([], localState);
		const mcps = buildMcpAbilities([], localState, t);
		const plugins = buildPluginAbilities([], localState, trPlugin);
		const bundles = buildBundleAbilities([], [...skills, ...mcps, ...plugins], localState, t);
		const skillIcons = new Map<string, string | undefined>(state.skills.map((skill) => [skill.name, skill.icon]));
		// 市场目录的图标键是 `${type}:${slug}`，去前缀后按 slug 补进技能图标表——
		// 否则市场装来的技能（含 bundle 成员）在面板里全落默认图，看不出谁是谁。
		for (const [key, icon] of marketIconMap) {
			const slug = key.split(":").pop();
			if (slug && !skillIcons.has(slug)) skillIcons.set(slug, icon);
		}
		return projectAbilityEntries(
			[...skills, ...mcps, ...plugins, ...bundles].filter((item) => {
				if (item.isBuiltin) return true;
				/*
				 * 连接器：只列**用户自己的** server。
				 *
				 * 从市场装来的连接器（台账 origin = github-marketplace）与命中内置预置的连接器
				 * 属于能力页的「公开」分区，个人分区里没有；把它们塞进面板就会出现
				 * 「能力页明明没有 `Cloudflare 文档 / Cloudflare API`，面板却列了两条」。
				 * 这里显式按这两条判定，不依赖 `isManuallyInstalledAbility` 的间接推断。
				 */
				if (item.type === "mcp") {
					return item.installed && item.origin?.kind !== "github-marketplace" && !item.preset;
				}
				/*
				 * 技能：**装了就列**，不再区分来源。
				 *
				 * 能力页把市场技能放在「公开」分区（因为那边有市场行），面板没有市场行，
				 * 若照搬那条分区规则，用户从市场装的技能（如表格 / PDF 工具包）在面板里
				 * 就完全看不到——而它们恰恰是最常用的那批。
				 */
				if (item.type === "skill") return item.installed;
				// 插件与应用：与能力页个人分区口径一致（手动安装的插件）+ 内置。
				return isAbilityListedInPersonal(item) || isManuallyInstalledAbility(item);
			}),
			skillIcons,
		);
	}, [state, t, trPlugin, marketIconMap]);

	useEffect(() => {
		if (entries.length > 0) entryCache = entries;
	}, [entries]);

	return entries;
}
