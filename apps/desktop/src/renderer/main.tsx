import { AppBootLoadingView } from "@astravia-org/theme-ui/app-boot";
import { createRoot } from "react-dom/client";
import { preloadStartupPage } from "./root-layout/preload-startup-page";
import { installInactiveWindowAnimationPause } from "./shared/lib/inactive-window-animations";
import { installLiveAnimations } from "./shared/lib/live-animations";
import { applyPlatformAttribute } from "./shared/lib/platform";
import { applyInitialTheme } from "./shared/theme/apply";
import { applyStoredCursorStyle } from "./shared/theme/cursor";
import { applyStoredFont } from "./shared/theme/ui-font";
import { captureReactError, initializeRendererErrorMonitoring } from "./telemetry/error-monitoring";
import { initializeLongTaskProbe } from "./telemetry/long-task-probe";
import { initializeViteHmrDiagnostics } from "./telemetry/vite-hmr-diagnostics";
import "./styles.css";

initializeViteHmrDiagnostics();
initializeRendererErrorMonitoring("main");
// 渲染层 long task 探针：只在开发构建工作，观察超过阈值的 long task 并交主进程写诊断日志。
initializeLongTaskProbe((record) => {
	void window.astravia.diagnostics.logRendererEvent("long-task", record);
});

// 在首个 React 节点挂载前同步恢复持久化主题、光标与字体，保证窗口首次可见时已使用实际设计令牌。
applyPlatformAttribute();
applyInitialTheme();
applyStoredCursorStyle();
applyStoredFont();
// 窗口不在前台时停掉无限循环的动画：毛玻璃窗口每出一帧都很贵，没人看的时候不该为它付费。
installInactiveWindowAnimationPause();
// 「进行中」指示器的呼吸/波纹由这里统一挂 steps(16) 合成器动画并锁同一相位：整页每秒最多多出 10 帧。
installLiveAnimations();

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Missing root element");
}

const root = createRoot(rootElement, {
	onCaughtError: captureReactError,
	onRecoverableError: captureReactError,
	// 没有任何错误边界接住的异常会走这里；不挂它，整棵子树崩掉时拿不到组件栈。
	onUncaughtError: captureReactError,
});
const appReadyPromise = window.astravia.appLifecycle.whenReady();

root.render(<AppBootLoadingView />);

// 两帧后再通知主进程显示窗口，确保主题变量与 theme-ui 启动骨架已经完成绘制。
const bootPaintedPromise = new Promise<void>((resolve) => {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			window.astravia.appLifecycle.reportRendererBootPainted();
			resolve();
		});
	});
});
const renderAppPromise = import("./renderApp");

/**
 * 开发态预热目标页：生产构建已经把路由拆成静态 chunk，无需预热；开发态每个模块都是一次
 * 请求加一次转换，若与壳层渲染同时发起，会把首屏与随后进入页面一起拖慢（观感上就是进页
 * 面卡、布局被挤得拉扯）。所以等壳层真的画完、浏览器空闲下来再开始，收益仍在但不再抢带宽。
 */
function scheduleDevStartupPrefetch(): void {
	const run = (): void => void preloadStartupPage(window.location.hash);
	if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
	else setTimeout(run, 200);
}
if (import.meta.env.DEV) {
	void bootPaintedPromise.then(scheduleDevStartupPrefetch);
}

void Promise.all([appReadyPromise, bootPaintedPromise, renderAppPromise])
	.then(([, , { renderApp }]) => {
		renderApp(root);
	})
	.catch((error: unknown) => {
		console.error("Failed to initialize renderer", error);
	});
