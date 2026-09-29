import { dispatchBottomPanelAtomFamily } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { Component, type ErrorInfo, type JSX, type ReactNode, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { parseTerminalLaunch, toTerminalLaunchPayload } from "../terminal/terminal-launch";
import { setBottomPanelCloseGuardAtom, setBottomPanelMetaAtom } from "./instance-atoms";
import { BottomPanelInstanceProvider } from "./instance-context";
import { launchTerminalAtomFamily, revealTabAtomFamily } from "./tab-commands";
import type { BottomPanelComponentDefinition, BottomPanelHandle, BottomPanelTabMeta } from "./types";

interface BoundaryProps {
	readonly children: ReactNode;
	readonly message: string;
}

interface BoundaryState {
	readonly failed: boolean;
}

/** 单格隔离：一个面板组件抛错只让这一格显示兜底，不拖垮整个底部面板。 */
class BottomPanelErrorBoundary extends Component<BoundaryProps, BoundaryState> {
	state: BoundaryState = { failed: false };

	static getDerivedStateFromError(): BoundaryState {
		return { failed: true };
	}

	componentDidCatch(error: unknown, info: ErrorInfo): void {
		console.error("[bottom-panel] tab render failed", error, info.componentStack);
	}

	render(): ReactNode {
		if (this.state.failed) {
			return (
				<div className="flex min-h-0 flex-1 items-center justify-center px-4 text-[12px] text-muted-foreground">
					{this.props.message}
				</div>
			);
		}
		return this.props.children;
	}
}

export interface BottomPanelInstanceHostProps {
	readonly definition: BottomPanelComponentDefinition;
	readonly scopeKey: string;
	readonly tabId: string;
	readonly cwd: string | null;
	readonly active: boolean;
	readonly payload: unknown;
	/** 当前会话能不能开终端（本机缺 PTY 的本地会话不能）。 */
	readonly terminalAvailable: boolean;
}

function newId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

/** 每个实例一层 bridge：注入 handle、隔离渲染错误、卸载时清掉实例的运行时状态。 */
export function BottomPanelInstanceHost({
	definition,
	scopeKey,
	tabId,
	cwd,
	active,
	payload,
	terminalAvailable,
}: BottomPanelInstanceHostProps): JSX.Element {
	const { t } = useTranslation("chat");
	const setMeta = useSetAtom(setBottomPanelMetaAtom);
	const setCloseGuard = useSetAtom(setBottomPanelCloseGuardAtom);
	const dispatch = useSetAtom(dispatchBottomPanelAtomFamily(scopeKey));
	const launchTerminal = useSetAtom(launchTerminalAtomFamily(scopeKey));
	const revealTab = useSetAtom(revealTabAtomFamily(scopeKey));

	const handle = useMemo<BottomPanelHandle>(
		() => ({
			tabId,
			cwd,
			active,
			payload,
			setMeta: (meta: Partial<BottomPanelTabMeta> | null) => setMeta(tabId, meta),
			setCloseGuard: (guard) => setCloseGuard(tabId, guard),
			setPayload: (next) => dispatch({ type: "set-payload", tabId, payload: next }),
			openTerminal: (launch) => {
				if (!terminalAvailable) throw new Error("openTerminal: terminals are not available in this session");
				const parsed = parseTerminalLaunch(launch, cwd);
				const terminalTabId = newId("tab");
				launchTerminal({
					tabId: terminalTabId,
					newLeafId: newId("leaf"),
					nearTabId: tabId,
					payload: toTerminalLaunchPayload(parsed),
				});
				return terminalTabId;
			},
			revealTab: (target) => revealTab(target),
		}),
		[tabId, cwd, active, payload, terminalAvailable, setMeta, setCloseGuard, dispatch, launchTerminal, revealTab],
	);

	// 实例卸载时清掉运行时状态；默认 meta 不在这里上报——tab 条按
	// 「实例 meta ?? 定义默认 meta」解析，报一次默认值只会在重渲时把实例改的名字冲掉。
	useEffect(() => {
		return () => {
			setMeta(tabId, null);
			setCloseGuard(tabId, null);
		};
	}, [tabId, setMeta, setCloseGuard]);

	const Content = definition.component;
	return (
		<BottomPanelInstanceProvider value={handle}>
			<BottomPanelErrorBoundary message={t("bottomPanel.tabFailed")}>
				<Content />
			</BottomPanelErrorBoundary>
		</BottomPanelInstanceProvider>
	);
}
