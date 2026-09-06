import type { DbCatalogScope, DbConnection } from "../../../../preload/api-types/database";

/**
 * 连接树行的置顶（pin）与手动排序（#1，对齐 dbx-main ConnectionTree 的
 * 拖拽重排 + 收藏置顶子集）的纯函数与本地持久化。
 *
 * 设计约定：
 * - 顺序状态按「容器」分桶存储。容器 = 一组可排序行的父级：
 *   连接行容器 = 连接所属分组（groupPath 首段原文，无分组 = ""）；
 *   表行容器 = 表所属作用域（与展开态缓存键同构：connection 或
 *   connection::schema:name）。行名在该容器内唯一。
 * - 组名取原文而非 i18n 文案（「默认分组」翻译会跨语言变化），
 *   避免切换语言后顺序错乱；分组/作用域删除后残留键静默无害。
 * - 状态只增不清理，与展开态缓存（useDatabaseExplorerModel）策略一致。
 * - 顺序语义：displayOrder 先按 pin 次序输出置顶行，再按手动顺序（若用户
 *   曾拖拽过）输出其余行，最后补 names 中未覆盖的新增行（保持 names 序）。
 */

/** 连接行容器：groupPath 首段（原文，无分组 = ""）。 */
export function connectionRowContainer(connection: DbConnection): string {
	const path = connection.groupPath?.trim();
	if (!path) return "";
	const first = path.split(/[/\\]/)[0]?.trim();
	return first ?? "";
}

/** 分层连接（PG schema / MySQL database）的 scope 行容器（与表行容器区分，避免键冲突）。 */
export function scopeRowContainer(connectionName: string): string {
	return `${connectionName}::scopes`;
}

/** flat 连接（无 catalog 中间层）的表行容器。 */
export function flatTableRowContainer(connectionName: string): string {
	return `${connectionName}::tables`;
}

/** 分层连接 scope 内表行容器（与展开态缓存键同构：connection::kind:name）。 */
export function tableRowContainer(connectionName: string, scope?: DbCatalogScope | null): string {
	return scope ? `${connectionName}::${scope.kind}:${scope.name}` : connectionName;
}

/** 单容器行顺序状态：pinned 保持 pin 次序；manual 非 null 表示用户拖拽过。 */
export interface RowOrder {
	readonly pinned: readonly string[];
	readonly manual: readonly string[] | null;
}

export const EMPTY_ROW_ORDER: RowOrder = { pinned: [], manual: null };

/** 容器 → 顺序状态（容器键见 connectionRowContainer / tableRowContainer）。 */
export type ExplorerOrderMap = Readonly<Record<string, RowOrder>>;

