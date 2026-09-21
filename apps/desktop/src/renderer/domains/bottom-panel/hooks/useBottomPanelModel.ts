import {
	activeSessionCwdAtom,
	type BottomPanelSessionState,
	bottomPanelScopeKeyAtom,
	bottomPanelStateAtom,
	canSplitBottomPanel,
	currentScenarioAtom,
	dispatchBottomPanelAtom,
} from "@shared/store/atoms";
import { parseProjectLocation } from "@vetta/ssh-transport/project-uri";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import type { BottomPanelComponentDefinition } from "../registry/types";
import { useBottomPanelDefinitions } from "../registry/useBottomPanelDefinitions";
import { type BottomPanelSizing, useBottomPanelSizing } from "./useBottomPanelSizing";
import { type BottomPanelTabActions, useBottomPanelTabs } from "./useBottomPanelTabs";
import { useTerminalCapabilities } from "./useTerminalCapabilities";

export interface BottomPanelModel {
	readonly state: BottomPanelSessionState;
	readonly cwd: string | null;
	readonly definitions: readonly BottomPanelComponentDefinition[];
	readonly canSplit: boolean;
	readonly sizing: BottomPanelSizing;
	readonly tabs: BottomPanelTabActions;
	setCollapsed(collapsed: boolean): void;
	/** 点折叠态的 pill：展开面板并激活对应 tab。 */
	expandAndActivate(tabId: string): void;
}

/**
 * 底部面板的连接层：把会话主键、场景、能力探测和三组动作装配成一个 view model。
 * 返回 null 表示当前没有可挂靠的会话（启动瞬间），此时整块不渲染。
 */
export function useBottomPanelModel(): BottomPanelModel | null {
	const scopeKey = useAtomValue(bottomPanelScopeKeyAtom);
	const cwd = useAtomValue(activeSessionCwdAtom);
	const scenario = useAtomValue(currentScenarioAtom) ?? undefined;
	const state = useAtomValue(bottomPanelStateAtom);
	const dispatch = useSetAtom(dispatchBottomPanelAtom);
	const capabilities = useTerminalCapabilities();

	const remoteSession = useMemo(() => (cwd ? parseProjectLocation(cwd).kind === "ssh" : false), [cwd]);
	const definitions = useBottomPanelDefinitions({
		scenario,
		localPtyAvailable: capabilities.localPty,
		remoteSession,
	});
	const sizing = useBottomPanelSizing();
	const tabs = useBottomPanelTabs(definitions);

	const setCollapsed = useCallback((collapsed: boolean) => dispatch({ type: "set-collapsed", collapsed }), [dispatch]);

	const expandAndActivate = useCallback(
		(tabId: string) => {
			dispatch({ type: "set-collapsed", collapsed: false });
			dispatch({ type: "activate-tab", tabId });
		},
		[dispatch],
	);

	return useMemo(() => {
		if (!scopeKey) return null;
		return {
			state,
			cwd,
			definitions,
			canSplit: canSplitBottomPanel(state),
			sizing,
			tabs,
			setCollapsed,
			expandAndActivate,
		};
	}, [scopeKey, state, cwd, definitions, sizing, tabs, setCollapsed, expandAndActivate]);
}
