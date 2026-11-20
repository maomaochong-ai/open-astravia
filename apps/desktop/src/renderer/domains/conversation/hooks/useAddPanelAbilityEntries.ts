import { isSkillVisibleOnSurface } from "@astravia-org/capability-sdk";
import { isAbilityListedInDiscover, isAbilityListedInPersonal } from "@domains/abilities/lib/ability-catalog-query";
import { localizeMarketAbility } from "@domains/abilities/lib/ability-presentation";
import {
	buildBundleAbilities,
	buildMcpAbilities,
	buildPluginAbilities,
	buildSkillAbilities,
	type LocalAbilityState,
} from "@domains/abilities/lib/build-ability-items";
import { mergeAbilityCatalogs } from "@domains/abilities/lib/merge-ability-catalogs";
import type { AbilityItem } from "@domains/abilities/types";
import { usePluginTextResolver } from "@domains/plugins/runtime/plugin-i18n";
import type {
	AbilityLedger,
	InstalledPlugin,
	InstalledSkill,
	McpServerConfigData,
	OpenMarketplaceCatalog,
	SkillInfo,
} from "@preload/api";
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
 * 市场目录只读本地快照（`listOpenMarketplaces`，不强制刷新）：能力页的标题 / 简介取自
 * 市场行的本地化字段（`detail.i18n`），不传它就只能回落到清单里的英文 alias——同一个包
 * 在能力页叫「Pocock 工程流」，面板里却成了英文名。
 */
