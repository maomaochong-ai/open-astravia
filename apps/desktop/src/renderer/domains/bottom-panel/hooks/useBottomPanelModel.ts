import {
	type BottomPanelSessionState,
	bottomPanelStateAtomFamily,
	canSplitBottomPanel,
	dispatchBottomPanelAtomFamily,
} from "@shared/store/atoms";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
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
 * 底部面板的连接层：把显式工作表面、能力探测和三组动作装配成一个 view model。
 */
export function useBottomPanelModel(scope: WorkSurfaceScope, enabled = true): BottomPanelModel {
	const state = useAtomValue(bottomPanelStateAtomFamily(scope.key));
	const dispatch = useSetAtom(dispatchBottomPanelAtomFamily(scope.key));
	const capabilities = useTerminalCapabilities(enabled);

	const remoteSession = useMemo(
		() => (scope.cwd ? parseProjectLocation(scope.cwd).kind === "ssh" : false),
		[scope.cwd],
	);
	const definitions = useBottomPanelDefinitions({
		scenario: scope.scenario,
		localPtyAvailable: capabilities.localPty,
		remoteSession,
	});
	const sizing = useBottomPanelSizing(scope.key);
	const tabs = useBottomPanelTabs(scope.key, definitions);

	const setCollapsed = useCallback((collapsed: boolean) => dispatch({ type: "set-collapsed", collapsed }), [dispatch]);

	const expandAndActivate = useCallback(
		(tabId: string) => {
			dispatch({ type: "set-collapsed", collapsed: false });
			dispatch({ type: "activate-tab", tabId });
		},
		[dispatch],
	);

	return useMemo(
		() => ({
			state,
			cwd: scope.cwd,
			definitions,
			canSplit: canSplitBottomPanel(state),
			sizing,
			tabs,
			setCollapsed,
			expandAndActivate,
		}),
		[state, scope.cwd, definitions, sizing, tabs, setCollapsed, expandAndActivate],
	);
}
