import { BrowserPanelView } from "@vetta/theme-ui/activity";
import { useBrowserPanelModel } from "../hooks/useBrowserPanelModel";

/**
 * 工作空间级内置浏览器：单 webview 的临时预览窗。
 * - 按 workspaceId 隔离：切工作空间时 webview 重挂载并加载该工作空间存的 URL。
 * - 跨活动 tab 保活由 ActivityPanel 负责（常驻挂载 + CSS 隐藏，不条件卸载）。
 */
export function BrowserPanel(): JSX.Element {
	const model = useBrowserPanelModel();
	return <BrowserPanelView {...model} />;
}
