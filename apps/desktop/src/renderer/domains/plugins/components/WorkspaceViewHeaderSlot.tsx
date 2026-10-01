import { pluginWorkspaceViewHeadersAtom, workspaceViewHeaderKey } from "@shared/store/atoms";
import { useMatches } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { Component, type ErrorInfo, type JSX, type ReactNode } from "react";
import { PluginInlineI18nBoundary, usePluginTextResolver } from "../runtime/plugin-i18n";

/**
 * 插件塞进宿主页头的节点是跨插件边界来的：它抛错时只能吃掉这一簇，绝不能把
 * 整条页头（连同侧边栏触发器和窗口按钮）一起打没。
 */
class HeaderSlotErrorBoundary extends Component<{ slotKey: string; children: ReactNode }, { failed: boolean }> {
	state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error(`Plugin page-header slot failed: ${this.props.slotKey}`, error, errorInfo.componentStack);
	}

	render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

/**
 * 把插件节点放回它自己的 i18n 目录与 CSS @scope 里再交给宿主页头渲染——
 * 插件 CSS 被编译成 `@scope([data-astravia-plugin-root=<id>])`，脱离这层包装
 * 时插件的 Tailwind 类会全部失效。
 */
function HeaderSlot({ pluginId, slotKey, children }: { pluginId: string; slotKey: string; children: ReactNode }) {
	return (
		<HeaderSlotErrorBoundary slotKey={slotKey}>
			<PluginInlineI18nBoundary pluginId={pluginId}>{children}</PluginInlineI18nBoundary>
		</HeaderSlotErrorBoundary>
	);
}

export interface ActiveWorkspaceViewHeader {
	/** 已解析（`%key%` → 文案）的标题覆盖；插件没给就是 undefined。 */
	title?: string;
	hideTitle: boolean;
	/** 页头浮在视图之上（视图占满全高），而不是把视图往下推。 */
	immersive: boolean;
	left?: ReactNode;
	right?: ReactNode;
}

/**
 * 当前路由若是某个插件工作区视图、且该视图接管了宿主页头，返回可直接渲染的内容。
 *
 * 只在该视图自己的路由上生效：接管记录按 `${pluginId}:${viewId}` 存活，用户切到
 * 别的页面时页头立刻回到宿主自己的标题，不需要插件在路由变化时手动撤销。
 */
export function useActiveWorkspaceViewHeader(): ActiveWorkspaceViewHeader | undefined {
	const headers = useAtomValue(pluginWorkspaceViewHeadersAtom);
	const resolveText = usePluginTextResolver();
	const matches = useMatches();
	const params = matches[matches.length - 1]?.params as { pluginId?: string; viewId?: string } | undefined;
	const pluginId = params?.pluginId;
	const viewId = params?.viewId;
	if (typeof pluginId !== "string" || typeof viewId !== "string") return undefined;
	const entry = headers[workspaceViewHeaderKey(pluginId, viewId)];
	if (!entry) return undefined;
	const key = workspaceViewHeaderKey(pluginId, viewId);
	return {
		...(entry.title ? { title: resolveText(pluginId, entry.title) } : {}),
		hideTitle: entry.hideTitle === true,
		immersive: entry.immersive === true,
		...(entry.left != null
			? {
					left: (
						<HeaderSlot pluginId={pluginId} slotKey={`${key}:left`}>
							{entry.left}
						</HeaderSlot>
					),
				}
			: {}),
		...(entry.right != null
			? {
					right: (
						<HeaderSlot pluginId={pluginId} slotKey={`${key}:right`}>
							{entry.right}
						</HeaderSlot>
					),
				}
			: {}),
	};
}