async function loadLocalAbilityState(): Promise<{
	ledger: AbilityLedger;
	skillManifest: Record<string, InstalledSkill>;
	skills: SkillInfo[];
	plugins: InstalledPlugin[];
	mcpServers: Record<string, McpServerConfigData>;
	marketplace: OpenMarketplaceCatalog | null;
}> {
	const [ledger, skillManifest, skills, plugins, mcp, marketplace] = await Promise.all([
		window.astravia.abilities.getLedger(),
		window.astravia.skills.getMarketManifest(),
		window.astravia.skills.list(),
		window.astravia.plugins?.listAll?.() ?? Promise.resolve([]),
		// 宿主缺 mcp 命名空间时按空配置处理：面板是「顺手插东西」的地方，不该因此崩掉。
		window.astravia.mcp?.get?.() ?? Promise.resolve({ mcpServers: {} }),
		// 市场快照读不到（首次启动、源未同步）时按空目录处理：面板仍能用本地安装态。
		window.astravia.abilities
			.listOpenMarketplaces()
			.catch(() => null),
	]);
	return { ledger, skillManifest, skills, plugins, mcpServers: mcp.mcpServers ?? {}, marketplace };
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
		// 分类＝能力类型本身（见 ADR-0183）：四种类型各归一类，套装也是独立分类，
		// 不列它会让「已安装的套装」在左栏永远是一片空白。
		const category: AddPanelCategory = item.type;
		const icon = item.icon ?? (item.type === "skill" ? skillIcons?.get(item.slug) : undefined);
		const groupId = groupOf(item);
		entries.push({
			category,
			id: item.id,
			key: addPanelEntryKey(category, item.id),
			label: item.title || item.slug,
			description: item.description,
			...splitIcon(icon),
			groupId,
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
 * 只有技能才带 `skillSource` / `skillProvenance`（其余类型各有自己的来源字段），
 * 联合类型上直接取会报「属性不存在」，这里收窄一次。
 */
type SkillAbilityItem = Extract<AbilityItem, { type: "skill" }>;

function skillMeta(item: AbilityItem): Pick<SkillAbilityItem, "skillSource" | "skillProvenance"> {
	const empty: Pick<SkillAbilityItem, "skillSource" | "skillProvenance"> = {};
	return item.type === "skill" ? item : empty;
}

/** 是否为从市场装上来的条目（含清单里 provenance 记为 market 的技能）。 */
function isFromMarket(item: AbilityItem): boolean {
	if (item.fromMarket) return true;
	if (item.origin?.kind === "github-marketplace") return true;
	const { skillProvenance } = skillMeta(item);
	return skillProvenance?.kind === "native" && skillProvenance.scope === "market";
}

/**
 * 分组：与能力页的来源判据一致，但把「通用 Agent 技能」单独提出来。
 *
 * - `builtin`：随 App 分发的内置能力（skill-presets、系统插件、内置 MCP 预设）；
 * - `market`：从市场安装的能力（技能 / 连接器 / 套装 / 插件都一样看来源，不看类型——
 *   否则市场装的连接器会落进「已连接」，「市场」视图里就少一块）；
 * - `plugin`：插件贡献的技能；
 * - `agents`：`~/.agents/skills`、项目 `.agents/skills` 里符合通用约定的技能。
 *   这类技能由设置项「适配通用 Agent Skill」控制，关掉后主进程根本不会返回，
 *   面板也就不该出现；单独成组是为了不和用户自己装的技能混在「我的」里；
 * - `connected` / `installed` / `mine`：本地 MCP server、本地插件、用户自己的技能。
 */
function groupOf(item: AbilityItem): string {
	// 「内置」优先：能力页把 skill-presets、**系统插件**、内置 MCP 预设都算 Astravia 内置，
	// 面板必须同口径——否则随 App 分发的十几个系统插件会被当成第三方扩展。
	// 随 App 分发的技能只有 `skillSource === "builtin"` / provenance `builtin` 这一种标记，
	// 不认它就会全部落进「我的」，和用户自己装的技能混成一堆。
	const { skillSource, skillProvenance } = skillMeta(item);
	/*
	 * 来源事实优先于标记：明明是从市场装的条目，不该因为能力条目上残留了 builtin 标记
	 * （例如插件 source 被归一成 system、或技能来自包内自带图标）就归到「内置」。
	 * 反过来，「内置」只用于确实随 App 分发的条目。
	 */
	if (isFromMarket(item)) return "market";
	if (item.isBuiltin || skillSource === "builtin" || skillProvenance?.kind === "builtin") {
		return "builtin";
	}
	if (item.type === "plugin") return "installed";
	if (item.type === "mcp") return "connected";
	if (item.type === "bundle") return "mine";
	// 插件贡献的技能在「技能」分类里自成一组：与「插件」分类里的插件条目不是一回事，
	// 两组都叫「插件」会让用户分不清一个是插件、一个是用它提供的技能。
	if (skillProvenance?.kind === "provided") return "provided";
	if (skillSource?.startsWith("agents-")) return "agents";
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
	const { t, i18n } = useTranslation("settings");
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
		marketplace: OpenMarketplaceCatalog | null;
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
			/*
			 * 技能条目按**表面可见性**收录，与上游同一判据：`commandPalette` 上可见才进列表。
			 *
			 * 不能按来源排除插件贡献的技能——插件声明的可见技能正是「插件能被插进对话」的
			 * 唯一通道（插件本身不产出文本，见 ADR-0183「行的一等公民」）。此前整体排除
			 * `source !== "plugin"`，结果插件的技能一律消失，只剩一行只读的插件条目。
			 *
			 * 组合包（如 Pocock 工程流）内的成员技能由扫描器报成 `user` 来源、不在清单里，
			 * 同样要收，否则它们会整批消失、面板只剩那个包本身。
			 */
			localSkills: state.skills.filter((skill) => isSkillVisibleOnSurface(skill, "commandPalette")),
			plugins: state.plugins,
			mcpConfig: { mcpServers: state.mcpServers },
			oauthAuthByName: {},
			busyIds: new Set<string>(),
		};
		// 市场行按界面语言归一后再交给组装函数：标题 / 简介与能力页同一份文案。
		const market = (state.marketplace ? mergeAbilityCatalogs([], state.marketplace.snapshots) : []).map((entry) =>
			localizeMarketAbility(entry, i18n.language),
		);
		const skills = buildSkillAbilities(market, localState, "commandPalette");
		const mcps = buildMcpAbilities(market, localState, t);
		const plugins = buildPluginAbilities(market, localState, trPlugin);
		const bundles = buildBundleAbilities(market, [...skills, ...mcps, ...plugins], localState, t);
		// 只收「清单里真有图标」的那些：把 `undefined` 也塞进表里会把同名 slug 占住，
		// 后面市场目录的图标就再也补不进来了。
		const skillIcons = new Map<string, string | undefined>(
			state.skills.filter((skill) => skill.icon).map((skill) => [skill.name, skill.icon]),
		);
		// 市场目录的图标键是 `${type}:${slug}`，去前缀后按 slug 补进技能图标表——
		// 否则市场装来的技能（含 bundle 成员）在面板里全落默认图，看不出谁是谁。
		for (const [key, icon] of marketIconMap) {
			const slug = key.split(":").pop();
			if (slug && !skillIcons.has(slug)) skillIcons.set(slug, icon);
		}
		return projectAbilityEntries(
			[...skills, ...mcps, ...plugins, ...bundles].filter((item) => {
				/*
				 * 两条门槛都过才进面板：
				 *
				 * 1. **装在本地**（`installed && enabled`）——面板是「往消息里插一块已经可用的
				 *    东西」，没装的能力插进去也没意义；
				 * 2. **能力页会列出它**（`isAbilityListedInDiscover` / `isAbilityListedInPersonal`
				 *    ）——否则会出现「面板里有、能力页怎么都找不到」的条目，用户只会认为识别错了。
				 *    典型例子：`mcp.json` 里残留一个内置预置连接器，它既不是市场安装、也不是
				 *    手动添加，能力页两个分区都不展示，面板却凭「配置里有」把它列了出来。
				 *
				 * 内置能力是例外：随 App 分发、装好即在，不再要求它出现在能力页的两个分区里。
				 */
				// 装在本地且已启用，是**先决条件**：市场目录里的未安装行 `fromMarket` 也是 true，
				// 任何「来源放行」都必须排在它后面，否则面板会把没装的能力一起列出来。
				if (!item.installed || !item.enabled) return false;
				// 来源只影响分组，不影响出现与否：市场装的、内置的都该列出来。
				if (item.isBuiltin || isFromMarket(item)) return true;
				if (isAbilityListedInDiscover(item) || isAbilityListedInPersonal(item)) return true;
				/*
				 * 清单里登记为市场安装的技能：能力页要等市场快照同步后才显示它，面板不必一起等。
				 * 这类「装了但目录里暂时没有这一行」的技能是真实可用的，藏起来反而像丢了。
				 */
				const { skillProvenance } = skillMeta(item);
				// 插件贡献的技能在能力页以「插件」条目呈现，自身不进两个分区；但它们在
				// `commandPalette` 上可见时就是可插入行（见 ADR-0183），面板不能漏掉。
				if (skillProvenance?.kind === "provided") return true;
				return skillProvenance?.kind === "native" && skillProvenance.scope === "market";
			}),
			skillIcons,
		);
	}, [state, t, trPlugin, marketIconMap, i18n.language]);

	useEffect(() => {
		if (entries.length > 0) entryCache = entries;
	}, [entries]);

	return entries;
}
