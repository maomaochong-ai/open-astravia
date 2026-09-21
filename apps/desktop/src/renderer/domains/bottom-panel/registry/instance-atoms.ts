/**
 * 实例级的运行时状态：名字、图标、状态点、关闭前钩子。
 *
 * 这些都不落盘——它们由实例在挂载后自己上报（终端要等 PTY 起来才知道叫什么），
 * 重开会话时由新实例重新上报一次。真正需要跨会话保留的东西走布局树的 payload。
 */

import { atom } from "jotai";
import type { BottomPanelTabMeta, BottomPanelWillClose } from "./types";

export const bottomPanelMetaMapAtom = atom<Readonly<Record<string, BottomPanelTabMeta>>>({});

export const setBottomPanelMetaAtom = atom(
	null,
	(get, set, tabId: string, patch: Partial<BottomPanelTabMeta> | null) => {
		const prev = get(bottomPanelMetaMapAtom);
		if (patch === null) {
			if (!(tabId in prev)) return;
			const next = { ...prev };
			delete next[tabId];
			set(bottomPanelMetaMapAtom, next);
			return;
		}
		const current = prev[tabId];
		const merged: BottomPanelTabMeta = {
			...current,
			...patch,
			// patch 只改状态时不带 label，这里兜住，避免把已上报的名字抹成空。
			label: patch.label ?? current?.label ?? "",
		};
		if (
			current &&
			current.label === merged.label &&
			current.icon === merged.icon &&
			current.status === merged.status
		) {
			return;
		}
		set(bottomPanelMetaMapAtom, { ...prev, [tabId]: merged });
	},
);

/**
 * 关闭前钩子只在写 atom 里被读取，不参与渲染，所以整体替换 Map 的成本可以忽略；
 * 用 atom 而不是模块级变量，是为了每个 jotai store（测试里的独立 store）互不串味。
 */
export const bottomPanelCloseGuardsAtom = atom<ReadonlyMap<string, BottomPanelWillClose>>(new Map());

export const setBottomPanelCloseGuardAtom = atom(
	null,
	(get, set, tabId: string, guard: BottomPanelWillClose | null) => {
		const prev = get(bottomPanelCloseGuardsAtom);
		if (guard === null) {
			if (!prev.has(tabId)) return;
			const next = new Map(prev);
			next.delete(tabId);
			set(bottomPanelCloseGuardsAtom, next);
			return;
		}
		if (prev.get(tabId) === guard) return;
		const next = new Map(prev);
		next.set(tabId, guard);
		set(bottomPanelCloseGuardsAtom, next);
	},
);
