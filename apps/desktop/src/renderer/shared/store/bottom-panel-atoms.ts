/**
 * 底部面板的会话级状态。
 *
 * 布局树本身是纯函数（`bottom-panel-layout.ts`），落盘也是纯函数
 * （`bottom-panel-persistence.ts`）；这里只负责「当前是哪个会话」以及什么时候写盘。
 *
 * 拖拽高度和拖拽分屏比例走 transient 版本：实时改内存让布局跟手，松手才写一次
 * localStorage——与活动面板宽度（`activity-atoms.ts`）完全同形。
 */

import { atom } from "jotai";
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
import { activeInputDraftKeyAtom } from "./session-input-draft";

const bottomPanelStatesAtom = atom<Map<string, BottomPanelSessionState>>(readPersistedBottomPanelStates());

/**
 * 面板按会话分桶，主键与输入草稿同源：已有会话是 sessionPath，新会话页是
 * `new:${cwd}`。刻意不另起一套规则，否则「这是哪个会话」会有两个答案。
 */
export const bottomPanelScopeKeyAtom = atom((get) => get(activeInputDraftKeyAtom));

export const bottomPanelStateAtom = atom((get) => {
	const key = get(bottomPanelScopeKeyAtom);
	if (!key) return emptyBottomPanelState();
	return get(bottomPanelStatesAtom).get(key) ?? emptyBottomPanelState();
});

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
export const dispatchBottomPanelAtom = atom(null, (get, set, action: BottomPanelAction) => {
	const key = get(bottomPanelScopeKeyAtom);
	if (!key) return;
	const result = dispatch(get(bottomPanelStatesAtom), key, action);
	if (!result.changed) return;
	set(bottomPanelStatesAtom, result.states);
	persistBottomPanelStates(result.states);
});

/** 拖拽过程中改布局，不写盘。 */
export const dispatchTransientBottomPanelAtom = atom(null, (get, set, action: BottomPanelAction) => {
	const key = get(bottomPanelScopeKeyAtom);
	if (!key) return;
	const result = dispatch(get(bottomPanelStatesAtom), key, action);
	if (!result.changed) return;
	set(bottomPanelStatesAtom, result.states);
});

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
