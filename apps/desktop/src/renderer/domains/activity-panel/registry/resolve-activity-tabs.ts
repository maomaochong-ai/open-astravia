import { explicitTabVisibility } from "@shared/lib/tab-visibility";
import type { ActivityTabDefinition, ActivityTabId, ActivityTabMeta, ResolvedActivityTab } from "./types";

function toResolved(def: ActivityTabDefinition, meta: ActivityTabMeta): ResolvedActivityTab {
	return {
		id: def.id,
		label: meta.label,
		icon: meta.icon,
		badge: meta.badge,
		removable: def.removable !== false,
		source: def.source,
		pluginId: def.pluginId,
		pluginName: def.pluginName,
		definition: def,
	};
}

/** 用户拖拽顺序优先；未记录的 id 保持相对自然序（注册/order 序）。 */
export function applyTabOrder<T extends { id: ActivityTabId }>(items: T[], order: string[]): T[] {
	if (order.length === 0) return items;
	const rank = (id: string): number => {
		const index = order.indexOf(id);
		return index === -1 ? Number.MAX_SAFE_INTEGER : index;
	};
	return items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => rank(a.item.id) - rank(b.item.id) || a.index - b.index)
		.map(({ item }) => item);
}

/**
 * 可见性记录的 key：canonical `plugin:<pluginId>:<tabId>` → `<pluginId>:<tabId>`；
 * 内置 tab 用它自己的稳定 id（`browser`），与插件 key 不会撞车。
 */
function tabAttachKey(def: ActivityTabDefinition): string {
	if (def.id.startsWith("plugin:")) return def.id.slice("plugin:".length);
	if (def.pluginId) return `${def.pluginId}:${def.id}`;
	return def.id;
}

/** 插件上栏：显式 attach 记录优先，否则 initiallyVisible（缺省 true）。 */
export function isPluginTabOnBar(def: ActivityTabDefinition, tabVisibilityRecords: readonly string[]): boolean {
	const key = tabAttachKey(def);
	return explicitTabVisibility(tabVisibilityRecords, key) ?? def.initiallyVisible !== false;
}

/** 内置 tab 的去向：上栏 / 「+」菜单的已隐藏池 / 「+」菜单的可添加池。 */
export type BuiltinTabPlacement = "bar" | "hidden" | "available";

/**
 * 内置 tab 的去向。
 *
 * 用户按减号隐藏（`hiddenKeys`）一票否决，进「已隐藏面板」；否则听显式记录——内置面板
 * 声明 `initiallyVisible: false` 时（如内置浏览器）默认不上栏，等用户从「+」菜单添加；
 * 没表过态的内置 tab 仍按老规矩直接上栏。
 */
export function resolveBuiltinTabPlacement(
	def: ActivityTabDefinition,
	tabVisibilityRecords: readonly string[],
	hiddenKeys: readonly string[],
): BuiltinTabPlacement {
	if (hiddenKeys.includes(def.id)) return "hidden";
	const explicit = explicitTabVisibility(tabVisibilityRecords, tabAttachKey(def));
	if (explicit === false) return "available";
	if (explicit === true) return "bar";
	return def.initiallyVisible === false ? "available" : "bar";
}

export interface ResolveActivityTabsInput {
	definitions: readonly ActivityTabDefinition[];
	metaById: ReadonlyMap<ActivityTabId, ActivityTabMeta | null>;
	tabVisibilityRecords: readonly string[];
	hiddenKeys: readonly string[];
	tabOrder: readonly string[];
}

export interface ResolveActivityTabsResult {
	/** meta 非空的全部候选（尚未按用户可见性过滤）。 */
	candidates: ResolvedActivityTab[];
	/** 上栏可见（过滤 hidden / 未添加的可添加池条目），已排序。 */
	onBar: ResolvedActivityTab[];
	/** 内置候选但被用户隐藏 → 「+」可恢复。 */
	restorable: ResolvedActivityTab[];
	/** 候选但不在栏上（插件未 attach / 内置未添加）→ 「+」可添加。 */
	available: ResolvedActivityTab[];
}

/**
 * 纯函数管道：meta → 候选 → 可见性 → 排序。
 * scope / hardIsolation / allowlist 应在构造 definitions 时已过滤。
 */
export function resolveActivityTabs(input: ResolveActivityTabsInput): ResolveActivityTabsResult {
	const { definitions, metaById, tabVisibilityRecords, hiddenKeys, tabOrder } = input;

	const candidates: ResolvedActivityTab[] = [];
	for (const def of definitions) {
		const meta = metaById.get(def.id);
		if (meta == null) continue;
		candidates.push(toResolved(def, meta));
	}

	// 自然序：order 升序，同 order 保持 definitions 顺序
	const natural = candidates
		.map((item, index) => ({ item, index, order: item.definition.order ?? 100 }))
		.sort((a, b) => a.order - b.order || a.index - b.index)
		.map(({ item }) => item);

	const onBarRaw: ResolvedActivityTab[] = [];
	const restorable: ResolvedActivityTab[] = [];
	const available: ResolvedActivityTab[] = [];

	for (const item of natural) {
		const def = item.definition;
		if (def.source === "plugin") {
			if (isPluginTabOnBar(def, tabVisibilityRecords)) {
				onBarRaw.push(item);
			} else {
				available.push(item);
			}
			continue;
		}
		const placement = resolveBuiltinTabPlacement(def, tabVisibilityRecords, hiddenKeys);
		if (placement === "bar") {
			onBarRaw.push(item);
		} else if (placement === "hidden") {
			restorable.push(item);
		} else {
			available.push(item);
		}
	}

	return {
		candidates: natural,
		onBar: applyTabOrder(onBarRaw, [...tabOrder]),
		restorable,
		available,
	};
}

/** @internal 测试/调试：tab 可见性记录 key */
export { tabAttachKey };
