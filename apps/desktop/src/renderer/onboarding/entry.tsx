import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { applyInitialTheme, applyStoredTheme, MODE_STORAGE_KEY, THEME_STORAGE_KEY } from "../shared/theme/apply";
import { initializeRendererErrorMonitoring } from "../telemetry/error-monitoring";
import "../styles.css";
import { i18n, initOnboardingI18n } from "./i18n";
import { OnboardingApp } from "./OnboardingApp";

initializeRendererErrorMonitoring("onboarding");

// 挂载前同步注入主题变量与 i18n，避免冷启动闪烁（对齐 quickpanel/entry.tsx）。
applyInitialTheme();
initOnboardingI18n();

// 主窗口改主题会写 localStorage，本引导窗监听 storage 同步跟随。
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
			<OnboardingApp />
		</I18nextProvider>
	</StrictMode>,
);
