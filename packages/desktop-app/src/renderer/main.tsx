import { AppBootLoadingView } from "@vetta/theme-ui/app-boot";
import { createRoot } from "react-dom/client";
import { applyInitialTheme } from "./shared/theme/apply";
import { applyStoredCursorStyle } from "./shared/theme/cursor";
import { captureReactError, initializeRendererErrorMonitoring } from "./telemetry/error-monitoring";
import "./styles.css";

initializeRendererErrorMonitoring("main");

// 在首个 React 节点挂载前同步恢复持久化主题与光标，保证窗口首次可见时已使用实际设计令牌。
applyInitialTheme();
applyStoredCursorStyle();

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Missing root element");
}

const root = createRoot(rootElement, {
	onCaughtError: captureReactError,
	onRecoverableError: captureReactError,
});
const appReadyPromise = window.vetta.appLifecycle.whenReady();

root.render(<AppBootLoadingView />);

// 两帧后再通知主进程显示窗口，确保主题变量与 theme-ui 启动骨架已经完成绘制。
const bootPaintedPromise = new Promise<void>((resolve) => {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			window.vetta.appLifecycle.reportRendererBootPainted();
			resolve();
		});
	});
});
const renderAppPromise = import("./renderApp");

void Promise.all([appReadyPromise, bootPaintedPromise, renderAppPromise])
	.then(([, , { renderApp }]) => {
		renderApp(root);
	})
	.catch((error: unknown) => {
		console.error("Failed to initialize renderer", error);
	});
