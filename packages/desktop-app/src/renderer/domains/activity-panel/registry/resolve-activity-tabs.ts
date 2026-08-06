import { explicitTabVisibility } from "@domains/plugins/runtime/attached-tabs";
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

/** canonical: plugin:<pluginId>:<tabId> → <pluginId>:<tabId> */
function pluginAttachKey(def: ActivityTabDefinition): string {
	if (def.id.startsWith("plugin:")) return def.id.slice("plugin:".length);
	if (def.pluginId) return `${def.pluginId}:${def.id}`;
	return def.id;
}

/** 插件上栏：显式 attach 记录优先，否则 initiallyVisible（缺省 true）。 */
export function isPluginTabOnBar(def: ActivityTabDefinition, tabVisibilityRecords: readonly string[]): boolean {
	const key = pluginAttachKey(def);
	return explicitTabVisibility(tabVisibilityRecords, key) ?? def.initiallyVisible !== false;
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
	/** 上栏可见（过滤 hidden / 插件未 attach），已排序。 */
	onBar: ResolvedActivityTab[];
	/** 内置候选但被用户隐藏 → 「+」可恢复。 */
	restorable: ResolvedActivityTab[];
	/** 插件候选但未上栏 → 「+」可添加。 */
	availablePlugins: ResolvedActivityTab[];
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
	const availablePlugins: ResolvedActivityTab[] = [];

	for (const item of natural) {
		const def = item.definition;
		if (def.source === "plugin") {
			if (isPluginTabOnBar(def, tabVisibilityRecords)) {
				onBarRaw.push(item);
			} else {
				availablePlugins.push(item);
			}
			continue;
		}
		if (hiddenKeys.includes(def.id)) {
			restorable.push(item);
		} else {
			onBarRaw.push(item);
		}
	}

	return {
		candidates: natural,
		onBar: applyTabOrder(onBarRaw, [...tabOrder]),
		restorable,
		availablePlugins,
	};
}

/** @internal 测试/调试：插件 attach key */
export { pluginAttachKey };
