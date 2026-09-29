/**
 * 底部面板的工作表面级状态。
 *
 * 布局树本身是纯函数（`bottom-panel-layout.ts`），落盘也是纯函数
 * （`bottom-panel-persistence.ts`）；这里只负责按显式 scope key 取状态以及什么时候写盘。
 *
 * 拖拽高度和拖拽分屏比例走 transient 版本：实时改内存让布局跟手，松手才写一次
 * localStorage——与活动面板宽度（`activity-atoms.ts`）完全同形。
 */

import { type Atom, atom, type WritableAtom } from "jotai";
import {
	type BottomPanelAction,
	type BottomPanelSessionState,
	emptyBottomPanelState,
	reduceBottomPanel,
} from "./bottom-panel-layout";
import {
	persistBottomPanelStates,
	readPersistedBottomPanelStates,
	renameBottomPanelStateKey,
	touchBottomPanelState,
} from "./bottom-panel-persistence";

const bottomPanelStatesAtom = atom<Map<string, BottomPanelSessionState>>(readPersistedBottomPanelStates());

/**
 * 面板按工作表面分桶。key 由页面 Connector 显式提供：普通会话通常使用
 * sessionPath，Team 使用自己的稳定工作表面 key。这里不再读取输入草稿的当前 scope，
 * 避免无关领域通过一个全局“当前会话”互相耦合。
 */
const stateAtomsByScope = new Map<string, Atom<BottomPanelSessionState>>();

export function bottomPanelStateAtomFamily(scopeKey: string): Atom<BottomPanelSessionState> {
	const existing = stateAtomsByScope.get(scopeKey);
	if (existing) return existing;
	const created = atom((get) => get(bottomPanelStatesAtom).get(scopeKey) ?? emptyBottomPanelState());
	stateAtomsByScope.set(scopeKey, created);
	return created;
}

function dispatch(
	states: Map<string, BottomPanelSessionState>,
	key: string,
	action: BottomPanelAction,
): { states: Map<string, BottomPanelSessionState>; changed: boolean } {
	const prev = states.get(key) ?? emptyBottomPanelState();
	const next = reduceBottomPanel(prev, action);
	if (next === prev) return { states, changed: false };
	return { states: touchBottomPanelState(states, key, next), changed: true };
}

/** 改布局并立即落盘。 */
const dispatchAtomsByScope = new Map<string, WritableAtom<null, [BottomPanelAction], void>>();

export function dispatchBottomPanelAtomFamily(scopeKey: string): WritableAtom<null, [BottomPanelAction], void> {
	const existing = dispatchAtomsByScope.get(scopeKey);
	if (existing) return existing;
	const created = atom(null, (get, set, action: BottomPanelAction) => {
		const result = dispatch(get(bottomPanelStatesAtom), scopeKey, action);
		if (!result.changed) return;
		set(bottomPanelStatesAtom, result.states);
		persistBottomPanelStates(result.states);
	});
	dispatchAtomsByScope.set(scopeKey, created);
	return created;
}

/** 拖拽过程中改布局，不写盘。 */
const transientDispatchAtomsByScope = new Map<string, WritableAtom<null, [BottomPanelAction], void>>();

export function dispatchTransientBottomPanelAtomFamily(
	scopeKey: string,
): WritableAtom<null, [BottomPanelAction], void> {
	const existing = transientDispatchAtomsByScope.get(scopeKey);
	if (existing) return existing;
	const created = atom(null, (get, set, action: BottomPanelAction) => {
		const result = dispatch(get(bottomPanelStatesAtom), scopeKey, action);
		if (!result.changed) return;
		set(bottomPanelStatesAtom, result.states);
	});
	transientDispatchAtomsByScope.set(scopeKey, created);
	return created;
}

/** 拖拽结束时把当前内存状态落一次盘。 */
export const persistBottomPanelAtom = atom(null, (get) => {
	persistBottomPanelStates(get(bottomPanelStatesAtom));
});

/** 新会话首条消息落地真实 sessionPath 后，把面板改挂到新主键。 */
export const renameBottomPanelScopeAtom = atom(null, (get, set, from: string, to: string) => {
	const states = get(bottomPanelStatesAtom);
	if (!states.has(from) || from === to) return;
	const next = renameBottomPanelStateKey(states, from, to);
	set(bottomPanelStatesAtom, next);
	persistBottomPanelStates(next);
});