function sameList(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** 把 from 处的行移动到 to 处（to 为 null 时移到底部），返回新数组。 */
function moveKey(keys: readonly string[], from: string, to: string | null): string[] {
	const fromIdx = keys.indexOf(from);
	if (fromIdx === -1) return [...keys];
	if (to != null && !keys.includes(to)) return [...keys];
	if (to === from) return [...keys];
	const next = [...keys];
	next.splice(fromIdx, 1);
	const toIdx = to == null ? next.length : next.indexOf(to);
	next.splice(toIdx, 0, from);
	return next;
}

/** 应用顺序状态：置顶行在前（pin 次序），其后按手动顺序/原始顺序，尾部补新行。 */
export function displayOrder(names: readonly string[], order: RowOrder): readonly string[] {
	const nameSet = new Set(names);
	const pinned = order.pinned.filter((n) => nameSet.has(n));
	const pinnedSet = new Set(pinned);
	if (order.manual != null) {
		const manualSet = new Set(order.manual);
		const manualKeep = order.manual.filter((n) => nameSet.has(n) && !pinnedSet.has(n));
		const rest = names.filter((n) => !pinnedSet.has(n) && !manualSet.has(n));
		return [...pinned, ...manualKeep, ...rest];
	}
	return [...pinned, ...names.filter((n) => !pinnedSet.has(n))];
}

/** 切换行的置顶状态（行不在 names 中时原样返回）。 */
export function toggleRowPin(order: RowOrder, names: readonly string[], name: string): RowOrder {
	if (!names.includes(name)) return order;
	const pinned = order.pinned.includes(name) ? order.pinned.filter((n) => n !== name) : [...order.pinned, name];
	return { pinned, manual: order.manual };
}

/**
 * 段内移动原语：把 from 行移到同段 to 行之前（to = null → 所在段末尾）。
 *
 * 段 = pin 段（已置顶行）或普通段；from 与 to 分属不同段时返回原对象
 * （跨段移动由 UI 组合 toggleRowPin + 本函数完成，见 DatabaseExplorerTree）。
 * pin 段内移动 = 调整置顶次序；普通段内移动 = 记录 manual 顺序，
 * 顺序恢复到基线（names 去置顶后的原序）时 manual 回落 null。
 */
export function moveRowInSegment(order: RowOrder, names: readonly string[], from: string, to: string | null): RowOrder {
	if (!names.includes(from)) return order;
	if (to != null && !names.includes(to)) return order;
	if (to === from) return order;
	const pinned = order.pinned;
	const fromPinned = pinned.includes(from);
	const toPinned = to != null && pinned.includes(to);
	// 跨段：不静默改置顶归属，原样返回。
	if (fromPinned !== toPinned) return order;
	if (fromPinned) {
		const nextPinned = moveKey(pinned, from, to);
		return sameList(nextPinned, pinned) ? order : { pinned: nextPinned, manual: order.manual };
	}
	// 普通段：以基线序为基础做相对移动，再与基线对比回落 manual。
	const pinnedSet = new Set(pinned);
	const baseline = names.filter((n) => !pinnedSet.has(n));
	const working = order.manual ?? baseline;
	const movedWorking = moveKey(working, from, to);
	const movedSet = new Set(movedWorking);
	const manual = [
		...movedWorking.filter((n) => names.includes(n) && !pinnedSet.has(n)),
		...baseline.filter((n) => !movedSet.has(n)),
	];
	return {
		pinned,
		manual: sameList(manual, baseline) ? null : manual,
	};
}

function insertBefore(list: readonly string[], key: string, before: string | null): string[] {
	if (before == null) return [...list, key];
	const idx = list.indexOf(before);
	if (idx === -1) return [...list, key];
	const next = [...list];
	next.splice(idx, 0, key);
	return next;
}

/** 跨段移动：pin 行 ⇄ 普通行（from 拖到异段目标 to 上）。 */
export function moveRowAcross(order: RowOrder, names: readonly string[], from: string, to: string | null): RowOrder {
	if (!names.includes(from)) return order;
	if (to != null && !names.includes(to)) return order;
	if (to === from) return order;
	const pinned = order.pinned;
	const fromPinned = pinned.includes(from);
	const toPinned = to != null && pinned.includes(to);
	if (fromPinned === toPinned) return moveRowInSegment(order, names, from, to);
	if (fromPinned) {
		// 拖 pin 行到普通段目标 to：取消置顶并插到 to 前（回到普通序）。
		const nextPinned = pinned.filter((n) => n !== from);
		const pinnedSet = new Set(nextPinned);
		const baseline = names.filter((n) => !pinnedSet.has(n));
		let manual = order.manual == null ? baseline : order.manual.filter((n) => n !== from && names.includes(n));
		if (!manual.includes(from)) manual = insertBefore(manual, from, to);
		else manual = moveKey(manual, from, to);
		return { pinned: nextPinned, manual: sameList(manual, baseline) ? null : manual };
	}
	// 拖普通行到 pin 段目标 to：置顶并插到 to 前（进入 pin 区）。此处 toPinned 为真 ⇒ to 非 null，收窄类型。
	const toName = to ?? from;
	const fromIdx = pinned.indexOf(toName);
	const nextPinned = [...pinned.filter((n) => n !== from)];
	nextPinned.splice(fromIdx, 0, from);
	const pinnedSet = new Set(nextPinned);
	const baseline = names.filter((n) => !pinnedSet.has(n));
	const manual =
		order.manual == null ? null : order.manual.filter((n) => n !== from && names.includes(n) && !pinnedSet.has(n));
	return {
		pinned: nextPinned,
		manual: manual != null && sameList(manual, baseline) ? null : manual,
	};
}

/** 按名称展示顺序重排对象数组；未配置顺序 / 顺序未变化时返回原数组引用。 */
export function applyOrderToItems<T extends { readonly name: string }>(
	items: readonly T[],
	order: RowOrder | undefined,
): readonly T[] {
	if (!order || (order.pinned.length === 0 && order.manual == null)) return items;
	const byName = new Map(items.map((item) => [item.name, item] as const));
	const ordered = displayOrder(
		items.map((item) => item.name),
		order,
	);
	if (ordered.length !== items.length) return items;
	const next = ordered.map((name) => byName.get(name) as T);
	return next.every((item, idx) => item === items[idx]) ? items : next;
}

const ORDER_STORAGE_KEY = "astravia.db.explorer.v1.order";

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

interface StoredRowOrder {
	pinned?: unknown;
	manual?: unknown;
}

/** 读取全部容器顺序（解析失败 / 结构不符 → 对应容器按空处理）。 */
export function loadExplorerOrder(): ExplorerOrderMap {
	try {
		const raw = localStorage.getItem(ORDER_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed == null) return {};
		const map: Record<string, RowOrder> = {};
		for (const [container, stored] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof stored !== "object" || stored == null) continue;
			const { pinned, manual } = stored as StoredRowOrder;
			if (isStringArray(pinned) || isStringArray(manual)) {
				map[container] = {
					pinned: isStringArray(pinned) ? pinned : [],
					manual: isStringArray(manual) ? manual : null,
				};
			}
		}
		return map;
	} catch {
		return {};
	}
}

/** 持久化全部容器顺序（容器内两者皆空时删除该键；写入失败静默忽略）。 */
export function saveExplorerOrder(map: ExplorerOrderMap): void {
	try {
		const record: Record<string, { pinned?: string[]; manual?: string[] }> = {};
		for (const [container, order] of Object.entries(map)) {
			if (order.pinned.length === 0 && order.manual == null) continue;
			const entry: { pinned?: string[]; manual?: string[] } = {};
			if (order.pinned.length > 0) entry.pinned = [...order.pinned];
			if (order.manual != null) entry.manual = [...order.manual];
			record[container] = entry;
		}
		localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(record));
	} catch {
		// localStorage 不可用（隐私模式 / 配额）时静默降级，不影响树渲染。
	}
}
