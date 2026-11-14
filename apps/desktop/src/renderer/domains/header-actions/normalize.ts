import type { ComponentType, ReactNode } from "react";

/** 宿主对插件顶栏动作声明的上限，文档（`ui-slots.md`）里公开同一组数字。 */
export const HEADER_ACTION_LIMITS = {
	title: 40,
	menuItems: 20,
	menuLabel: 40,
} as const;

export interface NormalizedMenuItem {
	id: string;
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	destructive?: boolean;
	separatorBefore?: boolean;
}

export type NormalizedBehavior =
	| { type: "click"; onClick: () => void }
	| { type: "menu"; items: NormalizedMenuItem[] }
	| { type: "popover"; component: ComponentType<{ close: () => void }> };

export interface NormalizedHeaderAction {
	title: string;
	icon: ReactNode;
	badge?: number | true;
	active: boolean;
	disabled: boolean;
	behavior: NormalizedBehavior;
}

function clip(text: string, max: number): string {
	const chars = Array.from(text.trim());
	return chars.length > max ? chars.slice(0, max).join("") : chars.join("");
}

function normalizeMenuItems(raw: unknown): NormalizedMenuItem[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const items: NormalizedMenuItem[] = [];
	for (const entry of raw.slice(0, HEADER_ACTION_LIMITS.menuItems)) {
		if (entry === null || typeof entry !== "object") continue;
		const item = entry as Partial<NormalizedMenuItem>;
		if (typeof item.id !== "string" || item.id === "" || seen.has(item.id)) continue;
		if (typeof item.label !== "string" || item.label.trim() === "" || typeof item.onSelect !== "function") continue;
		seen.add(item.id);
		items.push({
			id: item.id,
			label: clip(item.label, HEADER_ACTION_LIMITS.menuLabel),
			icon: item.icon,
			onSelect: item.onSelect,
			disabled: item.disabled === true,
			destructive: item.destructive === true,
			separatorBefore: item.separatorBefore === true,
		});
	}
	return items;
}

/**
 * 把插件 `useAction()` 的返回值收成宿主能放心渲染的形态。
 *
 * 任何一项不合法都返回 `null`（该动作不显示）并带上原因，宿主据此打一条 warn；
 * 不抛错——声明写错只会让这一个动作消失。
 */
export function normalizeHeaderAction(raw: unknown): { value: NormalizedHeaderAction | null; problem?: string } {
	if (raw === null || raw === undefined) return { value: null };
	if (typeof raw !== "object") return { value: null, problem: "useAction() must return an object or null" };
	const state = raw as Record<string, unknown>;
	if (typeof state.title !== "string" || state.title.trim() === "") {
		return { value: null, problem: "`title` is required" };
	}
	if (state.icon === null || state.icon === undefined || state.icon === false) {
		return { value: null, problem: "`icon` is required" };
	}

	let behavior: NormalizedBehavior | null = null;
	const menu = normalizeMenuItems(state.menuItems);
	if (menu.length > 0) behavior = { type: "menu", items: menu };
	else if (typeof state.popover === "function" || (state.popover !== null && typeof state.popover === "object")) {
		behavior = { type: "popover", component: state.popover as ComponentType<{ close: () => void }> };
	} else if (typeof state.onClick === "function") behavior = { type: "click", onClick: state.onClick as () => void };
	if (!behavior) return { value: null, problem: "one of `onClick` / `menuItems` / `popover` is required" };

	let badge: number | true | undefined;
	if (state.badge === true) badge = true;
	else if (typeof state.badge === "number" && Number.isFinite(state.badge) && state.badge >= 1) {
		badge = Math.floor(state.badge);
	}

	return {
		value: {
			title: clip(state.title, HEADER_ACTION_LIMITS.title),
			icon: state.icon as ReactNode,
			badge,
			active: state.active === true,
			disabled: state.disabled === true,
			behavior,
		},
	};
}

/** 图标节点的签名：同类型、同属性视为同一个图标；序列化失败时每次都当成「变了」，宁可多发布也不漏。 */
function iconSignature(icon: ReactNode, fallback: () => string): string {
	if (icon === null || icon === undefined || icon === false) return "";
	if (typeof icon === "string" || typeof icon === "number") return `t:${icon}`;
	if (icon !== null && typeof icon === "object" && "type" in icon && "props" in icon) {
		const element = icon as { type: unknown; props: unknown };
		const type =
			typeof element.type === "string"
				? element.type
				: typeof element.type === "function"
					? element.type.name || "fn"
					: "?";
		try {
			return `e:${type}:${JSON.stringify(element.props)}`;
		} catch {
			return fallback();
		}
	}
	return fallback();
}

let fallbackCounter = 0;

/**
 * 一次声明里「会改变屏幕上画面」的那部分内容的签名：标题、图标、角标、选中 / 禁用、点击行为的种类与菜单项文案。
 * 回调（`onClick` / `onSelect`）不在其中——它们由调用方通过 ref 始终指向最新的，不需要为此重新发布。
 * 探针据此判断「声明没变」就不再通知按钮组，避免插件每次重渲染（流式期间很频繁）都带动整个按钮组重渲。
 */
export function headerActionSignature(
	action: NormalizedHeaderAction,
	popoverId: (component: object) => number,
): string {
	const { behavior } = action;
	const behaviorPart =
		behavior.type === "menu"
			? `menu:${behavior.items.map((item) => `${item.id}|${item.label}|${item.disabled ? 1 : 0}${item.destructive ? 1 : 0}${item.separatorBefore ? 1 : 0}|${iconSignature(item.icon, () => `m${fallbackCounter++}`)}`).join(";")}`
			: behavior.type === "popover"
				? `popover:${popoverId(behavior.component)}`
				: "click";
	return [
		action.title,
		iconSignature(action.icon, () => `i${fallbackCounter++}`),
		action.badge ?? "",
		action.active ? 1 : 0,
		action.disabled ? 1 : 0,
		behaviorPart,
	].join("\u0001");
}
