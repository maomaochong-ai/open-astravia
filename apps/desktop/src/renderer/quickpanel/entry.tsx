import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { QuickPanelApp } from "./QuickPanelApp";
import { i18n, initQuickPanelI18n } from "./i18n";
import { applyInitialTheme, applyStoredTheme, MODE_STORAGE_KEY, THEME_STORAGE_KEY } from "../shared/theme/apply";
import { initializeRendererErrorMonitoring } from "../telemetry/error-monitoring";
import "../styles.css";
import "./index.css";

initializeRendererErrorMonitoring("quick-panel");

// 挂载前同步注入主题变量与 i18n，避免冷启动闪烁（对齐主窗口 main.tsx）。
applyInitialTheme();
initQuickPanelI18n();

// 主窗口改主题会写 localStorage，本面板窗口监听 storage 同步跟随。
window.addEventListener("storage", (event) => {
	if (event.key !== MODE_STORAGE_KEY && event.key !== THEME_STORAGE_KEY) return;
	applyStoredTheme();
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	if (localStorage.getItem(MODE_STORAGE_KEY) === "auto") {
		applyStoredTheme();
	}
});

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Missing root element");
}

createRoot(rootElement).render(
	<StrictMode>
		<I18nextProvider i18n={i18n}>
			<QuickPanelApp />
		</I18nextProvider>
	</StrictMode>,
);
