import { BrowserPanelView } from "@vetta/theme-ui/activity";
import { useBrowserPanelModel } from "../hooks/useBrowserPanelModel";

/**
 * 会话级内置浏览器：单 webview 的临时预览窗。
 * - 按 sessionPath 隔离：切会话时 webview 重挂载并加载该会话存的 URL。
 * - 跨活动 tab 保活由 ActivityPanel 负责（常驻挂载 + CSS 隐藏，不条件卸载）。
 */
export function BrowserPanel(): JSX.Element {
	const model = useBrowserPanelModel();
	return <BrowserPanelView {...model} />;
}
