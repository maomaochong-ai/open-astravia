import type { ModelSelectorOptionView, ModelSelectorProviderGroup } from "./ModelSelectorView";

/**
 * 模型选择菜单的三栏数据与虚拟滚动。
 *
 * 为什么需要：模型数量上百时，单列「按服务商分组的长列表」只能靠搜索找，而搜索要求
 * 用户先记得模型名。三栏把「服务商 → 模型 → 思考强度」摊成并排的三步，找模型变成
 * 逐栏收敛；收藏栏放在服务商栏最前，常用的不必每次现找。
 *
 * 这里只有纯计算：栏目的构成、搜索命中、可见区间。渲染与状态由视图负责。
 */
export const MODEL_FAVORITES_STORAGE_KEY = "astravia-model-favorites";

/** 收藏栏的伪服务商标识：它排在服务商栏第一位，但不是真的 provider。 */
export const FAVORITES_COLUMN_ID = "__favorites";

export interface ModelProviderColumn {
	readonly id: string;
	readonly label: string;
	readonly icon?: string;
	/** 该栏里的模型数量，用于栏名后的角标。 */
	readonly count: number;
	readonly isFavorites: boolean;
}

export interface ModelColumnEntry {
	readonly model: ModelSelectorOptionView;
	/** 搜索状态下跨服务商显示时，行尾标注它来自哪个服务商。 */
	readonly providerLabel: string;
}

export interface ModelColumns {
	readonly providers: readonly ModelProviderColumn[];
	/** 当前服务商（或搜索时的全量）可见模型，顺序即渲染顺序。 */
	readonly models: readonly ModelColumnEntry[];
	/** 当前选中的服务商栏；搜索时为 null（不分栏）。 */
	readonly activeProviderId: string | null;
	readonly searching: boolean;
}

export function normalizeModelSearch(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function matchesQuery(model: ModelSelectorOptionView, providerLabel: string, query: string): boolean {
	if (!query) return true;
	return [model.displayName, model.modelId, model.provider, providerLabel, ...(model.tags ?? [])].some((value) =>
		normalizeModelSearch(value).includes(query),
	);
}

/**
 * 组装三栏的第一、二栏。
 *
 * 搜索时不分服务商：命中结果平铺在中间栏，行尾带服务商名——用户此刻要的是「哪个模型
 * 叫这个名字」，而不是「这个服务商有没有」。搜索为空时按 `activeProviderId` 收敛。
 */
export function buildModelColumns(
	groups: readonly ModelSelectorProviderGroup[],
	options: {
		readonly favorites: readonly string[];
		readonly query: string;
		readonly activeProviderId?: string | null;
	},
): ModelColumns {
	const query = normalizeModelSearch(options.query);
	const searching = query.length > 0;
	const modelByKey = new Map<string, { model: ModelSelectorOptionView; providerLabel: string }>();
	for (const group of groups) {
		for (const model of group.models) modelByKey.set(model.key, { model, providerLabel: group.label });
	}

	// 收藏栏：只保留仍存在的模型（服务商被移除、模型下线时自动消失）。
	const favoriteModels = options.favorites
		.map((key) => modelByKey.get(key))
		.filter((entry): entry is { model: ModelSelectorOptionView; providerLabel: string } => entry !== undefined);

	const providerColumns: ModelProviderColumn[] = [];
	if (favoriteModels.length > 0) {
		providerColumns.push({
			id: FAVORITES_COLUMN_ID,
			label: "",
			count: favoriteModels.length,
			isFavorites: true,
		});
	}
	for (const group of groups) {
		providerColumns.push({
			id: group.provider,
			label: group.label,
			...(group.icon ? { icon: group.icon } : {}),
			count: group.models.length,
			isFavorites: false,
		});
	}

	if (searching) {
		const models: ModelColumnEntry[] = [];
		for (const group of groups) {
			for (const model of group.models) {
				if (matchesQuery(model, group.label, query)) models.push({ model, providerLabel: group.label });
			}
		}
		return { providers: providerColumns, models, activeProviderId: null, searching };
	}

	const activeProviderId =
		options.activeProviderId ?? (favoriteModels.length > 0 ? FAVORITES_COLUMN_ID : (groups[0]?.provider ?? null));

	if (activeProviderId === FAVORITES_COLUMN_ID) {
		return {
			providers: providerColumns,
			models: favoriteModels.map((entry) => ({ model: entry.model, providerLabel: entry.providerLabel })),
			activeProviderId,
			searching,
		};
	}

	const group = groups.find((entry) => entry.provider === activeProviderId) ?? groups[0];
	return {
		providers: providerColumns,
		models: (group?.models ?? []).map((model) => ({ model, providerLabel: group?.label ?? "" })),
		activeProviderId: group?.provider ?? null,
		searching,
	};
}

export interface VirtualRange {
	readonly start: number;
	readonly end: number;
	readonly paddingTop: number;
	readonly paddingBottom: number;
}

/**
 * 长列表的可见区间。行高固定，所以用「滚动位移 / 行高」直接算，不需要逐行测量。
 *
 * 阈值以下是全量渲染：几十行时窗口化的收益还不够抵它带来的焦点与滚动锚点问题。
 */
export function computeVirtualRange(input: {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly rowHeight: number;
	readonly count: number;
	readonly overscan?: number;
	readonly threshold?: number;
}): VirtualRange {
	const { scrollTop, viewportHeight, rowHeight, count } = input;
	const overscan = input.overscan ?? 4;
	const threshold = input.threshold ?? 60;
	if (rowHeight <= 0 || count <= threshold) {
		return { start: 0, end: count, paddingTop: 0, paddingBottom: 0 };
	}
	const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
	const visibleRows = Math.ceil(viewportHeight / rowHeight) + 1;
	const start = Math.max(0, firstVisible - overscan);
	const end = Math.min(count, firstVisible + visibleRows + overscan);
	return {
		start,
		end,
		paddingTop: start * rowHeight,
		paddingBottom: Math.max(0, (count - end) * rowHeight),
	};
}

/** 从存储值解析收藏列表；坏数据回落空数组。 */
export function parseModelFavorites(raw: unknown): string[] {
	if (typeof raw !== "string" || raw.length === 0) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		const result: string[] = [];
		for (const item of parsed) {
			if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
			seen.add(item);
			result.push(item);
		}
		return result;
	} catch {
		return [];
	}
}

export function serializeModelFavorites(favorites: readonly string[]): string {
	return JSON.stringify([...favorites]);
}

/** 切换收藏：已收藏则移除，未收藏则追加到末尾（保持用户加入的顺序）。 */
export function toggleModelFavorite(favorites: readonly string[], key: string): string[] {
	return favorites.includes(key) ? favorites.filter((entry) => entry !== key) : [...favorites, key];
}
